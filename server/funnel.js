// Funnel & Flows API for the /funnel page.
//
// Ported from the Rush Funnel project (apps/api): sources.config.ts, sync/stage-sync.ts, analytics/cohort.ts,
// analytics/membership-graph.ts and routes/membership-funnel.ts.
//
// STRICTLY READ-ONLY. Two data sources:
//   1. The Rush database this server already uses: stage events (sign-up, free wash, subscribed, first full renewal)
//      are derived from it on the fly with the funnel project's own rules, so the numbers never depend on a sync job.
//   2. The funnel's own database (MONGO_FUNNEL_URI, default local `rush_funnel`): flows, messages sent and offer events.
//      Optional. When it cannot be read the page still shows the funnel numbers, and says what is missing.
// Anything that cannot be measured is null, never an estimate.
import { MongoClient } from 'mongodb';
import { SEED_FLOWS } from './funnelSeed.js';

const DAY = 86_400_000;

// ---- Source mapping (apps/api/src/sources/sources.config.ts) ----
const SOURCES = {
  collections: {
    customers: 'rushwash_customers',
    subscriptions: 'rushwash_subscriptions',
    couponRedemptions: 'rushwash_coupon_redemptions',
    saleOrders: 'rushwash_sale_orders'
  },
  portalSignupFilter: {
    $or: [
      { 'audit.createdById': 'portal-signup' },
      { createdById: 'portal-signup' },
      { createdByName: 'Portal signup' },
      { 'audit.createdByName': 'Portal signup' }
    ]
  },
  freeWashCouponReadableCodes: ['DSC-00074', 'DSC-00080', 'DSC-00655', 'DSC-00665'],
  // Offers B and C are tracked by promo code. These are still the funnel project's placeholders: they match nothing.
  promoOffers: { offerB: ['WALLET50-PLACEHOLDER'], offerC: ['INTERIOR-PLACEHOLDER'], offerD: ['INTERIOR-MONTH-PLACEHOLDER'] },
  promoPlaceholderMarker: 'PLACEHOLDER',
  activeStatuses: ['active'],
  cteStatus: 'cancelled_voluntary',
  parentFilter: { $or: [{ parentSubCode: null }, { parentSubCode: { $exists: false } }] },
  paidOrderStatuses: ['paid', 'active', 'captured', 'succeeded'],
  fullPriceRenewalFilter: {
    isRenewal: true,
    status: { $in: ['paid', 'active'] },
    $or: [{ isDiscounted: false }, { isDiscounted: { $exists: false } }],
    $and: [
      { $or: [{ promotionAccept: null }, { promotionAccept: { $exists: false } }] },
      { $or: [{ couponCode: null }, { couponCode: { $exists: false } }] }
    ]
  }
};

/** Normalise Saudi/international phone numbers to E.164 (+9665XXXXXXXX). Same rule as the funnel gatekeeper. */
function normalizePhone(input) {
  if (!input) return null;
  let digits = String(input).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('05') && digits.length === 10) digits = '966' + digits.slice(1);
  else if (digits.startsWith('5') && digits.length === 9) digits = '966' + digits;
  if (!/^\d{8,15}$/.test(digits)) return null;
  if (digits.startsWith('966') && digits.length !== 12) return null;
  return '+' + digits;
}
const pickPhone = (...candidates) => {
  for (const c of candidates) {
    const n = normalizePhone(c);
    if (n) return n;
  }
  return '';
};
const toMs = (v) => {
  if (!v) return NaN;
  return new Date(v).getTime();
};

// ---- Stage events, derived read-only from the Rush database (same rules as sync/stage-sync.ts) ----
async function deriveStageEvents(db) {
  const events = [];
  const add = (stageId, contactKey, t) => {
    if (contactKey && Number.isFinite(t)) events.push({ stageId, contactKey, timestamp: t });
  };

  // Stage 1: portal sign-ups. A person is their normalised phone.
  const customers = await db
    .collection(SOURCES.collections.customers)
    .find(SOURCES.portalSignupFilter)
    .project({ readableCode: 1, phone: 1, normalizedPhone: 1, createdAt: 1 })
    .toArray();
  const phoneByCode = new Map();
  const phones = new Set();
  for (const c of customers) {
    const phone = pickPhone(c.normalizedPhone, c.phone);
    if (!phone) continue;
    phones.add(phone);
    if (c.readableCode) phoneByCode.set(c.readableCode, phone);
    add('signed_up', phone, toMs(c.createdAt));
  }

  // Stage 2: free-wash coupon redeemed.
  const redemptions = await db
    .collection(SOURCES.collections.couponRedemptions)
    .find({ couponReadableCode: { $in: SOURCES.freeWashCouponReadableCodes } })
    .project({ customerCode: 1, redeemedAt: 1 })
    .toArray();
  for (const r of redemptions) add('free_wash_redeemed', phoneByCode.get(r.customerCode), toMs(r.redeemedAt));

  // Stage 5: subscribed = parent subscription that is active, or cancelled but still inside its paid cycle.
  const now = new Date();
  const subs = await db
    .collection(SOURCES.collections.subscriptions)
    .find({
      $and: [
        SOURCES.parentFilter,
        { $or: [{ status: { $in: SOURCES.activeStatuses } }, { status: SOURCES.cteStatus, renewalDate: { $gt: now } }] }
      ]
    })
    .project({ readableCode: 1, createdAt: 1, customerSnapshot: 1 })
    .toArray();
  const matched = [];
  for (const s of subs) {
    const snap = s.customerSnapshot || {};
    const phone = pickPhone(snap.phone);
    const key = phone ? (phones.has(phone) ? phone : null) : phoneByCode.get(snap.readableCode);
    if (key) matched.push({ key, code: s.readableCode, createdAt: s.createdAt });
  }
  // Conversion time = the first paid order when one is visible, else the subscription's creation time.
  const firstPaid = new Map();
  const codes = matched.map((m) => m.code).filter(Boolean);
  for (let i = 0; i < codes.length; i += 500) {
    const orders = await db
      .collection(SOURCES.collections.saleOrders)
      .find({ subscriptionReadableCode: { $in: codes.slice(i, i + 500) }, status: { $in: SOURCES.paidOrderStatuses } })
      .project({ subscriptionReadableCode: 1, createdAt: 1 })
      .toArray();
    for (const o of orders) {
      const t = toMs(o.createdAt);
      if (!Number.isFinite(t)) continue;
      const cur = firstPaid.get(o.subscriptionReadableCode);
      if (cur === undefined || t < cur) firstPaid.set(o.subscriptionReadableCode, t);
    }
  }
  for (const m of matched) add('subscribed', m.key, firstPaid.get(m.code) ?? toMs(m.createdAt));

  // Stage 6: first full-price renewal (renewal order, paid, no discount / promotion / coupon).
  const renewals = await db
    .collection(SOURCES.collections.saleOrders)
    .find(SOURCES.fullPriceRenewalFilter)
    .project({ customerSnapshot: 1, createdAt: 1 })
    .toArray();
  for (const o of renewals) add('first_full_renewal', phoneByCode.get(o.customerSnapshot?.readableCode), toMs(o.createdAt));

  return events;
}

// ---- Pure analytics (analytics/cohort.ts and analytics/membership-graph.ts) ----
const DEFAULT_DEFINITION = {
  stageLabels: { signed_up: 'Signed up', free_wash_redeemed: 'Free wash redeemed', subscribed: 'Subscribed', first_full_renewal: 'First full-price renewal' },
  freeWashReminderDay: 5,
  freeWashExpiryDay: 7
};
const CHAIN = ['signed_up', 'free_wash_redeemed', 'subscribed', 'first_full_renewal'];
const DELIVERED_OR_BETTER = new Set(['sent', 'delivered', 'read', 'replied']);
const UNMEASURED = {
  remB: 'mfWhyNoOfferTracking',
  remC: 'mfWhyNoOfferTracking',
  msoffer: 'mfWhyNoOfferTracking',
  msremind: 'mfWhyNoOfferTracking',
  s3scan: 'mfWhyNoUsageScan',
  s3nudge: 'mfWhyNoUsageScan',
  s3follow: 'mfWhyNoUsageScan',
  rr: 'mfWhyNoRenewalCycle',
  rd: 'mfWhyNoRenewalCycle',
  pay: 'mfWhyNoRenewalCycle'
};

/** Earliest event per (person, stage): duplicates can never double count anyone. */
function firstPerPerson(events) {
  const first = new Map();
  for (const e of events) {
    const per = first.get(e.contactKey) ?? new Map();
    const cur = per.get(e.stageId);
    if (cur === undefined || e.timestamp < cur) per.set(e.stageId, e.timestamp);
    first.set(e.contactKey, per);
  }
  return first;
}

function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

/**
 * Strict cohort funnel: everyone who signed up in [from, to); each later stage counts only for them, only on or after
 * their own sign-up, and only through the previous stage. People who skipped a stage are reported in `outsideChain`.
 */
function buildCohortFunnel(events, win) {
  const first = firstPerPerson(events);
  const cohort = [];
  for (const [k, stages] of first) {
    const t = stages.get('signed_up');
    if (t !== undefined && t >= win.from.getTime() && t < win.to.getTime()) cohort.push(k);
  }
  const reachedAt = (k, stage) => {
    const signup = first.get(k).get('signed_up');
    const t = first.get(k).get(stage);
    return t !== undefined && t >= signup ? t : undefined;
  };

  let inChain = new Set(cohort);
  let prevAt = new Map(cohort.map((k) => [k, first.get(k).get('signed_up')]));
  const top = cohort.length;
  const stages = [];
  CHAIN.forEach((stage, i) => {
    if (i === 0) {
      stages.push({ id: stage, count: top, outsideChain: 0, pctOfPrevious: top ? 100 : 0, pctOfTop: top ? 100 : 0, dropOffCount: 0, medianDaysFromPrevious: null });
      return;
    }
    const next = new Set();
    const nextAt = new Map();
    const gaps = [];
    let outside = 0;
    for (const k of cohort) {
      const t = reachedAt(k, stage);
      if (t === undefined) continue;
      if (inChain.has(k) && t >= (prevAt.get(k) ?? 0)) {
        next.add(k);
        nextAt.set(k, t);
        gaps.push((t - prevAt.get(k)) / DAY);
      } else {
        outside++;
      }
    }
    const prevCount = inChain.size;
    const med = median(gaps);
    stages.push({
      id: stage,
      count: next.size,
      outsideChain: outside,
      pctOfPrevious: pct(next.size, prevCount),
      pctOfTop: pct(next.size, top),
      dropOffCount: Math.max(0, prevCount - next.size),
      medianDaysFromPrevious: med === null ? null : Math.round(med * 10) / 10
    });
    inChain = next;
    prevAt = nextAt;
  });

  return { window: { from: win.from.toISOString(), to: win.to.toISOString() }, cohortSize: top, stages };
}

/** Real numbers for the Membership Funnel chart (nodes and arrows). */
function buildMembershipGraph({ events, messages, window, now, promo, promoPlaceholder, includeHistorical, offersMeasured, definition = DEFAULT_DEFINITION }) {
  const FREE_WASH_REMINDER_DAY = definition.freeWashReminderDay;
  const FREE_WASH_EXPIRY_DAY = definition.freeWashExpiryDay;
  const first = firstPerPerson(events);
  const cohort = [];
  const fromMs = window.from.getTime();
  const toMsV = window.to.getTime();
  for (const per of first.values()) {
    const signup = per.get('signed_up');
    if (signup === undefined) continue;
    const inWindow = signup >= fromMs && signup < toMsV;
    if (inWindow || (includeHistorical && signup < toMsV)) {
      cohort.push({ signup, at: (stage) => { const t = per.get(stage); return t !== undefined && t >= signup ? t : undefined; } });
    }
  }

  const nowMs = now.getTime();
  const within = (c, stage, days) => {
    const t = c.at(stage);
    return t !== undefined && t - c.signup <= days * DAY;
  };
  const matured = (days) => cohort.filter((c) => c.signup + days * DAY <= nowMs);

  const redeemedTotal = cohort.filter((c) => c.at('free_wash_redeemed') !== undefined).length;
  const redeemedBy5 = cohort.filter((c) => within(c, 'free_wash_redeemed', FREE_WASH_REMINDER_DAY)).length;
  const redeemedBy7 = cohort.filter((c) => within(c, 'free_wash_redeemed', FREE_WASH_EXPIRY_DAY)).length;
  const notRedeemedBy5 = matured(FREE_WASH_REMINDER_DAY).filter((c) => !within(c, 'free_wash_redeemed', FREE_WASH_REMINDER_DAY)).length;
  const notRedeemedBy7 = matured(FREE_WASH_EXPIRY_DAY).filter((c) => !within(c, 'free_wash_redeemed', FREE_WASH_EXPIRY_DAY)).length;
  const unredeemedTotal = cohort.length - redeemedTotal;

  const offersSent = offersMeasured ? cohort.filter((c) => c.at('offer_sent') !== undefined).length : null;
  const members = cohort.filter((c) => c.at('subscribed') !== undefined).length;
  const renewed = cohort.filter((c) => c.at('first_full_renewal') !== undefined).length;

  const nodes = {
    signup: cohort.length,
    s1issue: cohort.length,
    s1remind: includeHistorical ? unredeemedTotal : notRedeemedBy5,
    s1dead: includeHistorical ? unredeemedTotal : notRedeemedBy7,
    offers: offersSent,
    members,
    fnf: renewed
  };
  const edges = {
    e1: cohort.length,
    e2: includeHistorical ? unredeemedTotal : notRedeemedBy5,
    e3: redeemedBy5,
    e4: includeHistorical ? unredeemedTotal : notRedeemedBy7,
    e5: includeHistorical ? redeemedTotal - redeemedBy5 : redeemedBy7 - redeemedBy5,
    e25: renewed,
    e29: null
  };

  let templateSent = null;
  if (messages) {
    templateSent = {};
    for (const m of messages) {
      const t = toMs(m.createdAt);
      if (!DELIVERED_OR_BETTER.has(m.status) || Number.isNaN(t) || t < fromMs || t >= toMsV) continue;
      templateSent[m.templateId] = (templateSent[m.templateId] ?? 0) + 1;
    }
  }

  const why = { ...UNMEASURED };
  if (!offersMeasured) why.offers = 'mfWhyNoFunnelDb';
  for (const k of ['offerB', 'offerC', 'offerD']) {
    if (promo[k] === null) why[k] = 'mfWhyPromoNotConfigured';
    else if (promoPlaceholder[k]) why[k] = 'mfWhyPromoPlaceholder';
  }

  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    cohortSize: cohort.length,
    redeemedTotal,
    nodes,
    edges,
    templateSent,
    promoRedemptions: promo,
    why
  };
}

// ---- Trends: people per day (Asia/Riyadh) reaching each stage for the first time ----
const RIYADH_OFFSET_MS = 3 * 3_600_000;
const MAX_TREND_DAYS = 120;
const riyadhDay = (t) => new Date(t + RIYADH_OFFSET_MS).toISOString().slice(0, 10);

function buildTrends(events, window) {
  const first = new Map();
  for (const e of events) {
    if (!CHAIN.includes(e.stageId)) continue;
    const id = `${e.contactKey}|${e.stageId}`;
    const cur = first.get(id);
    if (cur === undefined || e.timestamp < cur) first.set(id, e.timestamp);
  }
  const days = [];
  const startDay = Date.parse(`${riyadhDay(window.from.getTime())}T00:00:00Z`);
  const endDay = Date.parse(`${riyadhDay(window.to.getTime() - 1)}T00:00:00Z`);
  for (let d = startDay; d <= endDay && days.length < MAX_TREND_DAYS; d += DAY) days.push(new Date(d).toISOString().slice(0, 10));
  const index = new Map(days.map((d, i) => [d, i]));
  const series = Object.fromEntries(CHAIN.map((s) => [s, days.map(() => 0)]));
  for (const [id, t] of first) {
    if (t < window.from.getTime() || t >= window.to.getTime()) continue;
    const i = index.get(riyadhDay(t));
    if (i === undefined) continue;
    series[id.slice(id.lastIndexOf('|') + 1)][i]++;
  }
  return { window: { from: window.from.toISOString(), to: window.to.toISOString() }, days, series };
}

// ---- Editing: validation. Edits are saved as DRAFTS; nothing here publishes or starts a flow. ----
class ValidationError extends Error {}
const bad = (msg) => {
  throw new ValidationError(msg);
};
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, what, max = 200, { required = true } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) bad(`${what} is required`);
    return undefined;
  }
  if (typeof v !== 'string') bad(`${what} must be text`);
  const t = v.trim();
  if (required && !t) bad(`${what} is required`);
  if (t.length > max) bad(`${what} is too long (max ${max} characters)`);
  return t;
};
const int = (v, what, min, max) => {
  if (!Number.isInteger(v) || v < min || v > max) bad(`${what} must be a whole number from ${min} to ${max}`);
  return v;
};
const TEMPLATE_ID = /^[A-Za-z0-9_]{1,80}$/;
const templateId = (v, what) => {
  if (typeof v !== 'string' || !TEMPLATE_ID.test(v)) bad(`${what} must be a template id (letters, numbers and underscores)`);
  return v;
};

const STAGES = ['signed_up', 'free_wash_redeemed', 'offer_sent', 'offer_engaged', 'subscribed', 'first_full_renewal'];
const SEGMENTS = ['renewal_due_5d', 'renewal_failed', 'inactive_7d', 'inactive_14d', 'cancelled_still_valid', 'expired_no_active', 'voucher_issued_unredeemed', 'under_2_washes_7d'];
const OFFERS = ['offerB', 'offerC', 'offerD'];
const STEP_KINDS = ['send_template', 'wait', 'condition', 'ab_split', 'grant_offer'];
const MAX_STEPS = 40;
const STEP_ID = /^[A-Za-z0-9_-]{1,24}$/;
const pick = (v, list, what) => {
  if (!list.includes(v)) bad(`${what} is not an allowed value`);
  return v;
};
const pickMany = (v, list, what) => {
  if (!Array.isArray(v) || v.length === 0) bad(`Pick at least one ${what}`);
  return [...new Set(v.map((x) => pick(x, list, what)))];
};

function validateTrigger(t, live) {
  if (t === undefined || t === null) return undefined;
  if (!isObj(t)) bad('Trigger is invalid');
  const maxAge = t.maxAgeHours === undefined ? undefined : int(t.maxAgeHours, 'Entry max age (hours)', 1, 24 * 365);
  const withAge = (o) => (maxAge === undefined ? o : { ...o, maxAgeHours: maxAge });
  switch (t.type) {
    case 'event':
      return withAge({ type: 'event', stageId: pick(t.stageId, STAGES, 'Trigger stage') });
    case 'segment':
      // A segment the live flow already uses stays valid even if it is not in the list above.
      return { type: 'segment', segment: t.segment === live.trigger?.segment ? t.segment : pick(t.segment, SEGMENTS, 'Trigger segment') };
    case 'promo_redeemed':
      return withAge({ type: 'promo_redeemed', offers: pickMany(t.offers, OFFERS, 'offer') });
    case 'offer_sent': {
      if (!Array.isArray(t.templateIds) || t.templateIds.length === 0) bad('Pick at least one template for the trigger');
      const out = { type: 'offer_sent', templateIds: [...new Set(t.templateIds.map((x) => templateId(x, 'Trigger template')))] };
      if (t.fromFlowId) out.fromFlowId = text(t.fromFlowId, 'Trigger flow', 80);
      return withAge(out);
    }
    default:
      return bad('Trigger type is not allowed');
  }
}

function validateExit(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 10) bad('Stop rules are invalid');
  return list.map((r) => {
    if (!isObj(r)) bad('Stop rule is invalid');
    if (r.type === 'stage_reached') return { type: 'stage_reached', stageId: pick(r.stageId, STAGES, 'Stop stage') };
    if (r.type === 'has_entitled_subscription') return { type: 'has_entitled_subscription' };
    if (r.type === 'promo_redeemed') return { type: 'promo_redeemed', offers: pickMany(r.offers, OFFERS, 'offer') };
    return bad('Stop rule type is not allowed');
  });
}

function validateCondition(c, base, label) {
  if (!isObj(c) || !isObj(c.check)) bad(`${label} needs a check`);
  let check;
  if (c.check.type === 'days_since_last_wash') {
    check = { ...(base?.check?.type === 'days_since_last_wash' ? base.check : {}), type: 'days_since_last_wash', moreThan: int(c.check.moreThan, `${label} days`, 0, 365) };
  } else if (base?.check && c.check.type === base.check.type) {
    // An existing check of another kind is kept as the funnel defined it; only its yes/no targets are editable.
    check = base.check;
  } else {
    bad(`${label}: this check type cannot be created here`);
  }
  return { check, yes: c.yes ?? null, no: c.no ?? null };
}

/**
 * Validates an edited flow. Steps can be added, removed and reordered; the result is a complete, self-consistent flow
 * (unique step ids, every condition target exists). `live` supplies fields the editor cannot create (e.g. grant_offer).
 */
export function validateFlowDraft(input, live) {
  if (!isObj(input)) bad('Send the flow as an object');
  const out = {};
  if (!isObj(input.name)) bad('name is required');
  out.name = { en: text(input.name.en, 'Flow name') };
  const ar = text(input.name.ar, 'Arabic name', 200, { required: false });
  if (ar) out.name.ar = ar;
  if (!isObj(input.description)) bad('description is required');
  out.description = { en: text(input.description.en, 'Description', 1000) };
  const dar = text(input.description.ar, 'Arabic description', 1000, { required: false });
  if (dar) out.description.ar = dar;

  if (!['running', 'paused'].includes(input.status)) bad('Status must be running or paused');
  out.status = input.status;

  if (!isObj(input.window) || !Array.isArray(input.window.days)) bad('Send window is required');
  const days = [...new Set(input.window.days.map((d) => int(d, 'Send day', 0, 6)))].sort((a, b) => a - b);
  if (days.length === 0) bad('Pick at least one send day');
  const startHour = int(input.window.startHour, 'Start hour', 0, 23);
  const endHour = int(input.window.endHour, 'End hour', 1, 24);
  if (endHour <= startHour) bad('The send window must end after it starts');
  out.window = { days, startHour, endHour };

  if (!isObj(input.volume)) bad('Volume limit is required');
  const perHour = int(input.volume.perHour, 'Per-hour limit', 1, 100000);
  const perDay = int(input.volume.perDay, 'Per-day limit', 1, 1000000);
  if (perHour > perDay) bad('The per-hour limit cannot exceed the per-day limit');
  out.volume = { perHour, perDay };

  if (!['once', 'per_cycle'].includes(input.reentry)) bad('Re-entry must be once or per_cycle');
  out.reentry = input.reentry;
  if (typeof input.approveFirstBatch !== 'boolean') bad('approveFirstBatch must be true or false');
  out.approveFirstBatch = input.approveFirstBatch;

  if (input.maxReminders !== undefined && input.maxReminders !== null) out.maxReminders = int(input.maxReminders, 'Max reminders', 1, 10);
  const trigger = validateTrigger(input.trigger, live);
  if (trigger) out.trigger = trigger;
  out.exitWhen = validateExit(input.exitWhen);

  if (!Array.isArray(input.steps) || input.steps.length === 0) bad('A flow needs at least one step');
  if (input.steps.length > MAX_STEPS) bad(`A flow can have at most ${MAX_STEPS} steps`);
  const ids = new Set();
  const liveById = new Map((live.steps ?? []).map((s) => [s.id, s]));
  out.steps = input.steps.map((s, i) => {
    const label = `Step ${i + 1}`;
    if (!isObj(s)) bad(`${label} is invalid`);
    if (typeof s.id !== 'string' || !STEP_ID.test(s.id)) bad(`${label} has an invalid id`);
    if (ids.has(s.id)) bad(`${label} repeats the id "${s.id}"`);
    ids.add(s.id);
    pick(s.kind, STEP_KINDS, `${label} type`);
    const prior = liveById.get(s.id);
    if (s.kind === 'grant_offer' && prior?.kind !== 'grant_offer') bad(`${label}: grant-offer steps cannot be created here`);
    if (!isObj(s.name)) bad(`${label} needs a name`);
    const base = prior && prior.kind === s.kind ? prior : {};
    const step = { ...base, id: s.id, kind: s.kind, name: { ...(base.name ?? {}), en: text(s.name.en, `${label} name`) }, paused: !!s.paused };
    delete step.variants;
    delete step.templateId;
    delete step.waitHours;
    delete step.condition;
    delete step.holdoutPct;
    delete step.deadline;
    delete step.reminder;

    if (s.kind === 'wait') step.waitHours = int(s.waitHours, `${label} wait (hours)`, 0, 24 * 365);
    if (s.kind === 'send_template') {
      if (Array.isArray(s.variants) && s.variants.length > 0) {
        if (s.variants.length < 2 || s.variants.length > 4) bad(`${label}: an A/B split needs 2, 3 or 4 variants`);
        step.variants = s.variants.map((v, j) => {
          if (!isObj(v) || v.key !== 'ABCD'[j]) bad(`${label}: variants must be A, B, C, D in order`);
          return { key: v.key, templateId: templateId(v.templateId, `${label} template ${v.key}`), weight: int(v.weight, `${label} weight ${v.key}`, 0, 100) };
        });
        if (step.variants.reduce((a, v) => a + v.weight, 0) !== 100) bad(`${label}: A/B weights must add up to 100`);
        step.templateId = step.variants[0].templateId;
      } else {
        step.templateId = templateId(s.templateId, `${label} template`);
      }
      if (s.holdoutPct !== undefined) step.holdoutPct = int(s.holdoutPct, `${label} hold-back`, 0, 100);
      if (s.reminder !== undefined && typeof s.reminder !== 'boolean') bad(`${label}: reminder must be true or false`);
      if (s.reminder) step.reminder = true;
      if (s.deadline !== undefined && s.deadline !== null) {
        if (!isObj(s.deadline)) bad(`${label} deadline is invalid`);
        const onExpire = s.deadline.onExpire;
        if (typeof onExpire !== 'string' || onExpire.length > 24) bad(`${label}: choose what happens when the deadline passes`);
        step.deadline = { afterHours: int(s.deadline.afterHours, `${label} deadline (hours)`, 1, 24 * 365), onExpire };
      }
    }
    if (s.kind === 'condition') step.condition = validateCondition(s.condition, prior?.condition, label);
    return step;
  });

  // A deadline hands over to 'exit', 'next' or a step that exists in this flow (never itself).
  for (const st of out.steps) {
    const to = st.deadline?.onExpire;
    if (to !== undefined && to !== 'exit' && to !== 'next' && (!ids.has(to) || to === st.id)) bad(`"${st.name.en}": the deadline hands over to a step that does not exist`);
  }
  // Every condition must point at a step that exists in this flow, and never at itself.
  for (const st of out.steps) {
    if (!st.condition) continue;
    for (const side of ['yes', 'no']) {
      const target = st.condition[side];
      if (target !== null && (typeof target !== 'string' || !ids.has(target) || target === st.id)) bad(`"${st.name.en}": the ${side} branch points at a step that does not exist`);
    }
  }
  return out;
}

/** Validates the funnel definition (dashboard presentation only: stage names and the free-wash day thresholds). */
export function validateDefinition(input) {
  if (!isObj(input) || !isObj(input.stageLabels)) bad('Send the definition as an object');
  const stageLabels = {};
  for (const id of CHAIN) stageLabels[id] = text(input.stageLabels[id], `Name of stage "${id}"`, 60);
  const freeWashReminderDay = int(input.freeWashReminderDay, 'Reminder day', 1, 30);
  const freeWashExpiryDay = int(input.freeWashExpiryDay, 'Expiry day', 1, 60);
  if (freeWashExpiryDay <= freeWashReminderDay) bad('The expiry day must come after the reminder day');
  return { stageLabels, freeWashReminderDay, freeWashExpiryDay };
}

// ---- Routes ----
const parseDate = (v) => {
  if (v === undefined || v === '') return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
};

/**
 * @param {import('express').Express} app
 * @param {{ getSourceDb: () => import('mongodb').Db | null }} deps
 */
export function registerFunnelRoutes(app, { getSourceDb }) {
  const funnelUri = process.env.MONGO_FUNNEL_URI || 'mongodb://127.0.0.1:27017/rush_funnel';
  const funnelDbName = (() => {
    try {
      return new URL(funnelUri.replace(/^mongodb(\+srv)?:\/\//, 'http://')).pathname.replace(/^\//, '') || 'rush_funnel';
    } catch {
      return 'rush_funnel';
    }
  })();

  // The funnel database is optional and only ever read. A failed connection is retried at most every 30 seconds.
  let funnelDb = null;
  let funnelTriedAt = 0;
  let funnelConnecting = null;
  async function getFunnelDb() {
    if (funnelDb) return funnelDb;
    if (funnelConnecting) return funnelConnecting;
    if (Date.now() - funnelTriedAt < 30_000) return null;
    funnelTriedAt = Date.now();
    funnelConnecting = (async () => {
      const client = new MongoClient(funnelUri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 5000 });
      try {
        await client.connect();
        funnelDb = client.db(funnelDbName);
        console.log(`[Funnel] Connected to funnel database '${funnelDbName}' (read-only use)`);
        return funnelDb;
      } catch (err) {
        console.warn(`[Funnel] Funnel database not reachable (${err.message}). Flows fall back to definitions only.`);
        await client.close().catch(() => {});
        return null;
      } finally {
        funnelConnecting = null;
      }
    })();
    return funnelConnecting;
  }

  // Stage events are rebuilt from the source at most once a minute and shared by every endpoint.
  let cache = null; // { at, events }
  let building = null;
  async function stageEvents() {
    const db = getSourceDb();
    if (!db) throw new Error('Rush database is not connected');
    if (cache && Date.now() - cache.at < 60_000) return cache;
    if (!building) {
      building = deriveStageEvents(db)
        .then((events) => (cache = { at: Date.now(), events }))
        .finally(() => { building = null; });
    }
    return building;
  }

  /** offer_sent events from the funnel's own database. null = it could not be read. */
  async function offerEvents() {
    try {
      const fdb = await getFunnelDb();
      if (!fdb) return null;
      const rows = await fdb.collection('funnel_events').find({ stageId: 'offer_sent' }).project({ contactKey: 1, contactPhone: 1, timestamp: 1, _id: 0 }).toArray();
      return rows
        .map((r) => ({ stageId: 'offer_sent', contactKey: r.contactKey ?? r.contactPhone, timestamp: toMs(r.timestamp) }))
        .filter((e) => e.contactKey && Number.isFinite(e.timestamp));
    } catch {
      return null;
    }
  }

  function windowFrom(req, res) {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from === 'invalid' || to === 'invalid') {
      res.status(400).json({ success: false, error: 'from and to must be dates like 2026-10-01' });
      return null;
    }
    const now = new Date();
    const window = { from: from ?? new Date(now.getTime() - 30 * DAY), to: to ?? new Date(now.getTime() + DAY) };
    if (window.from >= window.to) {
      res.status(400).json({ success: false, error: 'from must be before to' });
      return null;
    }
    return window;
  }

  const unavailable = (res, err, what) => {
    console.warn(`[Funnel] ${what}: ${err.message}`);
    res.status(503).json({ success: false, error: `Could not read the data for ${what}. No numbers are shown rather than wrong ones.` });
  };

  /** Funnel definition: stage names and free-wash day thresholds. Dashboard presentation only, so it never affects sends. */
  async function readDefinition() {
    try {
      const fdb = await getFunnelDb();
      const doc = fdb ? await fdb.collection('funnel_dashboard_config').findOne({ _id: 'funnel_definition' }) : null;
      if (doc) return { ...validateDefinition(doc), custom: true };
    } catch {
      /* fall through to the defaults */
    }
    return { ...DEFAULT_DEFINITION, custom: false };
  }

  const TEMPLATE_CATALOG = [
    {
        "id": "payment_failed_b",
        "name": "payment_failed_b",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "💳 اشتراكك في رش يحتاج خطوة بسيطة!\n\nتعذّر سحب رسوم التجديد من بطاقتك.\n\n⚡ حدّث بيانات الدفع الآن وخلّ اشتراكك يستمر بدون انقطاع!",
        "buttons": [
            "حدّث الدفع"
        ]
    },
    {
        "id": "renewal_reminder_a",
        "name": "renewal_reminder_a",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "💰 وفّرت{{1}} ريال مع رش!\n\n🚘✨ غسلت سيارتك{{2}} مرات هذا الشهر، ودفعت أقل لأن اشتراكك غير محدود!\n\n⚡ اشتراكك يتجدد تلقائياً بعد 5 أيام.. ووفّر أكثر مع كل غسلة!",
        "buttons": []
    },
    {
        "id": "usage_nudge_b",
        "name": "usage_nudge_b",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "⚡ جدولك زحمة؟ اللمعة ما تعطلك!\n\n🚘✨ مع رش، غسيل غير محدود خلال دقائق وبدون تكلفة إضافية!\n\nمرّ علينا وكمّل مشاويرك بلمعة!",
        "buttons": [
            "زيارة الفرع"
        ]
    },
    {
        "id": "usage_nudge_a",
        "name": "usage_nudge_a",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "🚘 سيارتك نظيفة على طول مع رش!\n\n✨ اشتراكك يمنحك غسيل غير محدود، يعني تقدر تزورنا وقت ما تحب، بدون أي تكلفة إضافية!\n\n❤️ ننتظرك في رش!",
        "buttons": [
            "زيارة الموقع"
        ]
    },
    {
        "id": "free_interior_wash_reminder",
        "name": "free_interior_wash_reminder",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "⏰ غسلتك الداخلية المجانية بتنتهي خلال 48 ساعة!\n\n🎁 هديتك من رش بانتظارك!\n\n🚘 زرنا واستمتع بالتنظيف الداخلي مجاناً قبل انتهاء العرض.",
        "buttons": [
            "زيارة الفرع"
        ]
    },
    {
        "id": "free_interior_subscription_reminder",
        "name": "free_interior_subscription_reminder",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "⏰ باقي 48 ساعة على انتهاء هديتك!\n\n🎁 اشترك بإحدى باقات رش الخارجية واحصل على شهر تنظيف داخلي غير محدود مجاناً!\n\n🚘 لا تفوّت العرض!",
        "buttons": [
            "اشترك الآن"
        ]
    },
    {
        "id": "free_interior",
        "name": "free_interior",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "🎁 غسلة داخلية مجانية لسيارتك!\n\n🚘 جرّب نظافة رش الداخلية على حسابنا!\n\n⏳ استفد من هديتك خلال 7 أيام.",
        "buttons": [
            "زيارة الفرع"
        ]
    },
    {
        "id": "free_interior_membership",
        "name": "free_interior_membership",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "🎁 اشترك بالخارجي والداخلي علينا!\n\n🚘 احصل على شهر تنظيف داخلي غير محدود مجاناً عند اشتراكك في إحدى باقات رش!\n\n⏳ العرض صالح لمدة 7 أيام فقط.",
        "buttons": [
            "اشتراك الان"
        ]
    },
    {
        "id": "50_sar_reminder_b",
        "name": "50_sar_reminder_b",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "🚘 اغسل سيارتك بـ 9 ريالات فقط!\n\n🎁 استخدم رصيدك 50 ريال من رش قبل إلغائه خلال 48 ساعة!",
        "buttons": [
            "زيارة الفرع"
        ]
    },
    {
        "id": "50_sar_reminder_a",
        "name": "50_sar_reminder_a",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "⚠️ لا تخسر رصيدك!\n\n🎁 50 ريال في محفظتك من رش، راح تُلغى تلقائياً خلال 48 ساعة!\n\n🚘 اغسل سيارتك واستفد منها قبل ما تنتهي.",
        "buttons": [
            "زيارة الفرع"
        ]
    },
    {
        "id": "50_sar_a",
        "name": "50_sar_a",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "🎁 أضفنا لك 50 ريال في محفظتك!\n\nرصيد هدية من رش تقدر تستخدمه في غسيل سيارتك 🚘\n\n⏳ الرصيد صالح لمدة 7 أيام فقط، لا تفوّت الفرصة!",
        "buttons": [
            "زيارة الموقع"
        ]
    },
    {
        "id": "cloudy_weather",
        "name": "cloudy_weather",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "☁️ الجو مغيّم ومتردد تغسل سيارتك؟\n\nمع رش، لا تشيل هم الجو! 🌦️\nاغسل سيارتك وقت ما تبي، وخلّها نظيفة مهما تغيّر الجو.\n\n🔥 اشترك الآن بأي باقة بـ 100 ريال شهرياً لأول شهرين!",
        "buttons": [
            "اشترك الآن"
        ]
    },
    {
        "id": "100_sar_a",
        "name": "100_sar_a",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "يا هلا ومسهلا! 💎\nودّك توفّر وموترك دايم نظيف؟\nاشترك في أي باقة تناسبك في رش واش واستمتع بغسيل لا محدود بـ 100 ريال/شهر بس لأول شهرين كاملين!",
        "buttons": [
            "أي باقة بـ 100 ريال"
        ]
    },
    {
        "id": "redemption_reminder_b",
        "name": "redemption_reminder_b",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "هلا والله! 🚗✨\nودّك بحماية ولمعة نانو لموترك مجاناً؟\nباقي 48 ساعة وينتهي كودك FIRSTWASH في رش واش (+ تنظيف داخلي كامل). مرنا اليوم!",
        "buttons": [
            "توجّه للفرع الآن"
        ]
    },
    {
        "id": "freewash_redemption_reminder",
        "name": "freewash_redemption_reminder",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "يا هلا! ⏰🚗\nباقي 48 ساعة بس على كود FIRSTWASH!\nمر رش واش وعط موترك لمعة وحماية النانو + تنظيف داخلي مجاناً. ✨",
        "buttons": [
            "توجّه للفرع الآن"
        ]
    },
    {
        "id": "firstwash",
        "name": "firstwash",
        "language": "ar",
        "category": "marketing",
        "status": "APPROVED",
        "body": "حياك الله في رش! غسلتك الأولى علينا. استخدم الرمز FIRSTWASH عند مسار المبيعات خلال ٧ أيام واستمتع بغسلة نانو + تنظيف داخلي مجاناً.",
        "buttons": [
            "Visit website"
        ]
    },
    {
        "id": "wash_reminder",
        "name": "wash_reminder",
        "language": "en",
        "category": "marketing",
        "status": "APPROVED",
        "body": "عزيزي المشترك، سيارتك تستاهل تلمع دايمًا! اشتراكك في رش واش لا محدود. مرّ علينا اليوم واستمتع بغسيل سريع خلال دقائق. نسعد بزيارتك.",
        "buttons": []
    },
    {
        "id": "renewal_payment_failed_ar",
        "name": "renewal_payment_failed_ar",
        "language": "ar",
        "category": "utility",
        "status": "APPROVED",
        "body": "مرحباً {{1}}،\n\nلم نتمكن من إتمام تجديد اشتراكك في رش واش.\n\nالباقة: {{2}}\nالمركبة: {{3}}\nالمبلغ: {{4}} ريال\n\nيرجى تحديث وسيلة الدفع قبل {{5}} عبر الزر أدناه.\n\nنحن هنا لمساعدتك، ما عليك سوى الرد على هذه الرسالة.\n\nرش واش",
        "buttons": [
            "تحديث وسيلة الدفع"
        ]
    },
    {
        "id": "tailscale_unreachable",
        "name": "tailscale_unreachable",
        "language": "en",
        "category": "utility",
        "status": "APPROVED",
        "body": "Service alert for your account: the {{1}} connection is currently unreachable as of {{2}}. Please check the status and take action to restore access.",
        "buttons": []
    },
    {
        "id": "family_plan",
        "name": "family_plan",
        "language": "ar",
        "category": "marketing",
        "status": "APPROVED",
        "body": "سيارات أكثر.. توفير أكثر!\n\nاجمع سيارات الأهل والأصدقاء في رش، حتى ٥ سيارات، واستمتع بخصم يزيد مع كل سيارة إضافية ويصل إلى ٣٥٪؜.\n\nلكل سيارة اشتراكها الخاص بغسيل غير محدود، والخصم يُطبّق على اشتراكات السيارات الإضافية.\n\nأضف السيارات بسهولة عبر موقع رش",
        "buttons": [
            "وفّر أكثر الآن"
        ]
    },
    {
        "id": "national_day_offer_summary_utility",
        "name": "national_day_offer_summary_utility",
        "language": "ar",
        "category": "utility",
        "status": "APPROVED",
        "body": "عزيزي العميل،\n\nملخص اشتراكك في رش واش للسيارة ذات اللوحة ({{1}}): أكملت {{2}} غسلات حتى الآن بوفر قدره {{3}} ريال، وموعد تجديد اشتراكك القادم هو {{4}}.\n\nمع خالص التحية،\nرش واش",
        "buttons": []
    },
    {
        "id": "national_day_offer_summary",
        "name": "national_day_offer_summary",
        "language": "ar",
        "category": "marketing",
        "status": "APPROVED",
        "body": "عزيزي العميل،\n\nشكراً لاختيارك رش واش عبر عرض اليوم الوطني لسيارتك ذات اللوحة ({{1}}).\n\nأكملت سيارتك {{2}} غسلات حتى الآن محققاً وفراً قدره {{3}} ريال، وموعد تجديد اشتراكك القادم هو بتاريخ {{4}}.\n\nنسعد دائماً بخدمتك في المسار السريع!\n\nمع خالص التحية،\nرش واش",
        "buttons": []
    },
    {
        "id": "winback_25",
        "name": "winback_25",
        "language": "ar",
        "category": "marketing",
        "status": "APPROVED",
        "body": "فقدت اللمعة؟\n\nرجّع اشتراكك في رش وخذ خصم 25% شهريًا لمدة 6 أشهر.\n\nاستخدم كود الخصم: {{1}}\nوفعّل اشتراكك من موقعنا rush.com.sa أو زُر مسار المبيعات.",
        "buttons": [
            "لإعادة الاشتراك"
        ]
    },
    {
        "id": "no_wash",
        "name": "no_wash",
        "language": "en",
        "category": "utility",
        "status": "APPROVED",
        "body": "Hello {{1}}, this is an update regarding your active subscription with Rush. Your plan includes unlimited washes, valid through {{2}} , 2026",
        "buttons": [
            "Opt Out"
        ]
    },
    {
        "id": "otp",
        "name": "otp",
        "language": "en",
        "category": "authentication",
        "status": "APPROVED",
        "body": "*{{1}}* is your verification code. For your security, do not share this code.",
        "buttons": [
            "Copy code"
        ]
    },
    {
        "id": "firstwash_bulk",
        "name": "firstwash_bulk",
        "language": "ar",
        "category": "marketing",
        "status": "APPROVED",
        "body": "حياك الله في رش! غسلتك الأولى علينا. استخدم الرمز {{1}} عند مسار المبيعات خلال ٧ أيام واستمتع بغسلة نانو مجانية.",
        "buttons": []
    }
];

  // GET /api/funnel/templates -> list of approved WhatsApp templates with copy
  app.get('/api/funnel/templates', (req, res) => {
    res.json({ success: true, data: TEMPLATE_CATALOG });
  });

  app.get('/api/funnel/definition', async (req, res) => {
    const fdb = await getFunnelDb();
    res.json({ success: true, data: { ...(await readDefinition()), editable: fdb !== null } });
  });

  app.put('/api/funnel/definition', async (req, res) => {
    try {
      const def = validateDefinition(req.body);
      const fdb = await getFunnelDb();
      if (!fdb) return res.status(503).json({ success: false, error: 'The funnel database is not reachable, so nothing was saved.' });
      await fdb.collection('funnel_dashboard_config').updateOne({ _id: 'funnel_definition' }, { $set: { ...def, updatedAt: new Date() } }, { upsert: true });
      res.json({ success: true, data: { ...def, custom: true, editable: true } });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ success: false, error: err.message });
      unavailable(res, err, 'saving the funnel definition');
    }
  });

  app.delete('/api/funnel/definition', async (req, res) => {
    try {
      const fdb = await getFunnelDb();
      if (!fdb) return res.status(503).json({ success: false, error: 'The funnel database is not reachable, so nothing was changed.' });
      await fdb.collection('funnel_dashboard_config').deleteOne({ _id: 'funnel_definition' });
      res.json({ success: true, data: { ...DEFAULT_DEFINITION, custom: false, editable: true } });
    } catch (err) {
      unavailable(res, err, 'resetting the funnel definition');
    }
  });

  // PUT /api/funnel/flows/:id/draft  -> saves an edited flow as a DRAFT. The live flow is never changed here.
  // DELETE /api/funnel/flows/:id/draft -> discards the draft.
  const flowFilter = (id) => ({ $or: [{ id }, { _id: id }] });
  async function liveFlowOrFail(res, id) {
    const fdb = await getFunnelDb();
    if (!fdb) {
      res.status(503).json({ success: false, error: 'The funnel database is not reachable, so flows cannot be edited right now.' });
      return null;
    }
    const doc = await fdb.collection('funnel_flows').findOne(flowFilter(id));
    if (!doc) {
      res.status(404).json({ success: false, error: 'This flow is not in the funnel database, so it cannot be edited here.' });
      return null;
    }
    return { fdb, doc };
  }

  app.put('/api/funnel/flows/:id/draft', async (req, res) => {
    try {
      const found = await liveFlowOrFail(res, req.params.id);
      if (!found) return;
      const draft = validateFlowDraft(req.body, found.doc);
      await found.fdb.collection('funnel_flows').updateOne({ _id: found.doc._id }, { $set: { draft, hasDraft: true, draftUpdatedAt: new Date() } });
      res.json({ success: true, data: { id: req.params.id, hasDraft: true, draft } });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ success: false, error: err.message });
      unavailable(res, err, 'saving the draft');
    }
  });

  // POST /api/funnel/flows/:id/publish  -> applies the saved draft to the live flow. Starting a paused flow needs { confirmStart: true }.
  app.post('/api/funnel/flows/:id/publish', async (req, res) => {
    try {
      const found = await liveFlowOrFail(res, req.params.id);
      if (!found) return;
      if (!found.doc.draft) return res.status(409).json({ success: false, error: 'There is no saved draft to publish.' });
      // Re-validate: a draft is never trusted just because it was stored.
      const draft = validateFlowDraft(found.doc.draft, found.doc);
      if (draft.status === 'running' && found.doc.status !== 'running' && req.body?.confirmStart !== true) {
        return res.status(409).json({ success: false, code: 'confirm_start', error: 'Publishing will start this flow and begin sending WhatsApp messages. Confirm to continue.' });
      }
      const { name, description, status, window, volume, reentry, approveFirstBatch, steps, trigger, exitWhen, maxReminders } = draft;
      const $set = { name, description, status, window, volume, reentry, approveFirstBatch, steps, exitWhen, hasDraft: false, publishedAt: new Date() };
      const $unset = { draft: '', draftUpdatedAt: '' };
      if (trigger) $set.trigger = trigger;
      else $unset.trigger = '';
      if (maxReminders !== undefined) $set.maxReminders = maxReminders;
      else $unset.maxReminders = '';
      await found.fdb.collection('funnel_flows').updateOne({ _id: found.doc._id }, { $set, $unset });
      res.json({ success: true, data: { id: req.params.id, hasDraft: false } });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ success: false, error: `The draft cannot be published: ${err.message}` });
      unavailable(res, err, 'publishing the draft');
    }
  });

  app.delete('/api/funnel/flows/:id/draft', async (req, res) => {
    try {
      const found = await liveFlowOrFail(res, req.params.id);
      if (!found) return;
      await found.fdb.collection('funnel_flows').updateOne({ _id: found.doc._id }, { $unset: { draft: '', draftUpdatedAt: '' }, $set: { hasDraft: false } });
      res.json({ success: true, data: { id: req.params.id, hasDraft: false } });
    } catch (err) {
      unavailable(res, err, 'discarding the draft');
    }
  });

  // GET /api/funnel/graph?from=&to=&includeHistorical=  -> numbers for the Membership Funnel chart + the strict cohort funnel
  app.get('/api/funnel/graph', async (req, res) => {
    const window = windowFrom(req, res);
    if (!window) return;
    try {
      const now = new Date();
      const db = getSourceDb();
      const [{ events, at }, offers, fdb] = await Promise.all([stageEvents(), offerEvents(), getFunnelDb()]);

      let messages = null;
      if (fdb) {
        try {
          messages = await fdb.collection('funnel_messages').find({ createdAt: { $gte: window.from, $lt: window.to } }).project({ templateId: 1, status: 1, createdAt: 1, _id: 0 }).toArray();
        } catch {
          messages = null;
        }
      }

      const countPromo = (codes) =>
        codes.length === 0
          ? null
          : db.collection(SOURCES.collections.couponRedemptions).countDocuments({ couponReadableCode: { $in: codes }, redeemedAt: { $gte: window.from, $lt: window.to } });
      const [offerB, offerC, offerD] = await Promise.all([countPromo(SOURCES.promoOffers.offerB), countPromo(SOURCES.promoOffers.offerC), countPromo(SOURCES.promoOffers.offerD)]);
      const isPlaceholder = (codes) => codes.some((c) => c.includes(SOURCES.promoPlaceholderMarker));

      const all = offers ? events.concat(offers) : events;
      const graph = buildMembershipGraph({
        events: all,
        messages,
        window,
        now,
        promo: { offerB, offerC, offerD },
        promoPlaceholder: { offerB: isPlaceholder(SOURCES.promoOffers.offerB), offerC: isPlaceholder(SOURCES.promoOffers.offerC), offerD: isPlaceholder(SOURCES.promoOffers.offerD) },
        includeHistorical: req.query.includeHistorical === 'true',
        offersMeasured: offers !== null,
        definition: await readDefinition()
      });
      res.json({
        success: true,
        data: {
          ...graph,
          cohort: buildCohortFunnel(events, window),
          sources: { funnelDb: fdb !== null, messages: messages !== null, eventsAsOf: new Date(at).toISOString() }
        }
      });
    } catch (err) {
      unavailable(res, err, 'the membership funnel');
    }
  });

  // GET /api/funnel/trends?from=&to=  (at most 120 days; a longer period keeps its most recent 120 days)
  app.get('/api/funnel/trends', async (req, res) => {
    const window = windowFrom(req, res);
    if (!window) return;
    try {
      const now = Date.now();
      if (window.to.getTime() > now + DAY) window.to = new Date(now + DAY);
      const clipped = window.to.getTime() - window.from.getTime() > MAX_TREND_DAYS * DAY;
      if (clipped) window.from = new Date(window.to.getTime() - MAX_TREND_DAYS * DAY);
      const { events } = await stageEvents();
      res.json({ success: true, data: { ...buildTrends(events, window), clipped } });
    } catch (err) {
      unavailable(res, err, 'the trends');
    }
  });

  // GET /api/funnel/flows  -> the automation flows. Live from the funnel database, else the seeded definitions.
  app.get('/api/funnel/flows', async (req, res) => {
    try {
      const fdb = await getFunnelDb();
      if (fdb) {
        try {
          const [docs, settings, sent] = await Promise.all([
            fdb.collection('funnel_flows').find({}).toArray(),
            fdb.collection('funnel_settings').findOne({}, { projection: { _id: 0, killSwitch: 1, testMode: 1, quietHours: 1, frequencyCap: 1 } }),
            fdb
              .collection('funnel_messages')
              .aggregate([
                { $match: { status: { $in: [...DELIVERED_OR_BETTER] } } },
                { $group: { _id: { flowId: '$flowId', stepId: '$stepId', templateId: '$templateId' }, sent: { $sum: 1 }, lastAt: { $max: '$createdAt' } } }
              ])
              .toArray()
          ]);
          if (docs.length > 0) {
            const flows = docs
              .map(({ _id, ...f }) => {
                const id = f.id ?? String(_id);
                const name = typeof f.name === 'object' && f.name ? { en: f.name.en || id, ar: f.name.ar || '' } : { en: String(f.name || id) };
                const steps = (f.steps || []).map((s, idx) => {
                  const kind = s?.kind || (s?.waitHours != null ? 'wait' : s?.condition ? 'condition' : 'send_template');
                  const sname = typeof s?.name === 'object' && s.name ? { en: s.name.en || s.templateId || s.id || `Step ${idx+1}`, ar: s.name.ar || '' } : { en: String(s?.name || s?.templateId || s?.id || `Step ${idx+1}`) };
                  return { ...s, id: s?.id || `s${idx+1}`, kind, name: sname };
                });
                return { ...f, id, name, steps, hasDraft: !!f.draft || !!f.hasDraft };
              })
              .sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
            return res.json({
              success: true,
              data: {
                source: 'live',
                flows,
                settings: settings ?? null,
                sent: sent.map((s) => ({ ...s._id, sent: s.sent, lastAt: s.lastAt }))
              }
            });
          }
        } catch (err) {
          console.warn(`[Funnel] Could not read flows from the funnel database: ${err.message}`);
        }
      }
      res.json({ success: true, data: { source: 'seed', flows: SEED_FLOWS, settings: null, sent: [] } });
    } catch (err) {
      unavailable(res, err, 'the flows');
    }
  });
}
