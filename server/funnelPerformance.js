// Pure analytics for the Performance tab of the /funnel page. No database access here: server/funnel.js reads the data
// (read-only) and hands it in, so every rule below can be unit-tested on fixed events (tests/funnelPerformance.test.mjs).
//
// Rules, in one place:
//   - A person is their normalised phone. Stage times count only on or after that person's own sign-up.
//   - A template is judged on the goal of the flow that sent it: the recipient must reach that stage within
//     ATTRIBUTION_DAYS of the message. Recipients who had already reached it, or who are not in the funnel, are left out.
//   - A rate only counts "matured" recipients (their attribution window has fully passed), so fresh sends never drag it down.
//   - Under MIN_MATURED matured recipients a row is "too few to judge": counts are shown, no rate is ranked.
//   - Anything that cannot be measured is null, never an estimate.

const DAY = 86_400_000;
export const ATTRIBUTION_DAYS = 7;
export const MIN_MATURED = 30;

const SENT_OR_BETTER = new Set(['sent', 'delivered', 'read', 'replied']);
const DELIVERED_OR_BETTER = new Set(['delivered', 'read', 'replied']);
const READ_OR_BETTER = new Set(['read', 'replied']);

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (n, d) => (d > 0 ? round1((n / d) * 100) : null);

/**
 * Every step of the membership funnel, in order. `stage` steps come from stage events, `message` steps from WhatsApp
 * messages sent by the referenced flow step (optionally one A/B variant of it), `promo` steps need real promo codes.
 */
export const PERFORMANCE_STEPS = [
  { id: 'signed_up', kind: 'stage' },
  { id: 'coupon_sent', kind: 'message', refs: [{ flowId: 'mf-signup-coupon', stepId: 'm1' }] },
  { id: 'fw_reminder_sent', kind: 'message', refs: [{ flowId: 'mf-signup-remind', stepId: 'm2' }] },
  { id: 'free_wash_redeemed', kind: 'stage' },
  { id: 'offer_a_sent', kind: 'message', refs: [{ flowId: 'mf-offers', stepId: 'm3', variant: 'A' }] },
  { id: 'offer_b_sent', kind: 'message', refs: [{ flowId: 'mf-offers', stepId: 'm3', variant: 'B' }] },
  { id: 'offer_c_sent', kind: 'message', refs: [{ flowId: 'mf-offers', stepId: 'm3', variant: 'C' }] },
  { id: 'offer_d_sent', kind: 'message', refs: [{ flowId: 'mf-offers', stepId: 'm3', variant: 'D' }] },
  {
    id: 'offer_reminder_sent',
    kind: 'message',
    refs: [
      { flowId: 'mf-reminder-b', stepId: 'm4' },
      { flowId: 'mf-reminder-c', stepId: 'm5' },
      { flowId: 'mf-reminder-d', stepId: 'm5d' }
    ]
  },
  { id: 'offer_redeemed', kind: 'promo' },
  { id: 'membership_offer_sent', kind: 'message', refs: [{ flowId: 'mf-membership-offer', stepId: 'm6' }] },
  { id: 'membership_reminder_sent', kind: 'message', refs: [{ flowId: 'mf-membership-remind', stepId: 'm7' }] },
  { id: 'subscribed', kind: 'stage' },
  { id: 'first_full_renewal', kind: 'stage' }
];

/** Earliest time per (person, stage): duplicates can never double count anyone. */
function firstPerPerson(events) {
  const first = new Map();
  for (const e of events) {
    let per = first.get(e.contactKey);
    if (!per) first.set(e.contactKey, (per = new Map()));
    const cur = per.get(e.stageId);
    if (cur === undefined || e.timestamp < cur) per.set(e.stageId, e.timestamp);
  }
  return first;
}

const stepTemplates = (step, variant) => {
  if (!step) return [];
  if (Array.isArray(step.variants) && step.variants.length > 0) {
    return step.variants.filter((v) => !variant || v.key === variant).map((v) => v.templateId).filter(Boolean);
  }
  return !variant && step.templateId ? [step.templateId] : [];
};

/**
 * What a flow is trying to achieve, read from its first stop rule.
 * Returns a stage id, 'promo' (promo code redeemed: not measurable until real codes are set) or null (no goal).
 */
export function flowGoal(flow) {
  for (const rule of flow?.exitWhen ?? []) {
    if (rule?.type === 'stage_reached' && rule.stageId) return rule.stageId;
    if (rule?.type === 'promo_redeemed') return 'promo';
    if (rule?.type === 'has_entitled_subscription') return 'subscribed';
  }
  return null;
}

/** Two-sided p-value of a two-proportion z-test. */
export function twoProportionP(x1, n1, x2, n2) {
  if (n1 <= 0 || n2 <= 0) return 1;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = Math.abs(x1 / n1 - x2 / n2) / se;
  // Normal CDF via the Abramowitz-Stegun erf approximation (error below 1.5e-7).
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return Math.max(0, 1 - erf);
}

/**
 * @param {object} p
 * @param {{stageId:string, contactKey:string, timestamp:number}[]} p.events  stage events (ms timestamps)
 * @param {{contactKey:string, templateId:string, flowId?:string|null, status:string, timestamp:number}[]|null} p.messages
 *        every recorded WhatsApp message; null = the funnel database could not be read
 * @param {object[]} p.flows  flow definitions (live or seed)
 * @param {{from:Date, to:Date}} p.window
 * @param {Date} p.now
 * @param {number} p.freeWashExpiryDay
 * @param {object[]} [p.chainStages]  the strict cohort funnel stages, used for the biggest drop-off
 */
export function buildPerformance({ events, messages, flows, window, now, freeWashExpiryDay = 7, chainStages = [] }) {
  const fromMs = window.from.getTime();
  const toMs = window.to.getTime();
  const nowMs = now.getTime();
  const horizon = ATTRIBUTION_DAYS * DAY;
  const first = firstPerPerson(events);
  const flowById = new Map(flows.map((f) => [f.id, f]));

  /** A stage time counts only on or after the person's own sign-up. */
  const stageAt = (key, stage) => {
    const per = first.get(key);
    const signup = per?.get('signed_up');
    const t = per?.get(stage);
    return signup !== undefined && t !== undefined && t >= signup ? t : undefined;
  };

  const sent = messages ? messages.filter((m) => SENT_OR_BETTER.has(m.status) && m.contactKey && m.templateId && Number.isFinite(m.timestamp)) : null;
  const receipts = sent ? sent.some((m) => DELIVERED_OR_BETTER.has(m.status)) : false;

  // ---- Steps: which templates each message step sends, and which people got them ----
  const steps = PERFORMANCE_STEPS.map((def) => {
    if (def.kind !== 'message') return { ...def };
    const templates = [...new Set(def.refs.flatMap((r) => stepTemplates(flowById.get(r.flowId)?.steps?.find((s) => s.id === r.stepId), r.variant)))];
    return { ...def, templates, flowIds: new Set(def.refs.map((r) => r.flowId)) };
  });
  // A template can be used by two steps (e.g. an offer and the later membership offer). A message goes to the step whose
  // flow sent it; a message from any other flow (a manual campaign) goes to the first step that uses the template.
  const claims = new Map();
  steps.forEach((s, i) => {
    for (const t of s.templates ?? []) claims.set(t, [...(claims.get(t) ?? []), i]);
  });
  const gotStep = steps.map(() => new Set());
  if (sent) {
    for (const m of sent) {
      const candidates = claims.get(m.templateId);
      if (!candidates) continue;
      const exact = candidates.filter((i) => steps[i].flowIds.has(m.flowId));
      for (const i of exact.length ? exact : [candidates[0]]) gotStep[i].add(m.contactKey);
    }
  }
  const reachedStep = (key, i) => {
    const s = steps[i];
    if (s.kind === 'stage') return stageAt(key, s.id) !== undefined;
    if (s.kind === 'message') return gotStep[i].has(key);
    return false;
  };
  const measurable = (s) => s.kind === 'stage' || (s.kind === 'message' && sent !== null);
  const whyOf = (s) => (s.kind === 'promo' ? 'mfWhyPromoPlaceholder' : s.kind === 'message' && sent === null ? 'mfWhyNoFunnelDb' : undefined);

  // ---- Snapshot: everyone who ever signed up, counted once at the furthest step they have reached ----
  const everyone = [];
  for (const [key, per] of first) if (per.has('signed_up')) everyone.push(key);
  const snapshotCounts = steps.map(() => 0);
  let expiredUnredeemed = 0;
  const redeemedIdx = steps.findIndex((s) => s.id === 'free_wash_redeemed');
  for (const key of everyone) {
    let furthest = 0;
    for (let i = steps.length - 1; i > 0; i--) {
      if (reachedStep(key, i)) {
        furthest = i;
        break;
      }
    }
    snapshotCounts[furthest]++;
    if (furthest < redeemedIdx && first.get(key).get('signed_up') + freeWashExpiryDay * DAY <= nowMs) expiredUnredeemed++;
  }
  const snapshot = {
    total: everyone.length,
    expiredUnredeemed,
    steps: steps.map((s, i) => ({ id: s.id, kind: s.kind, count: measurable(s) ? snapshotCounts[i] : null, pctOfTotal: measurable(s) ? pct(snapshotCounts[i], everyone.length) : null, why: whyOf(s) }))
  };

  // ---- Reached: people who signed up in the period, and every step they have reached since ----
  const cohort = everyone.filter((key) => {
    const t = first.get(key).get('signed_up');
    return t >= fromMs && t < toMs;
  });
  const reached = {
    cohortSize: cohort.length,
    steps: steps.map((s, i) => {
      const count = measurable(s) ? cohort.reduce((n, key) => n + (reachedStep(key, i) ? 1 : 0), 0) : null;
      return { id: s.id, kind: s.kind, templates: s.templates, count, pctOfTop: count === null ? null : pct(count, cohort.length), why: whyOf(s) };
    })
  };

  // ---- Template leaderboard: messages sent in the period, judged on the goal of the flow that sent them ----
  const templateGoal = new Map(); // fallback for messages whose flow is not a known flow (manual campaigns)
  for (const f of flows) {
    const goal = flowGoal(f);
    for (const s of f.steps ?? []) for (const t of stepTemplates(s)) if (!templateGoal.has(t)) templateGoal.set(t, goal);
  }
  const goalOf = (m) => (flowById.has(m.flowId) ? flowGoal(flowById.get(m.flowId)) : templateGoal.has(m.templateId) ? templateGoal.get(m.templateId) : 'subscribed');

  const rows = new Map();
  if (sent) {
    for (const m of sent) {
      if (m.timestamp < fromMs || m.timestamp >= toMs) continue;
      const goal = goalOf(m) ?? 'none';
      const id = `${m.templateId}|${goal}`;
      let row = rows.get(id);
      if (!row) rows.set(id, (row = { templateId: m.templateId, goal, sent: 0, delivered: 0, read: 0, firstSend: new Map() }));
      row.sent++;
      if (DELIVERED_OR_BETTER.has(m.status)) row.delivered++;
      if (READ_OR_BETTER.has(m.status)) row.read++;
      const cur = row.firstSend.get(m.contactKey);
      if (cur === undefined || m.timestamp < cur) row.firstSend.set(m.contactKey, m.timestamp);
    }
  }
  const templates = [...rows.values()].map((row) => {
    const judged = row.goal !== 'none' && row.goal !== 'promo';
    let untracked = 0;
    let alreadyReached = 0;
    let eligible = 0;
    let matured = 0;
    let converted = 0;
    let convertedSoFar = 0;
    for (const [key, sentAt] of row.firstSend) {
      if (!first.get(key)?.has('signed_up')) {
        untracked++;
        continue;
      }
      if (!judged) continue;
      const goalAt = stageAt(key, row.goal);
      if (goalAt !== undefined && goalAt < sentAt) {
        alreadyReached++;
        continue;
      }
      eligible++;
      const hit = goalAt !== undefined && goalAt - sentAt <= horizon;
      if (hit) convertedSoFar++;
      if (sentAt + horizon <= nowMs) {
        matured++;
        if (hit) converted++;
      }
    }
    const enough = judged && matured >= MIN_MATURED;
    return {
      templateId: row.templateId,
      goal: row.goal,
      sent: row.sent,
      recipients: row.firstSend.size,
      untracked,
      alreadyReached: judged ? alreadyReached : null,
      eligible: judged ? eligible : null,
      matured: judged ? matured : null,
      converted: judged ? converted : null,
      convertedSoFar: judged ? convertedSoFar : null,
      rate: judged && matured > 0 ? pct(converted, matured) : null,
      enough,
      deliveredPct: receipts ? pct(row.delivered, row.sent) : null,
      readPct: receipts ? pct(row.read, row.sent) : null,
      why: row.goal === 'promo' ? 'mfWhyPromoPlaceholder' : row.goal === 'none' ? 'pfWhyNoGoal' : undefined
    };
  });
  // Rows that can be judged first, best rate on top; then by volume.
  templates.sort((a, b) => Number(b.enough) - Number(a.enough) || (b.enough ? b.rate - a.rate : 0) || b.sent - a.sent || a.templateId.localeCompare(b.templateId));

  // ---- A/B comparison: every flow step that splits between templates ----
  const rowFor = (templateId, goal) => templates.find((t) => t.templateId === templateId && t.goal === (goal ?? 'none')) ?? null;
  const abTests = [];
  for (const f of flows) {
    const goal = flowGoal(f);
    for (const s of f.steps ?? []) {
      if (!Array.isArray(s.variants) || new Set(s.variants.map((v) => v.templateId)).size < 2) continue;
      const variants = s.variants.map((v) => ({ key: v.key, templateId: v.templateId, weight: v.weight, stats: rowFor(v.templateId, goal) }));
      const judged = variants.filter((v) => v.stats?.enough).sort((a, b) => b.stats.rate - a.stats.rate);
      let verdict = 'too_few';
      let leader = null;
      if (sent === null) verdict = 'not_measured';
      else if (goal === 'promo' || goal === null) verdict = 'no_goal';
      else if (judged.length >= 2 && judged.length === variants.length) {
        // Leader against the runner-up, with the bar raised for the number of variants compared (Bonferroni).
        const [a, b] = judged;
        const p = twoProportionP(a.stats.converted, a.stats.matured, b.stats.converted, b.stats.matured);
        if (p < 0.05 / (variants.length - 1)) {
          verdict = 'leader';
          leader = a.key;
        } else verdict = 'no_clear_winner';
      }
      abTests.push({ flowId: f.id, flowName: f.name?.en ?? f.id, stepId: s.id, stepName: s.name?.en ?? s.id, goal: goal ?? 'none', variants, verdict, leader });
    }
  }

  // ---- Hero numbers ----
  const members = cohort.reduce((n, key) => n + (stageAt(key, 'subscribed') !== undefined ? 1 : 0), 0);
  const best = templates.find((t) => t.enough) ?? null;
  let dropOff = null;
  chainStages.forEach((s, i) => {
    if (i > 0 && s.dropOffCount > 0 && (!dropOff || s.dropOffCount > dropOff.count)) {
      dropOff = { from: chainStages[i - 1].id, to: s.id, count: s.dropOffCount, pctLost: pct(s.dropOffCount, chainStages[i - 1].count) };
    }
  });

  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    attributionDays: ATTRIBUTION_DAYS,
    minMatured: MIN_MATURED,
    sources: { messages: sent !== null, receipts },
    hero: {
      tracked: everyone.length,
      cohortSize: cohort.length,
      members,
      memberPct: pct(members, cohort.length),
      best: best ? { templateId: best.templateId, goal: best.goal, rate: best.rate, matured: best.matured } : null,
      dropOff
    },
    snapshot,
    reached,
    templates,
    abTests
  };
}
