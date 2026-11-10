import sys
from pathlib import Path

# Windows UTF-8 encoding
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent

# 1. Update server/funnel.js
funnel_js_path = ROOT / "server" / "funnel.js"
c = funnel_js_path.read_text(encoding='utf-8')

# promoOffers
c = c.replace(
    "promoOffers: { offerB: ['WALLET50-PLACEHOLDER'], offerC: ['INTERIOR-PLACEHOLDER'] },",
    "promoOffers: { offerB: ['WALLET50-PLACEHOLDER'], offerC: ['INTERIOR-PLACEHOLDER'], offerD: ['INTERIOR-MONTH-PLACEHOLDER'] },"
)

# OFFERS list
c = c.replace(
    "const OFFERS = ['offerB', 'offerC'];",
    "const OFFERS = ['offerB', 'offerC', 'offerD'];"
)

# variants validation
c = c.replace(
    "if (s.variants.length < 2 || s.variants.length > 3) bad(`${label}: an A/B split needs 2 or 3 variants`);",
    "if (s.variants.length < 2 || s.variants.length > 4) bad(`${label}: an A/B split needs 2, 3 or 4 variants`);"
)
c = c.replace(
    "if (!isObj(v) || v.key !== 'ABC'[j]) bad(`${label}: variants must be A, B, C in order`);",
    "if (!isObj(v) || v.key !== 'ABCD'[j]) bad(`${label}: variants must be A, B, C, D in order`);"
)

# why loop
c = c.replace(
    "for (const k of ['offerB', 'offerC']) {",
    "for (const k of ['offerB', 'offerC', 'offerD']) {"
)

# countPromo
c = c.replace(
    "const [offerB, offerC] = await Promise.all([countPromo(SOURCES.promoOffers.offerB), countPromo(SOURCES.promoOffers.offerC)]);",
    "const [offerB, offerC, offerD] = await Promise.all([countPromo(SOURCES.promoOffers.offerB), countPromo(SOURCES.promoOffers.offerC), countPromo(SOURCES.promoOffers.offerD)]);"
)
c = c.replace(
    "promo: { offerB, offerC },",
    "promo: { offerB, offerC, offerD },"
)
c = c.replace(
    "promoPlaceholder: { offerB: isPlaceholder(SOURCES.promoOffers.offerB), offerC: isPlaceholder(SOURCES.promoOffers.offerC) },",
    "promoPlaceholder: { offerB: isPlaceholder(SOURCES.promoOffers.offerB), offerC: isPlaceholder(SOURCES.promoOffers.offerC), offerD: isPlaceholder(SOURCES.promoOffers.offerD) },"
)

funnel_js_path.write_text(c, encoding='utf-8')
print("Successfully updated server/funnel.js")


# 2. Update server/funnelSeed.js
seed_path = ROOT / "server" / "funnelSeed.js"
seed = seed_path.read_text(encoding='utf-8')

old_offers_flow = """  flow({
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
  }),"""

new_offers_flow = """  flow({
    id: 'mf-offers', number: 13,
    name: { en: 'Membership: 4 Offers after Free Wash' },
    description: { en: 'After the free wash is used, sends one of four plans (4-way split): 1. 100 SAR membership, 2. 50 SAR wallet balance, 3. Free interior on next visit, 4. Free interior for whole month with membership. Stops once they subscribe.' },
    trigger: { type: 'event', stageId: 'free_wash_redeemed', maxAgeHours: 72 },
    exitWhen: [reached('subscribed'), entitled], reentry: 'once',
    steps: [
      send('m3', 'Offers (4 Plans)', null, [
        { key: 'A', templateId: '100_sar_a', weight: 25 },
        { key: 'B', templateId: '50_sar_a', weight: 25 },
        { key: 'C', templateId: 'free_interior', weight: 25 },
        { key: 'D', templateId: 'free_interior_membership', weight: 25 }
      ])
    ]
  }),"""

assert old_offers_flow in seed, "old_offers_flow not found in funnelSeed.js"
seed = seed.replace(old_offers_flow, new_offers_flow)

# Add flow mf-reminder-d right after mf-reminder-c
old_rem_c = """  flow({
    id: 'mf-reminder-c', number: 15,
    name: { en: 'Membership: Offer C reminder' },
    description: { en: '48 hours after Offer C (free interior visit) was sent, reminds the customer if the promo code has not been redeemed. Needs the real promo code.' },
    trigger: { type: 'offer_sent', templateIds: ['free_interior'], fromFlowId: 'mf-offers', maxAgeHours: 72 },
    exitWhen: [{ type: 'promo_redeemed', offers: ['offerC'] }, entitled], reentry: 'once',
    steps: [wait('m5w', 48, 'Wait 2 days'), send('m5', 'Offer C reminder', null, ab('free_interior_wash_reminder', 'free_interior_subscription_reminder'))]
  }),"""

new_rem_c_and_d = """  flow({
    id: 'mf-reminder-c', number: 15,
    name: { en: 'Membership: Offer C reminder' },
    description: { en: '48 hours after Offer C (free interior visit) was sent, reminds the customer if the promo code has not been redeemed. Needs the real promo code.' },
    trigger: { type: 'offer_sent', templateIds: ['free_interior'], fromFlowId: 'mf-offers', maxAgeHours: 72 },
    exitWhen: [{ type: 'promo_redeemed', offers: ['offerC'] }, entitled], reentry: 'once',
    steps: [wait('m5w', 48, 'Wait 2 days'), send('m5', 'Offer C reminder', null, ab('free_interior_wash_reminder', 'free_interior_subscription_reminder'))]
  }),
  flow({
    id: 'mf-reminder-d', number: 16,
    name: { en: 'Membership: Offer D reminder' },
    description: { en: '48 hours after Offer D (free interior for whole month with membership) was sent, reminds the customer if they have not subscribed.' },
    trigger: { type: 'offer_sent', templateIds: ['free_interior_membership'], fromFlowId: 'mf-offers', maxAgeHours: 72 },
    exitWhen: [reached('subscribed'), entitled], reentry: 'once',
    steps: [wait('m5dw', 48, 'Wait 2 days'), send('m5d', 'Offer D reminder', null, ab('free_interior_subscription_reminder', 'free_interior_subscription_reminder'))]
  }),"""

assert old_rem_c in seed, "old_rem_c not found in funnelSeed.js"
seed = seed.replace(old_rem_c, new_rem_c_and_d)

# Renumber subsequent flows: 16 -> 17, 17 -> 18, 18 -> 19
seed = seed.replace("id: 'mf-membership-offer', number: 16,", "id: 'mf-membership-offer', number: 17,")
seed = seed.replace("id: 'mf-membership-remind', number: 17,", "id: 'mf-membership-remind', number: 18,")
seed = seed.replace("id: 'mf-usage', number: 18,", "id: 'mf-usage', number: 19,")

seed_path.write_text(seed, encoding='utf-8')
print("Successfully updated server/funnelSeed.js")


# 3. Update src/components/funnel/funnelApi.ts
api_path = ROOT / "src" / "components" / "funnel" / "funnelApi.ts"
api = api_path.read_text(encoding='utf-8')
api = api.replace(
    "variants?: { key: 'A' | 'B' | 'C'; templateId: string; weight: number }[];",
    "variants?: { key: 'A' | 'B' | 'C' | 'D'; templateId: string; weight: number }[];"
)
api_path.write_text(api, encoding='utf-8')
print("Successfully updated funnelApi.ts")


# 4. Update src/components/funnel/FlowEditor.tsx
editor_path = ROOT / "src" / "components" / "funnel" / "FlowEditor.tsx"
ed = editor_path.read_text(encoding='utf-8')

ed = ed.replace(
    "const OFFERS: Record<string, string> = { offerB: 'Offer B', offerC: 'Offer C' };",
    "const OFFERS: Record<string, string> = { offerB: 'Offer B', offerC: 'Offer C', offerD: 'Offer D' };"
)
ed = ed.replace(
    "const resize = (n: 2 | 3) => {",
    "const resize = (n: 2 | 3 | 4) => {"
)
ed = ed.replace(
    "(['A', 'B', 'C'] as const).slice(0, n)",
    "(['A', 'B', 'C', 'D'] as const).slice(0, n)"
)
ed = ed.replace(
    "{([2, 3] as const).map((n) => (",
    "{([2, 3, 4] as const).map((n) => ("
)
editor_path.write_text(ed, encoding='utf-8')
print("Successfully updated FlowEditor.tsx")


# 5. Update src/components/funnel/FlowsPanel.tsx
panel_path = ROOT / "src" / "components" / "funnel" / "FlowsPanel.tsx"
panel = panel_path.read_text(encoding='utf-8')
panel = panel.replace(
    "const OFFER_NAME: Record<string, string> = { offerB: 'Offer B', offerC: 'Offer C' };",
    "const OFFER_NAME: Record<string, string> = { offerB: 'Offer B', offerC: 'Offer C', offerD: 'Offer D' };"
)
panel_path.write_text(panel, encoding='utf-8')
print("Successfully updated FlowsPanel.tsx")


# 6. Update src/components/funnel/funnelGraph.ts
graph_path = ROOT / "src" / "components" / "funnel" / "funnelGraph.ts"
gr = graph_path.read_text(encoding='utf-8')

old_offers_node = """  {
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
  { id: 'exitC', kind: 'end', title: 'Exit', x: 840, y: 790, tone: 'danger' },"""

new_offers_node = """  {
    id: 'offers', kind: 'step', stage: 2, title: 'Offers (4 Plans)', when: 'After the free wash is redeemed', x: 0, y: 520,
    variants: [
      v('Plan 1: 100 SAR membership', '100_sar_a'),
      v('Plan 2: SAR 50 wallet balance', '50_sar_a'),
      v('Plan 3: Free interior clean next visit', 'free_interior'),
      v('Plan 4: Free interior month w/ membership', 'free_interior_membership')
    ]
  },
  {
    id: 'remB', kind: 'step', stage: 2, title: 'Offer B reminder', when: 'If the offer is not redeemed', x: -140, y: 760,
    variants: [v('Copy A', '50_sar_reminder_a'), v('Copy B', '50_sar_reminder_b')]
  },
  {
    id: 'remC', kind: 'step', stage: 2, title: 'Offer C reminder', when: 'If the offer is not redeemed', x: 220, y: 760,
    variants: [v('Copy A', 'free_interior_wash_reminder'), v('Copy B', 'free_interior_subscription_reminder')]
  },
  {
    id: 'remD', kind: 'step', stage: 2, title: 'Offer D reminder', when: 'If the offer is not redeemed', x: 580, y: 760,
    variants: [v('Copy A', 'free_interior_subscription_reminder'), v('Copy B', 'free_interior_subscription_reminder')]
  },
  { id: 'exitB', kind: 'end', title: 'Exit', x: -440, y: 790, tone: 'danger' },
  { id: 'exitC', kind: 'end', title: 'Exit', x: 220, y: 920, tone: 'danger' },
  { id: 'exitD', kind: 'end', title: 'Exit', x: 920, y: 790, tone: 'danger' },"""

assert old_offers_node in gr, "old_offers_node not found in funnelGraph.ts"
gr = gr.replace(old_offers_node, new_offers_node)

# Edges
old_edges = """  e('e6', 'offers', 'left', 'members', 'top', 'Offer A: membership', 'success'),
  e('e7', 'offers', 'bottom', 'remB', 'top', 'Offer B: SAR 50 wallet balance', 'neutral'),
  e('e8', 'offers', 'right', 'remC', 'top', 'Offer C: free interior on next visit', 'neutral'),
  e('e9', 'remB', 'bottom', 'msoffer', 'top', 'Redeemed', 'success'),
  e('e10', 'remB', 'left', 'exitB', 'right', 'Not redeemed', 'danger'),
  e('e11', 'remC', 'bottom', 'msoffer', 'top', 'Redeemed', 'success'),
  e('e12', 'remC', 'right', 'exitC', 'left', 'Not redeemed', 'danger'),"""

new_edges = """  e('e6', 'offers', 'left', 'members', 'top', 'Plan 1: 100 SAR membership', 'success'),
  e('e7', 'offers', 'bottom', 'remB', 'top', 'Plan 2: SAR 50 wallet balance', 'neutral'),
  e('e8', 'offers', 'bottom', 'remC', 'top', 'Plan 3: Free interior next visit', 'neutral'),
  e('e8d', 'offers', 'right', 'remD', 'top', 'Plan 4: Free interior month w/ membership', 'neutral'),
  e('e9', 'remB', 'bottom', 'msoffer', 'top', 'Redeemed', 'success'),
  e('e10', 'remB', 'left', 'exitB', 'right', 'Not redeemed', 'danger'),
  e('e11', 'remC', 'bottom', 'msoffer', 'top', 'Redeemed', 'success'),
  e('e12', 'remC', 'bottom', 'exitC', 'top', 'Not redeemed', 'danger'),
  e('e12d_sub', 'remD', 'left', 'members', 'top', 'Subscribes', 'success'),
  e('e12d_exit', 'remD', 'right', 'exitD', 'left', 'Not subscribed', 'danger'),"""

assert old_edges in gr, "old_edges not found in funnelGraph.ts"
gr = gr.replace(old_edges, new_edges)

# MF_NODE_FLOW
gr = gr.replace(
    "remC: { flowId: 'mf-reminder-c', stepId: 'm5' },",
    "remC: { flowId: 'mf-reminder-c', stepId: 'm5' },\n  remD: { flowId: 'mf-reminder-d', stepId: 'm5d' },"
)

# WHEN_CONTEXT
gr = gr.replace(
    "remC: { after: 'the offer', cond: 'if the offer is not redeemed' },",
    "remC: { after: 'the offer', cond: 'if the offer is not redeemed' },\n  remD: { after: 'the offer', cond: 'if not subscribed' },"
)

graph_path.write_text(gr, encoding='utf-8')
print("Successfully updated funnelGraph.ts")


# 7. Update src/components/funnel/MembershipFlowChart.tsx
chart_path = ROOT / "src" / "components" / "funnel" / "MembershipFlowChart.tsx"
ch = chart_path.read_text(encoding='utf-8')

ch = ch.replace(
    "className={`${variants && variants.length > 2 ? 'w-[330px]' : 'w-[250px]'}`",
    "className={`${variants && variants.length > 3 ? 'w-[360px]' : variants && variants.length > 2 ? 'w-[330px]' : 'w-[250px]'}`"
)
ch = ch.replace(
    "className={`mt-2 grid gap-1.5 ${variants.length > 2 ? 'grid-cols-3' : 'grid-cols-2'}`}",
    "className={`mt-2 grid gap-1.5 ${variants.length > 2 ? (variants.length > 3 ? 'grid-cols-2' : 'grid-cols-3') : 'grid-cols-2'}`}"
)
chart_path.write_text(ch, encoding='utf-8')
print("Successfully updated MembershipFlowChart.tsx")

print("All file patches applied successfully!")
