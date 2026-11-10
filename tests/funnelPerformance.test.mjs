// Run with: npm test   (node --test tests/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTRIBUTION_DAYS, MIN_MATURED, buildPerformance, flowGoal, twoProportionP } from '../server/funnelPerformance.js';
import { SEED_FLOWS } from '../server/funnelSeed.js';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const day = (n) => T0 + n * DAY;
const ev = (contactKey, stageId, d) => ({ contactKey, stageId, timestamp: day(d) });
const msg = (contactKey, templateId, d, flowId = 'x', status = 'sent') => ({ contactKey, templateId, flowId, status, timestamp: day(d) });
const run = (over) =>
  buildPerformance({ events: [], messages: [], flows: SEED_FLOWS, window: { from: new Date(day(0)), to: new Date(day(60)) }, now: new Date(day(60)), ...over });
const step = (list, id) => list.find((s) => s.id === id);

test('flow goal comes from the first stop rule', () => {
  const byId = Object.fromEntries(SEED_FLOWS.map((f) => [f.id, f]));
  assert.equal(flowGoal(byId['mf-signup-coupon']), 'free_wash_redeemed');
  assert.equal(flowGoal(byId['mf-offers']), 'subscribed');
  assert.equal(flowGoal(byId['mf-reminder-b']), 'promo');
  assert.equal(flowGoal(byId['mf-usage']), null);
});

test('snapshot counts each person once, at the furthest step', () => {
  const r = run({
    events: [ev('a', 'signed_up', 0), ev('b', 'signed_up', 0), ev('b', 'free_wash_redeemed', 2), ev('c', 'signed_up', 0), ev('c', 'free_wash_redeemed', 1), ev('c', 'subscribed', 3), ev('d', 'signed_up', 59)],
    messages: [msg('a', 'firstwash', 0, 'mf-signup-coupon'), msg('b', '50_sar_a', 3, 'mf-offers')]
  });
  const s = r.snapshot;
  assert.equal(s.total, 4);
  assert.equal(s.steps.reduce((n, x) => n + (x.count ?? 0), 0), 4);
  assert.equal(step(s.steps, 'signed_up').count, 1); // d
  assert.equal(step(s.steps, 'coupon_sent').count, 1); // a
  assert.equal(step(s.steps, 'offer_b_sent').count, 1); // b
  assert.equal(step(s.steps, 'subscribed').count, 1); // c
  assert.equal(step(s.steps, 'offer_redeemed').count, null); // promo codes are not set
  assert.equal(s.expiredUnredeemed, 1); // a is past day 7; d signed up yesterday
});

test('a stage before the person signed up does not count', () => {
  const r = run({ events: [ev('a', 'subscribed', 1), ev('a', 'signed_up', 5)] });
  assert.equal(step(r.snapshot.steps, 'signed_up').count, 1);
  assert.equal(step(r.snapshot.steps, 'subscribed').count, 0);
});

test('reached counts only people who signed up in the period', () => {
  const r = run({
    events: [ev('old', 'signed_up', -10), ev('old', 'free_wash_redeemed', 1), ev('new', 'signed_up', 1), ev('new', 'free_wash_redeemed', 2)],
    messages: []
  });
  assert.equal(r.reached.cohortSize, 1);
  assert.equal(step(r.reached.steps, 'free_wash_redeemed').count, 1);
  assert.equal(r.snapshot.total, 2);
});

test('a template shared by two steps goes to the flow that sent it', () => {
  const r = run({
    events: [ev('a', 'signed_up', 0), ev('b', 'signed_up', 0), ev('c', 'signed_up', 0)],
    messages: [msg('a', '100_sar_a', 1, 'mf-offers'), msg('b', '100_sar_a', 1, 'mf-membership-offer'), msg('c', '100_sar_a', 1, 'broadcast')]
  });
  assert.equal(step(r.reached.steps, 'offer_a_sent').count, 2); // a, plus c (manual campaign: first step using the template)
  assert.equal(step(r.reached.steps, 'membership_offer_sent').count, 1); // b
});

test('goal conversion: 7-day window, maturity, already-there and untracked recipients', () => {
  const events = [];
  const messages = [];
  // 40 matured recipients, 10 convert inside the window.
  for (let i = 0; i < 40; i++) {
    events.push(ev(`m${i}`, 'signed_up', 0));
    messages.push(msg(`m${i}`, 'firstwash', 1, 'mf-signup-coupon'));
    if (i < 10) events.push(ev(`m${i}`, 'free_wash_redeemed', 1 + ATTRIBUTION_DAYS));
  }
  events.push(ev('late', 'signed_up', 0), ev('late', 'free_wash_redeemed', 1 + ATTRIBUTION_DAYS + 1)); // converted after the window
  messages.push(msg('late', 'firstwash', 1, 'mf-signup-coupon'));
  events.push(ev('before', 'signed_up', 0), ev('before', 'free_wash_redeemed', 0.5)); // had already redeemed
  messages.push(msg('before', 'firstwash', 1, 'mf-signup-coupon'));
  messages.push(msg('stranger', 'firstwash', 1, 'mf-signup-coupon')); // never signed up
  events.push(ev('fresh', 'signed_up', 55), ev('fresh', 'free_wash_redeemed', 57)); // window still open
  messages.push(msg('fresh', 'firstwash', 56, 'mf-signup-coupon'));
  messages.push(msg('m0', 'firstwash', 3, 'mf-signup-coupon')); // a second send to the same person
  messages.push(msg('m1', 'firstwash', 1, 'mf-signup-coupon', 'failed')); // failed sends are ignored

  const r = run({ events, messages });
  const t = r.templates.find((x) => x.templateId === 'firstwash');
  assert.equal(t.goal, 'free_wash_redeemed');
  assert.equal(t.sent, 45);
  assert.equal(t.recipients, 44);
  assert.equal(t.untracked, 1);
  assert.equal(t.alreadyReached, 1);
  assert.equal(t.eligible, 42);
  assert.equal(t.matured, 41);
  assert.equal(t.converted, 10);
  assert.equal(t.convertedSoFar, 11);
  assert.equal(t.rate, 24.4);
  assert.equal(t.enough, true);
  assert.equal(t.deliveredPct, null); // no delivery receipts recorded
  assert.deepEqual(r.hero.best, { templateId: 'firstwash', goal: 'free_wash_redeemed', rate: 24.4, matured: 41 });
});

test('too few matured recipients: counts shown, never ranked', () => {
  const events = [];
  const messages = [];
  for (let i = 0; i < MIN_MATURED - 1; i++) {
    events.push(ev(`p${i}`, 'signed_up', 0), ev(`p${i}`, 'free_wash_redeemed', 2));
    messages.push(msg(`p${i}`, 'firstwash', 1, 'mf-signup-coupon'));
  }
  const r = run({ events, messages });
  assert.equal(r.templates[0].enough, false);
  assert.equal(r.templates[0].rate, 100);
  assert.equal(r.hero.best, null);
});

test('promo goals and goal-less flows are not given a rate; unknown flows default to subscribed', () => {
  const r = run({
    events: [ev('a', 'signed_up', 0)],
    messages: [msg('a', '50_sar_reminder_a', 1, 'mf-reminder-b'), msg('a', 'usage_nudge_a', 1, 'mf-usage'), msg('a', 'cloudy_weather', 1, 'broadcast')]
  });
  const by = Object.fromEntries(r.templates.map((t) => [t.templateId, t]));
  assert.equal(by['50_sar_reminder_a'].goal, 'promo');
  assert.equal(by['50_sar_reminder_a'].rate, null);
  assert.equal(by.usage_nudge_a.goal, 'none');
  assert.equal(by.cloudy_weather.goal, 'subscribed');
  assert.equal(by.cloudy_weather.eligible, 1);
});

test('delivery receipts turn into delivered and read rates', () => {
  const r = run({
    events: [ev('a', 'signed_up', 0), ev('b', 'signed_up', 0)],
    messages: [msg('a', 'firstwash', 1, 'mf-signup-coupon', 'read'), msg('b', 'firstwash', 1, 'mf-signup-coupon', 'sent')]
  });
  assert.equal(r.templates[0].deliveredPct, 50);
  assert.equal(r.templates[0].readPct, 50);
});

test('unreadable funnel database: message numbers are null, stages still counted', () => {
  const r = run({ events: [ev('a', 'signed_up', 0)], messages: null });
  assert.equal(r.sources.messages, false);
  assert.equal(step(r.snapshot.steps, 'coupon_sent').count, null);
  assert.equal(step(r.snapshot.steps, 'signed_up').count, 1);
  assert.deepEqual(r.templates, []);
});

test('A/B test names a leader only when the gap is significant', () => {
  const build = (convA, convB) => {
    const events = [];
    const messages = [];
    for (let i = 0; i < 200; i++) {
      const v = i % 2 === 0 ? 'A' : 'B';
      const n = Math.floor(i / 2);
      events.push(ev(`u${i}`, 'signed_up', 0));
      messages.push(msg(`u${i}`, v === 'A' ? 'firstwash' : 'firstwash_bulk', 1, 'mf-signup-coupon'));
      if (n < (v === 'A' ? convA : convB)) events.push(ev(`u${i}`, 'free_wash_redeemed', 3));
    }
    return run({ events, messages }).abTests.find((t) => t.flowId === 'mf-signup-coupon');
  };
  const clear = build(50, 20);
  assert.equal(clear.verdict, 'leader');
  assert.equal(clear.leader, 'A');
  const close = build(30, 27);
  assert.equal(close.verdict, 'no_clear_winner');
  assert.equal(close.leader, null);
});

test('two-proportion p-value', () => {
  assert.ok(Math.abs(twoProportionP(50, 100, 20, 100) - 0.0000087) < 0.00001);
  assert.ok(Math.abs(twoProportionP(30, 100, 27, 100) - 0.638) < 0.005);
  assert.equal(twoProportionP(0, 100, 0, 100), 1);
});

test('biggest drop-off comes from the strict chain', () => {
  const r = run({
    chainStages: [
      { id: 'signed_up', count: 100, dropOffCount: 0 },
      { id: 'free_wash_redeemed', count: 40, dropOffCount: 60 },
      { id: 'subscribed', count: 5, dropOffCount: 35 }
    ]
  });
  assert.deepEqual(r.hero.dropOff, { from: 'signed_up', to: 'free_wash_redeemed', count: 60, pctLost: 60 });
});
