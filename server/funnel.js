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
  promoOffers: { offerB: ['WALLET50-PLACEHOLDER'], offerC: ['INTERIOR-PLACEHOLDER'] },
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
const FREE_WASH_REMINDER_DAY = 5;
const FREE_WASH_EXPIRY_DAY = 7;
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
function buildMembershipGraph({ events, messages, window, now, promo, promoPlaceholder, includeHistorical, offersMeasured }) {
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
  for (const k of ['offerB', 'offerC']) {
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
      const [offerB, offerC] = await Promise.all([countPromo(SOURCES.promoOffers.offerB), countPromo(SOURCES.promoOffers.offerC)]);
      const isPlaceholder = (codes) => codes.some((c) => c.includes(SOURCES.promoPlaceholderMarker));

      const all = offers ? events.concat(offers) : events;
      const graph = buildMembershipGraph({
        events: all,
        messages,
        window,
        now,
        promo: { offerB, offerC },
        promoPlaceholder: { offerB: isPlaceholder(SOURCES.promoOffers.offerB), offerC: isPlaceholder(SOURCES.promoOffers.offerC) },
        includeHistorical: req.query.includeHistorical === 'true',
        offersMeasured: offers !== null
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
              .map(({ _id, draft, ...f }) => ({ ...f, id: f.id ?? String(_id), hasDraft: !!f.hasDraft }))
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
