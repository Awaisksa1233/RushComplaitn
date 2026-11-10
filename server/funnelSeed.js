// Flow definitions ported from the Rush Funnel project (apps/api/src/flows/seed.ts and membership-seed.ts).
// Used ONLY as a fallback when the funnel database cannot be read: the /funnel page then still shows what each
// flow does, clearly marked as "definitions only". Every flow here is paused, exactly as the funnel seeds them.

const allDays = [0, 1, 2, 3, 4, 6]; // Sun-Thu + Sat; Friday off by default
const base = { volume: { perHour: 50, perDay: 300 }, window: { days: allDays, startHour: 10, endHour: 20 } };

const send = (id, en, templateId, variants) => ({
  id, kind: 'send_template', name: { en }, templateId: variants ? variants[0].templateId : templateId, ...(variants ? { variants } : {}), paused: false
});
const wait = (id, hours, en) => ({ id, kind: 'wait', name: { en }, waitHours: hours, paused: false });
const ab = (a, b) => [{ key: 'A', templateId: a, weight: 50 }, { key: 'B', templateId: b, weight: 50 }];
const flow = (f) => ({ ...base, status: 'paused', approveFirstBatch: true, hasDraft: false, audience: { count: 0, overlap: 0, measured: false }, ...f });

const entitled = { type: 'has_entitled_subscription' };
const reached = (stageId) => ({ type: 'stage_reached', stageId });

export const SEED_FLOWS = [
  flow({
    id: 'welcome', number: 1,
    name: { en: 'Welcome and free-wash reminder' },
    description: { en: 'Welcomes new sign-ups and reminds them to use the free wash.' },
    trigger: { type: 'event', stageId: 'signed_up', maxAgeHours: 72 },
    exitWhen: [reached('free_wash_redeemed'), entitled], reentry: 'once',
    steps: [
      send('w1', 'Welcome message', 'welcome_v1'),
      wait('w2', 48, 'Wait 2 days'),
      send('w3', 'Reminder 1', 'free_wash_reminder_1'),
      wait('w4', 72, 'Wait 3 days'),
      send('w5', 'Reminder 2', 'free_wash_reminder_2')
    ]
  }),
  flow({
    id: 'free-wash-offer', number: 2,
    name: { en: 'Free wash to offer (A/B)' },
    description: { en: 'One day after the free wash, sends offer A or B. Only a subscription counts as conversion; a 2nd wash alone keeps them in the sequence.' },
    trigger: { type: 'event', stageId: 'free_wash_redeemed', maxAgeHours: 72 },
    exitWhen: [reached('subscribed'), entitled], reentry: 'once',
    steps: [
      wait('o1', 24, 'Wait 1 day'),
      { id: 'o2', kind: 'ab_split', name: { en: 'Split into offer A / B' }, paused: false },
      send('o3', 'Send the offer', null, ab('offer_a_v1', 'offer_b_v1')),
      wait('o4', 48, 'Wait 2 days'),
      send('o5', 'Reminder if no reply', 'offer_reminder_v1')
    ]
  }),
  flow({
    id: 'new-plate', number: 3,
    name: { en: 'New-plate promo' },
    description: { en: 'Shiny/Nano 2-month promo at 100 SAR for plates with no prior subscription.' },
    trigger: { type: 'segment', segment: 'voucher_issued_unredeemed' },
    exitWhen: [reached('subscribed'), entitled], reentry: 'once',
    steps: [
      { id: 'n1', kind: 'condition', name: { en: 'Check the plate is new' }, paused: false },
      send('n2', 'Send the promo', 'new_plate_promo_v1')
    ]
  }),
  flow({
    id: 'renewal-reminder', number: 4, approveFirstBatch: false,
    name: { en: 'Renewal reminder (day 23)' },
    description: { en: 'Day 23 after membership start or last payment: reminds the member of their upcoming renewal and shows how many times they washed and how much they saved (SAR).' },
    trigger: { type: 'segment', segment: 'renewal_due_5d' },
    exitWhen: [reached('first_full_renewal')], reentry: 'per_cycle',
    steps: [
      wait('r1', 552, 'Wait until day 23 (start / last payment)'),
      send('r2', 'Renewal reminder (washes & savings summary)', 'national_day_offer_summary_utility')
    ]
  }),
  flow({
    id: 'renewal-result', number: 5, approveFirstBatch: false,
    name: { en: 'Renewal result' },
    description: { en: 'Passed: thank-you, member goes back to usage nudges. Failed: handed to payment rescue.' },
    trigger: { type: 'event', stageId: 'first_full_renewal', maxAgeHours: 72 },
    exitWhen: [], reentry: 'per_cycle',
    steps: [
      { id: 'rr1', kind: 'condition', name: { en: 'Did the renewal payment pass?' }, paused: false },
      send('rr2', 'Thank-you (passed)', 'renewal_thanks_v1')
    ]
  }),
  flow({
    id: 'usage-nudge', number: 6, approveFirstBatch: false,
    name: { en: 'Usage nudge (7 days)' },
    description: { en: 'Friendly nudge for active members with no wash in 7 days.' },
    trigger: { type: 'segment', segment: 'inactive_7d' },
    exitWhen: [], reentry: 'per_cycle',
    steps: [send('u1', 'Nudge message', 'usage_nudge_v1')]
  }),
  flow({
    id: 'upsell-ff', number: 7,
    name: { en: 'Upsell / Friends & Family' },
    description: { en: 'Upgrade or add-a-car message. Members only get the Friends & Family pricing.' },
    trigger: { type: 'segment', segment: 'inactive_14d' },
    exitWhen: [entitled], reentry: 'per_cycle',
    steps: [send('f1', 'Upgrade or add-a-car', 'upsell_ff_v1')]
  }),
  flow({
    id: 'cancel-save', number: 8, approveFirstBatch: false,
    name: { en: 'Cancellation save' },
    description: { en: 'Tenure-based save offer when a member asks to cancel.' },
    trigger: { type: 'segment', segment: 'cancelled_still_valid' },
    exitWhen: [entitled], reentry: 'per_cycle',
    steps: [
      { id: 'c1', kind: 'grant_offer', name: { en: 'Grant the save offer' }, paused: false },
      send('c2', 'Send the save message', 'cancel_save_v1')
    ]
  }),
  flow({
    id: 'winback', number: 9,
    name: { en: 'Winback' },
    description: { en: '25% off for cancelled members. Reminder after 7 days; stops after 2 messages.' },
    trigger: { type: 'segment', segment: 'expired_no_active' },
    exitWhen: [entitled], reentry: 'once',
    steps: [
      { id: 'b1', kind: 'grant_offer', name: { en: 'Grant 25% winback' }, paused: false },
      send('b2', 'Winback message', 'winback_v1'),
      wait('b3', 168, 'Wait 7 days'),
      send('b4', 'Winback reminder', 'winback_v2')
    ]
  }),
  flow({
    id: 'payment-rescue', number: 10, approveFirstBatch: false,
    name: { en: 'Payment rescue messages' },
    description: { en: 'Update-card message after a failed payment; stops when payment recovers.' },
    trigger: { type: 'segment', segment: 'renewal_failed' },
    exitWhen: [entitled], reentry: 'per_cycle',
    steps: [
      send('p1', 'Update-card message', 'payment_failed_v1'),
      wait('p2', 72, 'Wait 3 days'),
      send('p3', 'Second reminder', 'payment_failed_v2')
    ]
  }),

  // ---- Membership Funnel flows ----
  flow({
    id: 'mf-signup-coupon', number: 11,
    name: { en: 'Membership: free-wash coupon' },
    description: { en: 'Right after sign-up, sends the free-wash coupon (A/B test of two messages). Stops once the free wash is used.' },
    trigger: { type: 'event', stageId: 'signed_up', maxAgeHours: 72 },
    exitWhen: [reached('free_wash_redeemed'), entitled], reentry: 'once',
    steps: [send('m1', 'Free-wash coupon', null, ab('firstwash', 'firstwash_bulk'))]
  }),
  flow({
    id: 'mf-signup-remind', number: 12,
    name: { en: 'Membership: free-wash reminder (day 5)' },
    description: { en: 'Day 5 after sign-up, if the free wash is still unused, sends a reminder (A/B test). Stops as soon as it is used.' },
    trigger: { type: 'event', stageId: 'signed_up', maxAgeHours: 72 },
    exitWhen: [reached('free_wash_redeemed'), entitled], reentry: 'once',
    steps: [wait('m2w', 120, 'Wait until day 5'), send('m2', 'Free-wash reminder', null, ab('freewash_redemption_reminder', 'redemption_reminder_b'))]
  }),
  flow({
    id: 'mf-offers', number: 13,
    name: { en: 'Membership: offers A / B / C' },
    description: { en: 'After the free wash is used, sends one of three offers (3-way split): A 96 SAR, B 50 SAR wallet balance, C free interior on the next visit. Stops once they subscribe.' },
    trigger: { type: 'event', stageId: 'free_wash_redeemed', maxAgeHours: 72 },
    exitWhen: [reached('subscribed'), entitled], reentry: 'once',
    steps: [
      send('m3', 'Offer A / B / C', null, [
        { key: 'A', templateId: '100_sar_a', weight: 34 },
        { key: 'B', templateId: '50_sar_a', weight: 33 },
        { key: 'C', templateId: 'free_interior', weight: 33 }
      ])
    ]
  }),
  flow({
    id: 'mf-reminder-b', number: 14,
    name: { en: 'Membership: Offer B reminder' },
    description: { en: '48 hours after Offer B (50 SAR wallet balance) was sent, reminds the customer if the promo code has not been redeemed. Needs the real promo code.' },
    trigger: { type: 'offer_sent', templateIds: ['50_sar_a'], fromFlowId: 'mf-offers', maxAgeHours: 72 },
    exitWhen: [{ type: 'promo_redeemed', offers: ['offerB'] }, entitled], reentry: 'once',
    steps: [wait('m4w', 48, 'Wait 2 days'), send('m4', 'Offer B reminder', null, ab('50_sar_reminder_a', '50_sar_reminder_b'))]
  }),
  flow({
    id: 'mf-reminder-c', number: 15,
    name: { en: 'Membership: Offer C reminder' },
    description: { en: '48 hours after Offer C (free interior visit) was sent, reminds the customer if the promo code has not been redeemed. Needs the real promo code.' },
    trigger: { type: 'offer_sent', templateIds: ['free_interior'], fromFlowId: 'mf-offers', maxAgeHours: 72 },
    exitWhen: [{ type: 'promo_redeemed', offers: ['offerC'] }, entitled], reentry: 'once',
    steps: [wait('m5w', 48, 'Wait 2 days'), send('m5', 'Offer C reminder', null, ab('free_interior_wash_reminder', 'free_interior_subscription_reminder'))]
  }),
  flow({
    id: 'mf-membership-offer', number: 16,
    name: { en: 'Membership: membership offer' },
    description: { en: 'When a customer redeems Offer B or C, sends the membership offer (A/B test). Stops once they subscribe. Needs the real promo codes.' },
    trigger: { type: 'promo_redeemed', offers: ['offerB', 'offerC'], maxAgeHours: 72 },
    exitWhen: [reached('subscribed'), entitled], reentry: 'once',
    steps: [send('m6', 'Membership offer', null, ab('free_interior_membership', '100_sar_a'))]
  }),
  flow({
    id: 'mf-membership-remind', number: 17,
    name: { en: 'Membership: membership offer reminder' },
    description: { en: '48 hours after the membership offer was sent, reminds the customer if they have not subscribed (A/B test).' },
    trigger: { type: 'offer_sent', templateIds: ['free_interior_membership', '100_sar_a'], fromFlowId: 'mf-membership-offer', maxAgeHours: 72 },
    exitWhen: [reached('subscribed'), entitled], reentry: 'once',
    steps: [wait('m7w', 48, 'Wait 2 days'), send('m7', 'Membership reminder', null, ab('freewash_redemption_reminder', 'redemption_reminder_b'))]
  }),
  flow({
    id: 'mf-usage', number: 18,
    name: { en: 'Membership: weekly usage nudge' },
    description: { en: 'Every week, active members with under 2 washes in the last 7 days get a nudge (A/B test). 4 days later, anyone who still has not washed gets one follow-up.' },
    trigger: { type: 'segment', segment: 'under_2_washes_7d' },
    exitWhen: [], reentry: 'per_cycle',
    steps: [
      send('u1', 'Usage nudge', null, ab('usage_nudge_a', 'usage_nudge_b')),
      wait('u2', 96, 'Wait 4 days'),
      { id: 'u3', kind: 'condition', name: { en: 'Still no wash since the nudge?' }, paused: false, condition: { check: { type: 'days_since_last_wash', moreThan: 4 }, yes: 'u4', no: null } },
      send('u4', 'Usage follow-up', null, ab('usage_nudge_a', 'usage_nudge_b'))
    ]
  })
];
