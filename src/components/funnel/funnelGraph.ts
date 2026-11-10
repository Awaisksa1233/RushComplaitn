/**
 * The SHAPE of the Membership Funnel chart: steps, arrows and the WhatsApp template each A/B variant sends.
 * Ported from the Rush Funnel project (apps/dashboard/src/lib/membershipFunnelGraph.ts + packages/shared templates).
 * It holds no numbers: counts come from GET /api/funnel/graph and anything not measured shows a dash.
 */

export type MfSide = 'top' | 'bottom' | 'left' | 'right';
export type MfTone = 'success' | 'neutral' | 'danger';

export interface MfVariant {
  label: string;
  /** WhatsApp template id. Approved ones are in APPROVED_TEMPLATES; the rest still need to be submitted. */
  template: string;
}

export interface MfNode {
  id: string;
  /** step = a message; milestone = a fixed point customers pass; start/end are fixed. */
  kind: 'start' | 'step' | 'milestone' | 'end';
  title: string;
  when?: string;
  stage?: 1 | 2 | 3 | 4;
  x: number;
  y: number;
  variants?: MfVariant[];
  tone?: MfTone;
}

export interface MfEdge {
  id: string;
  from: string;
  fromSide: MfSide;
  to: string;
  toSide: MfSide;
  /** Empty string = no label. */
  label: string;
  tone: MfTone;
}

const v = (label: string, template: string): MfVariant => ({ label, template });

export const MF_NODES: MfNode[] = [
  { id: 'signup', kind: 'start', title: 'Sign-up', x: 0, y: 0 },
  {
    id: 's1issue', kind: 'step', stage: 1, title: 'Free wash issuance', when: 'Right after sign-up', x: 0, y: 110,
    variants: [v('Instant app QR / WhatsApp push', 'firstwash'), v('SMS deep link + expiry countdown', 'firstwash_bulk')]
  },
  {
    id: 's1remind', kind: 'step', stage: 1, title: 'Free wash reminder', when: 'Day 5, if not redeemed', x: 340, y: 290,
    variants: [v('Copy / offer A', 'freewash_redemption_reminder'), v('Copy / offer B', 'redemption_reminder_b')]
  },
  { id: 's1dead', kind: 'end', title: 'Stage 1 dead / exit', x: 840, y: 310, tone: 'danger' },

  {
    id: 'offers', kind: 'step', stage: 2, title: 'Offers', when: 'After the free wash is redeemed', x: 0, y: 520,
    variants: [
      v('Offer A: membership', '100_sar_a'),
      v('Offer B: SAR 50 wallet balance', '50_sar_a'),
      v('Offer C: free interior on next visit', 'free_interior')
    ]
  },
  {
    id: 'remB', kind: 'step', stage: 2, title: 'Offer B reminder', when: 'If the offer is not redeemed', x: 0, y: 760,
    variants: [v('Copy A', '50_sar_reminder_a'), v('Copy B', '50_sar_reminder_b')]
  },
  {
    id: 'remC', kind: 'step', stage: 2, title: 'Offer C reminder', when: 'If the offer is not redeemed', x: 420, y: 760,
    variants: [v('Copy A', 'free_interior_wash_reminder'), v('Copy B', 'free_interior_subscription_reminder')]
  },
  { id: 'exitB', kind: 'end', title: 'Exit', x: -330, y: 790, tone: 'danger' },
  { id: 'exitC', kind: 'end', title: 'Exit', x: 840, y: 790, tone: 'danger' },
  {
    id: 'msoffer', kind: 'step', stage: 2, title: 'Membership offer', when: 'After the offer is redeemed', x: 0, y: 1000,
    variants: [v('First month flat discount / SAR 100 promo', 'free_interior_membership'), v('2-month lock-in / free upgraded wash add-on', '100_sar_a')]
  },
  {
    id: 'msremind', kind: 'step', stage: 2, title: 'Offer reminder', when: '48 hours after the offer', x: 340, y: 1180,
    variants: [v('Angle A', 'freewash_redemption_reminder'), v('Angle B', 'redemption_reminder_b')]
  },
  { id: 'msexit', kind: 'end', title: 'Downsell / exit', x: 840, y: 1200, tone: 'danger' },

  { id: 'members', kind: 'milestone', title: 'Members', x: -600, y: 1520 },
  { id: 's3scan', kind: 'step', stage: 3, title: 'Weekly scan: rolling 7-day usage', when: 'Every week, for every active member', x: -640, y: 1640 },
  {
    id: 's3nudge', kind: 'step', stage: 3, title: 'Low-usage nudge', when: 'When the weekly scan finds under 2 washes', x: -640, y: 1870,
    variants: [v('Value recap: you paid for it, do not leave SAR on the table', 'usage_nudge_a'), v('Convenience: quick lane pass recap', 'usage_nudge_b')]
  },
  {
    id: 's3follow', kind: 'step', stage: 3, title: 'Usage follow-up reminder', when: '4 days after the nudge', x: -640, y: 2110,
    variants: [v('Copy A', 'usage_nudge_a'), v('Copy B', 'usage_nudge_b')]
  },

  {
    id: 'rr', kind: 'step', stage: 4, title: 'Renewal reminder: savings recap', when: '7 days before every renewal (day 23)', x: -300, y: 1870,
    variants: [v('Copy A', 'renewal_reminder_a'), v('Copy B', 'renewal_reminder_a')]
  },
  { id: 'rd', kind: 'milestone', title: 'Renewal day', x: -260, y: 2250 },
  {
    id: 'pay', kind: 'step', stage: 4, title: 'Payment update message and retries', when: 'WhatsApp message, then a retry every day, up to 5 times', x: 60, y: 2330,
    variants: [v('Copy A', 'renewal_payment_failed_ar'), v('Copy B', 'payment_failed_b')]
  },
  { id: 'payexit', kind: 'end', title: 'Exit', x: 480, y: 2370, tone: 'danger' },
  {
    id: 'fnf', kind: 'step', stage: 4, title: 'Offer Friends & Family', when: 'After every renewal, for everyone', x: -300, y: 2540,
    variants: [v('Copy A', 'family_plan'), v('Copy B', 'family_plan')]
  }
];

const e = (id: string, from: string, fromSide: MfSide, to: string, toSide: MfSide, label: string, tone: MfTone): MfEdge => ({ id, from, fromSide, to, toSide, label, tone });

export const MF_EDGES: MfEdge[] = [
  e('e1', 'signup', 'bottom', 's1issue', 'top', '', 'neutral'),
  e('e2', 's1issue', 'right', 's1remind', 'top', 'Not redeemed by day 5', 'neutral'),
  e('e3', 's1issue', 'bottom', 'offers', 'top', 'Redeemed within 5 days', 'success'),
  e('e4', 's1remind', 'right', 's1dead', 'left', 'Not redeemed by day 7', 'danger'),
  e('e5', 's1remind', 'left', 'offers', 'top', 'Redeemed', 'success'),

  e('e6', 'offers', 'left', 'members', 'top', 'Offer A: membership', 'success'),
  e('e7', 'offers', 'bottom', 'remB', 'top', 'Offer B: SAR 50 wallet balance', 'neutral'),
  e('e8', 'offers', 'right', 'remC', 'top', 'Offer C: free interior on next visit', 'neutral'),
  e('e9', 'remB', 'bottom', 'msoffer', 'top', 'Redeemed', 'success'),
  e('e10', 'remB', 'left', 'exitB', 'right', 'Not redeemed', 'danger'),
  e('e11', 'remC', 'bottom', 'msoffer', 'top', 'Redeemed', 'success'),
  e('e12', 'remC', 'right', 'exitC', 'left', 'Not redeemed', 'danger'),

  e('e13', 'msoffer', 'left', 'members', 'top', 'Converts to member', 'success'),
  e('e14', 'msoffer', 'right', 'msremind', 'top', 'No conversion in 48 hours', 'neutral'),
  e('e15', 'msremind', 'left', 'members', 'top', 'Converts', 'success'),
  e('e16', 'msremind', 'right', 'msexit', 'left', 'No conversion', 'danger'),

  e('e17', 'members', 'bottom', 's3scan', 'top', '', 'neutral'),
  e('e18', 's3scan', 'right', 'rr', 'top', '2+ washes a week', 'success'),
  e('e19', 's3scan', 'bottom', 's3nudge', 'top', 'Under 2 washes a week', 'neutral'),
  e('e20', 's3nudge', 'right', 's3scan', 'right', 'Washes vehicle: back to usage monitor', 'success'),
  e('e21', 's3nudge', 'bottom', 's3follow', 'top', 'Still inactive after 4 days', 'neutral'),
  e('e22', 's3follow', 'left', 's3scan', 'left', 'Washes vehicle: back to usage monitor', 'success'),
  e('e23', 's3follow', 'right', 'rr', 'left', 'Still inactive', 'neutral'),

  e('e24', 'rr', 'bottom', 'rd', 'top', '', 'neutral'),
  e('e25', 'rd', 'bottom', 'fnf', 'top', 'Renewal successful', 'success'),
  e('e26', 'rd', 'right', 'pay', 'top', 'Renewal failed', 'danger'),
  e('e27', 'pay', 'bottom', 'fnf', 'right', 'Recovered', 'success'),
  e('e28', 'pay', 'right', 'payexit', 'left', 'Not recovered after 5 retries', 'danger'),
  e('e29', 'fnf', 'left', 's3scan', 'left', 'Next cycle: back to weekly scan', 'success')
];

/** Chart steps that are really one step of an automation flow, so the chart can show whether that step is on. */
export const MF_NODE_FLOW: Record<string, { flowId: string; stepId: string }> = {
  rr: { flowId: 'renewal-reminder', stepId: 'r2' },
  pay: { flowId: 'payment-rescue', stepId: 'p1' },
  s1issue: { flowId: 'mf-signup-coupon', stepId: 'm1' },
  s1remind: { flowId: 'mf-signup-remind', stepId: 'm2' },
  offers: { flowId: 'mf-offers', stepId: 'm3' },
  remB: { flowId: 'mf-reminder-b', stepId: 'm4' },
  remC: { flowId: 'mf-reminder-c', stepId: 'm5' },
  msoffer: { flowId: 'mf-membership-offer', stepId: 'm6' },
  msremind: { flowId: 'mf-membership-remind', stepId: 'm7' },
  s3nudge: { flowId: 'mf-usage', stepId: 'u1' },
  s3follow: { flowId: 'mf-usage', stepId: 'u4' }
};

/** Why a number is a dash. Keys are returned by the API in `why`. */
export const WHY_TEXT: Record<string, string> = {
  mfWhyNoOfferTracking: 'Offer B and C redemptions are tracked by promo code. Add the codes to start counting.',
  mfWhyNoUsageScan: 'The weekly usage scan is not recorded yet.',
  mfWhyNoRenewalCycle: 'Renewal-cycle messages are not recorded in this funnel yet.',
  mfWhyPromoNotConfigured: 'Promo codes not set yet.',
  mfWhyPromoPlaceholder: 'Placeholder promo code. This will count real redemptions once the code is set.',
  mfWhyNoFunnelDb: 'The funnel database could not be read, so offers sent are not counted.'
};

export type TemplateCategory = 'marketing' | 'utility' | 'service';

/** WhatsApp templates already approved in Unifonic/Meta (packages/shared/src/templates.ts in the funnel project). */
export const APPROVED_TEMPLATES: Record<string, { language: 'ar' | 'en'; category: TemplateCategory }> = {
  firstwash: { language: 'ar', category: 'marketing' },
  firstwash_bulk: { language: 'ar', category: 'marketing' },
  renewal_payment_failed_ar: { language: 'ar', category: 'utility' },
  '96_sar': { language: 'ar', category: 'marketing' },
  '96_sar_media': { language: 'ar', category: 'marketing' },
  family_plan: { language: 'ar', category: 'marketing' },
  winback_25: { language: 'ar', category: 'marketing' },
  national_day_offer_summary_utility: { language: 'ar', category: 'utility' },
  national_day_offer_summary: { language: 'ar', category: 'marketing' },
  al_jamea: { language: 'ar', category: 'marketing' },
  cloudy_weather: { language: 'en', category: 'marketing' },
  freewash_redemption_reminder: { language: 'en', category: 'marketing' },
  redemption_reminder_b: { language: 'en', category: 'marketing' },
  '100_sar_a': { language: 'en', category: 'marketing' },
  '50_sar_a': { language: 'en', category: 'marketing' },
  '50_sar_reminder_a': { language: 'en', category: 'marketing' },
  '50_sar_reminder_b': { language: 'en', category: 'marketing' },
  free_interior: { language: 'en', category: 'marketing' },
  free_interior_membership: { language: 'en', category: 'marketing' },
  free_interior_wash_reminder: { language: 'en', category: 'marketing' },
  free_interior_subscription_reminder: { language: 'en', category: 'marketing' },
  usage_nudge_a: { language: 'en', category: 'marketing' },
  usage_nudge_b: { language: 'en', category: 'marketing' },
  renewal_reminder_a: { language: 'en', category: 'marketing' },
  payment_failed_b: { language: 'en', category: 'marketing' },
  reply: { language: 'ar', category: 'service' }
};

export const isApprovedTemplate = (id: string | undefined | null) => !!id && id in APPROVED_TEMPLATES;
