import React, { useMemo, useState } from 'react';
import { ChevronDown, Clock, GitBranch, Gift, MessageCircle, Pencil, ShieldAlert, Split } from 'lucide-react';
import type { ExitRule, FlowConfig, FlowStep, FlowTrigger, FlowsResponse } from './funnelApi';
import { FlowEditor } from './FlowEditor';
import { isApprovedTemplate } from './funnelGraph';

const STAGE_NAME: Record<string, string> = {
  signed_up: 'signs up',
  free_wash_redeemed: 'redeems the free wash',
  offer_sent: 'is sent an offer',
  offer_engaged: 'engages with an offer',
  subscribed: 'subscribes',
  first_full_renewal: 'pays the first full-price renewal'
};
const SEGMENT_NAME: Record<string, string> = {
  renewal_due_5d: 'Members whose renewal is due within 5 days',
  renewal_failed: 'Members whose renewal payment failed',
  inactive_14d: 'Active members with no wash in 14 days',
  cancelled_still_valid: 'Cancelled members still inside their paid cycle',
  expired_no_active: 'Expired members with no active subscription',
  voucher_issued_unredeemed: 'Customers with an issued, unredeemed voucher',
  under_2_washes_7d: 'Active members with under 2 washes in the last 7 days'
};
const OFFER_NAME: Record<string, string> = { offerB: 'Offer B', offerC: 'Offer C' };
const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function triggerText(t?: FlowTrigger): string {
  if (!t) return 'No trigger: nobody enters this flow.';
  switch (t.type) {
    case 'event':
      return `When a customer ${STAGE_NAME[t.stageId] ?? t.stageId}`;
    case 'segment':
      return SEGMENT_NAME[t.segment] ?? t.segment;
    case 'promo_redeemed':
      return `When a customer redeems the promo code of ${t.offers.map((o) => OFFER_NAME[o] ?? o).join(' or ')}`;
    case 'offer_sent':
      return `After ${t.templateIds.join(' / ')} is sent${t.fromFlowId ? ` by ${t.fromFlowId}` : ''}`;
  }
}
function exitText(r: ExitRule): string {
  switch (r.type) {
    case 'stage_reached':
      return `Customer ${STAGE_NAME[r.stageId] ?? r.stageId}`;
    case 'has_entitled_subscription':
      return 'Customer has a paid, active membership';
    case 'promo_redeemed':
      return `Customer redeems ${r.offers.map((o) => OFFER_NAME[o] ?? o).join(' or ')}`;
  }
}
const waitText = (h = 0) => (h % 24 === 0 && h >= 24 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`);

const STATUS_CLASS: Record<string, string> = {
  running: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  paused: 'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-slate-100 text-slate-600 border-slate-200'
};

const STEP_ICON: Record<FlowStep['kind'], React.FC<{ className?: string }>> = {
  send_template: MessageCircle,
  wait: Clock,
  condition: GitBranch,
  ab_split: Split,
  grant_offer: Gift
};

function TemplateChip({ id, letter, weight, sent }: { id: string; letter?: string; weight?: number; sent?: number }) {
  const ok = isApprovedTemplate(id);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e5e5] bg-[#fafafa] px-1.5 py-0.5 text-[11px]" title={ok ? 'Approved WhatsApp template' : 'Not in the approved template list yet'}>
      {letter && <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-black text-white text-[10px] font-bold">{letter}</span>}
      <MessageCircle size={11} className={ok ? 'text-emerald-600' : 'text-amber-500'} aria-hidden />
      <code className="text-slate-800">{id}</code>
      {weight !== undefined && <span className="text-slate-500 tabular-nums">{weight}%</span>}
      {!ok && <span className="text-amber-600">needs approval</span>}
      {sent ? <span className="text-slate-700 tabular-nums font-semibold">· {sent.toLocaleString()} sent</span> : null}
    </span>
  );
}

function FlowCard({ flow, sent, editable, onChanged }: { flow: FlowConfig; sent: FlowsResponse['sent']; editable: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const mine = sent.filter((s) => s.flowId === flow.id);
  const totalSent = mine.reduce((a, s) => a + s.sent, 0);
  const sentFor = (stepId: string, templateId: string) => mine.filter((s) => s.stepId === stepId && s.templateId === templateId).reduce((a, s) => a + s.sent, 0);
  const messages = flow.steps.filter((s) => s.kind === 'send_template').length;
  const pending = flow.steps.flatMap((s) => (s.variants?.length ? s.variants.map((x) => x.templateId) : s.templateId ? [s.templateId] : [])).filter((t) => !isApprovedTemplate(t));

  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full text-left p-4 flex items-start gap-3">
        <span className="shrink-0 mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-black text-white text-xs font-bold tabular-nums">{flow.number}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-black">{flow.name.en}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_CLASS[flow.status] ?? STATUS_CLASS.completed}`}>{flow.status}</span>
            {flow.hasDraft && <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Unpublished draft</span>}
            {pending.length > 0 && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                {pending.length} template{pending.length === 1 ? '' : 's'} need approval
              </span>
            )}
          </span>
          <span className="block text-xs text-slate-600 mt-1 leading-relaxed">{flow.description.en}</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-slate-500">
            <span><span className="font-semibold text-slate-700">Enters:</span> {triggerText(flow.trigger)}</span>
            <span className="tabular-nums">{messages} message{messages === 1 ? '' : 's'} · {flow.steps.length} step{flow.steps.length === 1 ? '' : 's'}</span>
            {totalSent > 0 && <span className="tabular-nums font-semibold text-slate-700">{totalSent.toLocaleString()} sent</span>}
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && editing && <FlowEditor flow={flow} onClose={() => setEditing(false)} onSaved={onChanged} />}

      {open && !editing && (
        <div className="border-t border-[#f2f2f2] px-4 pt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          <button
            onClick={() => setEditing(true)}
            disabled={!editable}
            title={editable ? 'Edit this flow (saved as a draft)' : 'The funnel database is not reachable, so flows cannot be edited right now'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-black hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Pencil className="w-3 h-3" /> {flow.hasDraft ? 'Edit draft' : 'Edit'}
          </button>
          {flow.draft && <span>Showing the live flow below. A saved draft has unpublished changes.</span>}
        </div>
      )}

      {open && !editing && (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-5">
          <ol className="lg:col-span-7 space-y-0">
            {flow.steps.map((s, i) => {
              const Icon = STEP_ICON[s.kind] ?? MessageCircle;
              return (
                <li key={s.id} className="relative pl-9 pb-4 last:pb-0">
                  {i < flow.steps.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-[#e5e5e5]" aria-hidden />}
                  <span className={`absolute left-0 top-0 inline-flex h-7 w-7 items-center justify-center rounded-full border ${s.paused ? 'border-dashed border-slate-300 bg-white text-slate-400' : 'border-[#d4d4d4] bg-[#fafafa] text-slate-700'}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-semibold ${s.paused ? 'text-slate-400' : 'text-black'}`}>{s.name.en}</span>
                    {s.paused && <span className="rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Step off</span>}
                    {s.kind === 'wait' && !/\d/.test(s.name.en) && <span className="text-[11px] text-slate-500">waits {waitText(s.waitHours)}</span>}
                    {s.holdoutPct ? <span className="text-[11px] text-slate-500">{s.holdoutPct}% held back</span> : null}
                  </div>
                  {s.kind === 'send_template' && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {s.variants?.length
                        ? s.variants.map((x) => <TemplateChip key={x.key} id={x.templateId} letter={x.key} weight={x.weight} sent={sentFor(s.id, x.templateId)} />)
                        : s.templateId && <TemplateChip id={s.templateId} sent={sentFor(s.id, s.templateId)} />}
                    </div>
                  )}
                  {s.condition && (
                    <div className="text-[11px] text-slate-500 mt-1">
                      Yes → {s.condition.yes ?? 'end'} · No → {s.condition.no ?? 'end'}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <dl className="lg:col-span-5 text-xs space-y-3">
            <div>
              <dt className="text-slate-500">Stops when</dt>
              <dd className="text-slate-800 mt-0.5">
                {flow.exitWhen?.length ? flow.exitWhen.map(exitText).join(' · ') : 'Runs to the last step'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Send window (Riyadh time)</dt>
              <dd className="text-slate-800 mt-0.5 tabular-nums">
                {flow.window.days.map((d) => DAY_NAME[d]).join(', ')} · {flow.window.startHour}:00–{flow.window.endHour}:00
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Volume limit</dt>
              <dd className="text-slate-800 mt-0.5 tabular-nums">{flow.volume.perHour} per hour · {flow.volume.perDay} per day</dd>
            </div>
            <div>
              <dt className="text-slate-500">Re-entry</dt>
              <dd className="text-slate-800 mt-0.5">{flow.reentry === 'per_cycle' ? 'Once per billing cycle' : 'Once per customer'}{flow.approveFirstBatch ? ' · first batch needs approval' : ''}</dd>
            </div>
            {flow.audience?.measured && (
              <div>
                <dt className="text-slate-500">Audience</dt>
                <dd className="text-slate-800 mt-0.5 tabular-nums">{flow.audience.count.toLocaleString()} customers</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

export function FlowsPanel({ data, onChanged }: { data: FlowsResponse; onChanged: () => void }) {
  const groups = useMemo(() => {
    const membership = data.flows.filter((f) => f.id.startsWith('mf-'));
    const lifecycle = data.flows.filter((f) => !f.id.startsWith('mf-') && f.number <= 10);
    const other = data.flows.filter((f) => !f.id.startsWith('mf-') && f.number > 10);
    return [
      { title: 'Membership funnel flows', note: 'The messages behind each step of the funnel chart.', flows: membership },
      { title: 'Lifecycle flows', note: 'Welcome, renewal, usage, payment rescue, save and winback.', flows: lifecycle },
      { title: 'Broadcasts', note: 'One-off sends.', flows: other }
    ].filter((g) => g.flows.length > 0);
  }, [data.flows]);

  const running = data.flows.filter((f) => f.status === 'running').length;
  const s = data.settings;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div>
          <div className="text-slate-500">Flows</div>
          <div className="text-lg font-bold tabular-nums text-black">{data.flows.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Running</div>
          <div className="text-lg font-bold tabular-nums text-black">{running}</div>
        </div>
        {s && (
          <>
            <div>
              <div className="text-slate-500">Kill switch</div>
              <div className={`text-sm font-bold ${s.killSwitch ? 'text-red-700' : 'text-emerald-700'}`}>{s.killSwitch ? 'ON: nothing is sent' : 'Off'}</div>
            </div>
            <div>
              <div className="text-slate-500">Test mode</div>
              <div className="text-sm font-bold text-black">{s.testMode ? 'On: test numbers only' : 'Off'}</div>
            </div>
          </>
        )}
        <div className="ml-auto flex items-start gap-2 max-w-md text-slate-600">
          <ShieldAlert className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
          <span>
            {data.source === 'live'
              ? 'Read from the funnel database. You can edit a flow here; edits are saved as drafts and only go live when published in the Funnel control panel.'
              : 'The funnel database could not be read, so these are the built-in flow definitions only. Status and sent counts are not live.'}
          </span>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="text-sm font-bold text-black">{g.title}</h3>
          <p className="text-xs text-slate-500 mb-3">{g.note}</p>
          <div className="space-y-3">
            {g.flows.map((f) => (
              <FlowCard key={f.id} flow={f} sent={data.sent} editable={data.source === 'live'} onChanged={onChanged} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
