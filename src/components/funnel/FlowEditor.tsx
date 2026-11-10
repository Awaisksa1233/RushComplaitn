import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react';
import { discardFlowDraft, saveFlowDraft, type ExitRule, type FlowConfig, type FlowDraft, type FlowStep, type FlowTrigger } from './funnelApi';
import { isApprovedTemplate } from './funnelGraph';
import { TemplateSelector } from './TemplateSelector';

const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STAGES: Record<string, string> = {
  signed_up: 'Signs up',
  free_wash_redeemed: 'Redeems the free wash',
  offer_sent: 'Is sent an offer',
  offer_engaged: 'Engages with an offer',
  subscribed: 'Subscribes',
  first_full_renewal: 'Pays the first full-price renewal'
};
const SEGMENTS: Record<string, string> = {
  renewal_due_5d: 'Renewal due within 5 days',
  renewal_failed: 'Renewal payment failed',
  inactive_7d: 'No wash in 7 days',
  inactive_14d: 'No wash in 14 days',
  cancelled_still_valid: 'Cancelled, still inside paid cycle',
  expired_no_active: 'Expired, no active subscription',
  voucher_issued_unredeemed: 'Voucher issued, not redeemed',
  under_2_washes_7d: 'Under 2 washes in 7 days'
};
const OFFERS: Record<string, string> = { offerB: 'Offer B', offerC: 'Offer C' };
const STEP_KIND_LABEL: Record<FlowStep['kind'], string> = {
  send_template: 'Send a message',
  wait: 'Wait',
  condition: 'Check a condition',
  ab_split: 'A/B split marker',
  grant_offer: 'Grant offer'
};
const NEW_KINDS: FlowStep['kind'][] = ['send_template', 'wait', 'condition', 'ab_split'];

/** The draft if there is one, otherwise the live values: what the editor starts from. */
function sanitizeName(n: any, fallback = ''): { en: string; ar?: string } {
  if (!n) return { en: fallback, ar: '' };
  if (typeof n === 'string') return { en: n, ar: '' };
  return { en: n.en || fallback, ar: n.ar || '' };
}

export const baseOf = (f: FlowConfig): FlowDraft => {
  const steps = (f.steps || []).map((s, idx) => ({
    ...s,
    id: s.id || `s${idx + 1}`,
    kind: (s.kind || (s.waitHours != null ? 'wait' : s.condition ? 'condition' : 'send_template')) as any,
    name: sanitizeName(s.name, s.templateId || s.id || `Step ${idx + 1}`)
  }));
  return f.draft ?? {
    name: sanitizeName(f.name, f.id),
    description: f.description,
    status: f.status === 'running' ? 'running' : 'paused',
    window: f.window,
    volume: f.volume,
    reentry: f.reentry ?? 'once',
    approveFirstBatch: f.approveFirstBatch,
    trigger: f.trigger,
    exitWhen: f.exitWhen ?? [],
    steps
  };
};

const input = 'w-full rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-black focus:outline-none focus:ring-2 focus:ring-[#c91e2f]/20 focus:border-[#c91e2f]';
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="block text-slate-500 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-amber-600 mt-0.5">{hint}</span>}
    </label>
  );
}

/** Hours stored, shown as hours or days. */
function Duration({ hours, onChange, label }: { hours: number; onChange: (h: number) => void; label: string }) {
  const [unit, setUnit] = useState<'hours' | 'days'>(Number.isFinite(hours) && hours >= 24 && hours % 24 === 0 ? 'days' : 'hours');
  const shown = Number.isFinite(hours) ? (unit === 'days' ? hours / 24 : hours) : NaN;
  return (
    <Field label={label}>
      <div className="flex gap-1.5">
        <input className={input} type="number" min={0} value={Number.isNaN(shown) ? '' : shown} onChange={(e) => onChange(num(e.target.value) * (unit === 'days' ? 24 : 1))} />
        <select className={`${input} !w-auto`} value={unit} onChange={(e) => setUnit(e.target.value as 'hours' | 'days')} aria-label="Unit">
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>
    </Field>
  );
}

function TemplateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <TemplateSelector
      label={label}
      value={value}
      onChange={onChange}
    />
  );
}

const rebalance = (n: number) => {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? 100 - base * (n - 1) : base));
};

function StepEditor({ step, index, all, onChange, onMove, onDelete, last }: { step: FlowStep; index: number; all: FlowStep[]; onChange: (patch: Partial<FlowStep>) => void; onMove: (dir: -1 | 1) => void; onDelete: () => void; last: boolean }) {
  const ab = !!step.variants?.length;
  const others = all.filter((s) => s.id !== step.id);
  const sum = step.variants?.reduce((a, v) => a + (Number.isFinite(v.weight) ? v.weight : 0), 0) ?? 100;

  const setVariants = (variants: NonNullable<FlowStep['variants']>) => onChange({ variants, templateId: variants[0]?.templateId });
  const toggleAB = (on: boolean) => {
    if (!on) {
      onChange({ variants: undefined, templateId: step.variants?.[0]?.templateId ?? step.templateId ?? '' });
      return;
    }
    const w = rebalance(2);
    setVariants([
      { key: 'A', templateId: step.templateId ?? '', weight: w[0] },
      { key: 'B', templateId: step.templateId ?? '', weight: w[1] }
    ]);
  };
  const resize = (n: 2 | 3) => {
    const w = rebalance(n);
    const cur = step.variants ?? [];
    setVariants((['A', 'B', 'C'] as const).slice(0, n).map((key, i) => ({ key, templateId: cur[i]?.templateId ?? cur[0]?.templateId ?? '', weight: w[i] })));
  };

  const target = (side: 'yes' | 'no', label: string) => (
    <Field label={label}>
      <select className={input} value={step.condition?.[side] ?? ''} onChange={(e) => onChange({ condition: { ...step.condition!, [side]: e.target.value || null } })}>
        <option value="">End the flow</option>
        {others.map((s) => (
          <option key={s.id} value={s.id}>
            {all.indexOf(s) + 1}. {s.name?.en ?? s.id}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <li className="rounded-lg border border-[#e5e5e5] p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-black px-1.5 text-[10px] font-bold text-white tabular-nums">{index + 1}</span>
        <span className="text-[11px] font-semibold text-slate-600">{STEP_KIND_LABEL[step.kind]}</span>
        <label className="inline-flex items-center gap-1.5 text-xs ml-2">
          <input type="checkbox" checked={!step.paused} onChange={(e) => onChange({ paused: !e.target.checked })} /> Step on
        </label>
        <span className="ml-auto inline-flex gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up" className="p-1 text-slate-500 hover:text-black disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => onMove(1)} disabled={last} aria-label="Move down" className="p-1 text-slate-500 hover:text-black disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={onDelete} aria-label="Delete step" className="p-1 text-red-600 hover:text-red-800"><Trash2 className="w-3.5 h-3.5" /></button>
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <div className="sm:col-span-6">
          <Field label="Name">
            <input className={input} value={step.name?.en ?? ""} maxLength={200} onChange={(e) => onChange({ name: { ...step.name, en: e.target.value } })} />
          </Field>
        </div>
        {step.kind === 'wait' && (
          <div className="sm:col-span-4">
            <Duration label="Wait" hours={step.waitHours ?? 0} onChange={(h) => onChange({ waitHours: h })} />
          </div>
        )}
        {step.kind === 'send_template' && (
          <>
            <label className="sm:col-span-3 inline-flex items-center gap-1.5 text-xs sm:pt-5">
              <input type="checkbox" checked={ab} onChange={(e) => toggleAB(e.target.checked)} /> A/B split
            </label>
            <div className="sm:col-span-3">
              <Field label="Hold back %">
                <input className={input} type="number" min={0} max={100} value={step.holdoutPct ?? 0} onChange={(e) => onChange({ holdoutPct: num(e.target.value) })} />
              </Field>
            </div>
            {!ab && (
              <div className="sm:col-span-12">
                <TemplateInput label="Template id" value={step.templateId ?? ''} onChange={(v) => onChange({ templateId: v })} />
              </div>
            )}
          </>
        )}
      </div>

      {step.kind === 'send_template' && ab && (
        <div className="space-y-2 rounded-lg bg-[#fafafa] p-2.5">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            Variants
            {([2, 3] as const).map((n) => (
              <button key={n} type="button" onClick={() => resize(n)} className={`rounded px-2 py-0.5 border ${step.variants!.length === n ? 'bg-black text-white border-black' : 'bg-white border-[#e5e5e5]'}`}>
                {n}
              </button>
            ))}
            <button type="button" onClick={() => setVariants(step.variants!.map((v, i) => ({ ...v, weight: rebalance(step.variants!.length)[i] })))} className="ml-auto text-[11px] underline">
              Split evenly
            </button>
            <span className={`tabular-nums text-[11px] font-semibold ${sum === 100 ? 'text-emerald-700' : 'text-red-700'}`}>{sum}% of 100</span>
          </div>
          {step.variants!.map((v, j) => (
            <div key={v.key} className="grid grid-cols-12 gap-2 items-end">
              <span className="col-span-1 mb-1.5 inline-flex h-6 w-6 items-center justify-center rounded bg-black text-white text-[10px] font-bold">{v.key}</span>
              <div className="col-span-8">
                <TemplateInput label="Template id" value={v.templateId} onChange={(t) => setVariants(step.variants!.map((x, k) => (k === j ? { ...x, templateId: t } : x)))} />
              </div>
              <div className="col-span-3">
                <Field label="Weight %">
                  <input className={input} type="number" min={0} max={100} value={Number.isNaN(v.weight) ? '' : v.weight} onChange={(e) => setVariants(step.variants!.map((x, k) => (k === j ? { ...x, weight: num(e.target.value) } : x)))} />
                </Field>
              </div>
            </div>
          ))}
        </div>
      )}

      {step.kind === 'condition' && step.condition && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {step.condition.check.type === 'days_since_last_wash' ? (
            <Field label="Days since the last wash is more than">
              <input className={input} type="number" min={0} max={365} value={Number(step.condition.check.moreThan ?? 0)} onChange={(e) => onChange({ condition: { ...step.condition!, check: { ...step.condition!.check, moreThan: num(e.target.value) } } })} />
            </Field>
          ) : (
            <div className="text-xs text-slate-500">
              Check: <code>{step.condition.check.type}</code>
              <span className="block text-[11px]">Kept as the funnel defined it.</span>
            </div>
          )}
          {target('yes', 'If yes, go to')}
          {target('no', 'If no, go to')}
        </div>
      )}
      {step.kind === 'ab_split' && <p className="text-[11px] text-slate-500">Marks where the flow splits into A/B. The split itself is set on the message step after it.</p>}
    </li>
  );
}

const blankStep = (kind: FlowStep['kind']): FlowStep => {
  const base = { id: newId(), kind, paused: false };
  switch (kind) {
    case 'send_template':
      return { ...base, name: { en: 'Send a message' }, templateId: '' };
    case 'wait':
      return { ...base, name: { en: 'Wait' }, waitHours: 24 };
    case 'condition':
      return { ...base, name: { en: 'Check a condition' }, condition: { check: { type: 'days_since_last_wash', moreThan: 4 }, yes: null, no: null } };
    default:
      return { ...base, name: { en: 'Split into A / B' } };
  }
};

function TriggerEditor({ value, onChange, flowId }: { value?: FlowTrigger; onChange: (t: FlowTrigger | undefined) => void; flowId: string }) {
  const type = value?.type ?? 'none';
  const setType = (t: string) => {
    if (t === 'none') return onChange(undefined);
    if (t === 'event') return onChange({ type: 'event', stageId: 'signed_up', maxAgeHours: 72 });
    if (t === 'segment') return onChange({ type: 'segment', segment: 'renewal_due_5d' });
    if (t === 'promo_redeemed') return onChange({ type: 'promo_redeemed', offers: ['offerB'], maxAgeHours: 72 });
    onChange({ type: 'offer_sent', templateIds: [''], maxAgeHours: 72 });
  };
  const age = value && 'maxAgeHours' in value ? value.maxAgeHours : undefined;
  const setAge = (h: number) => value && onChange({ ...value, maxAgeHours: h } as FlowTrigger);
  const checkboxes = (all: Record<string, string>, picked: string[], set: (v: string[]) => void) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {Object.entries(all).map(([k, l]) => (
        <label key={k} className="inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={picked.includes(k)} onChange={(e) => set(e.target.checked ? [...picked, k] : picked.filter((x) => x !== k))} /> {l}
        </label>
      ))}
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
      <div className="sm:col-span-4">
        <Field label="Who enters">
          <select className={input} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="none">Nobody (no trigger)</option>
            <option value="event">When a customer reaches a stage</option>
            <option value="segment">A group of customers (segment)</option>
            <option value="promo_redeemed">When a customer redeems an offer</option>
            <option value="offer_sent">After a template is sent</option>
          </select>
        </Field>
      </div>
      {value?.type === 'event' && (
        <div className="sm:col-span-4">
          <Field label="Stage">
            <select className={input} value={value.stageId} onChange={(e) => onChange({ ...value, stageId: e.target.value })}>
              {Object.entries(STAGES).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {value?.type === 'segment' && (
        <div className="sm:col-span-8">
          <Field label="Segment">
            <select className={input} value={value.segment} onChange={(e) => onChange({ type: 'segment', segment: e.target.value })}>
              {!(value.segment in SEGMENTS) && <option value={value.segment}>{value.segment}</option>}
              {Object.entries(SEGMENTS).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {value?.type === 'promo_redeemed' && <div className="sm:col-span-8">{checkboxes(OFFERS, value.offers, (offers) => onChange({ ...value, offers }))}</div>}
      {value?.type === 'offer_sent' && (
        <>
          <div className="sm:col-span-4">
            <TemplateInput label="Template ids (comma separated)" value={value.templateIds.join(', ')} onChange={(v) => onChange({ ...value, templateIds: v.split(',').map((x) => x.trim()) })} />
          </div>
          <div className="sm:col-span-4 text-[11px] text-slate-500">{value.fromFlowId && value.fromFlowId !== flowId ? `Sent by flow ${value.fromFlowId}.` : ''}</div>
        </>
      )}
      {age !== undefined && (
        <div className="sm:col-span-4">
          <Duration label="Ignore events older than" hours={age} onChange={setAge} />
        </div>
      )}
    </div>
  );
}

function ExitEditor({ rules, onChange }: { rules: ExitRule[]; onChange: (r: ExitRule[]) => void }) {
  const set = (i: number, r: ExitRule) => onChange(rules.map((x, j) => (j === i ? r : x)));
  return (
    <div className="space-y-2">
      {rules.length === 0 && <p className="text-xs text-slate-500">No stop rules: customers run to the last step.</p>}
      {rules.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            className={`${input} !w-auto`}
            value={r.type}
            onChange={(e) =>
              set(i, e.target.value === 'stage_reached' ? { type: 'stage_reached', stageId: 'subscribed' } : e.target.value === 'promo_redeemed' ? { type: 'promo_redeemed', offers: ['offerB'] } : { type: 'has_entitled_subscription' })
            }
          >
            <option value="stage_reached">Customer reaches a stage</option>
            <option value="has_entitled_subscription">Customer has a paid, active membership</option>
            <option value="promo_redeemed">Customer redeems an offer</option>
          </select>
          {r.type === 'stage_reached' && (
            <select className={`${input} !w-auto`} value={r.stageId} onChange={(e) => set(i, { type: 'stage_reached', stageId: e.target.value })}>
              {Object.entries(STAGES).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          )}
          {r.type === 'promo_redeemed' &&
            Object.entries(OFFERS).map(([k, l]) => (
              <label key={k} className="inline-flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={r.offers.includes(k)} onChange={(e) => set(i, { type: 'promo_redeemed', offers: e.target.checked ? [...r.offers, k] : r.offers.filter((x) => x !== k) })} /> {l}
              </label>
            ))}
          <button type="button" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="Remove rule" className="p-1 text-red-600 hover:text-red-800"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      {rules.length < 10 && (
        <button type="button" onClick={() => onChange([...rules, { type: 'has_entitled_subscription' }])} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-black">
          <Plus className="w-3 h-3" /> Add a stop rule
        </button>
      )}
    </div>
  );
}

/** Plain-language list of what differs between the live flow and a draft: shown before publishing. */
export function diffFlow(live: FlowConfig, d: FlowDraft): string[] {
  const out: string[] = [];
  const dur = (h = 0) => (h >= 24 && h % 24 === 0 ? `${h / 24}d` : `${h}h`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const liveName = live.name?.en ?? live.id;
  const draftName = d.name?.en ?? live.id;
  if (liveName !== draftName) out.push(`Name: "${liveName}" -> "${draftName}"`);
  if ((live.description?.en ?? "") !== (d.description?.en ?? "")) out.push("Description changed");
  if (live.status !== d.status) out.push(`Status: ${live.status} → ${d.status}`);
  if (!same(live.window, d.window)) out.push('Send window or days changed');
  if (!same(live.volume, d.volume)) out.push(`Volume limit: ${live.volume.perHour}/h, ${live.volume.perDay}/day → ${d.volume.perHour}/h, ${d.volume.perDay}/day`);
  if ((live.reentry ?? 'once') !== d.reentry) out.push(`Re-entry: ${live.reentry ?? 'once'} → ${d.reentry}`);
  if (live.approveFirstBatch !== d.approveFirstBatch) out.push(`First batch needs approval: ${live.approveFirstBatch ? 'yes' : 'no'} → ${d.approveFirstBatch ? 'yes' : 'no'}`);
  if (!same(live.trigger ?? null, d.trigger ?? null)) out.push('Who enters the flow changed');
  if (!same(live.exitWhen ?? [], d.exitWhen)) out.push('Stop rules changed');
  const liveById = new Map(live.steps.map((s) => [s.id, s]));
  const draftIds = new Set(d.steps.map((s) => s.id));
  for (const s of (live.steps || [])) if (!draftIds.has(s.id)) out.push(`Removed step "${s.name?.en ?? s.id}"`);
  d.steps.forEach((s, i) => {
    const p = liveById.get(s.id);
    const sName = s.name?.en ?? s.id;
    if (!p) return void out.push(`Added step ${i + 1}: "${sName}"`);
    const pName = p.name?.en ?? p.id;
    const bits: string[] = [];
    if (pName !== sName) bits.push(`renamed from "${pName}"`);
    if (p.paused !== s.paused) bits.push(s.paused ? 'switched off' : 'switched on');
    if (p.waitHours !== s.waitHours) bits.push(`wait ${dur(p.waitHours)} → ${dur(s.waitHours)}`);
    const pa = !!p.variants?.length;
    const sa = !!s.variants?.length;
    if (pa !== sa) bits.push(`A/B split ${sa ? 'turned on' : 'turned off'}`);
    else if (!same(p.variants, s.variants) || p.templateId !== s.templateId) bits.push('templates or weights changed');
    if ((p.holdoutPct ?? 0) !== (s.holdoutPct ?? 0)) bits.push(`hold-back ${p.holdoutPct ?? 0}% → ${s.holdoutPct ?? 0}%`);
    if (!same(p.condition, s.condition)) bits.push('condition changed');
    if (bits.length) out.push(`Step “${s.name.en}”: ${bits.join(', ')}`);
  });
  const order = (ids: string[]) => ids.filter((id) => draftIds.has(id) && liveById.has(id)).join();
  return out;
}

export function FlowEditor({ flow, onClose, onSaved }: { flow: FlowConfig; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<FlowDraft>(() => structuredClone(baseOf(flow)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStep = (i: number, patch: Partial<FlowStep>) => setD((cur) => ({ ...cur, steps: cur.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, dir: -1 | 1) =>
    setD((cur) => {
      const steps = [...cur.steps];
      [steps[i], steps[i + dir]] = [steps[i + dir], steps[i]];
      return { ...cur, steps };
    });
  // Deleting a step clears any condition branch that pointed at it, so nothing is left dangling.
  const remove = (i: number) =>
    setD((cur) => {
      const gone = cur.steps[i].id;
      return {
        ...cur,
        steps: cur.steps
          .filter((_, j) => j !== i)
          .map((s) => (s.condition ? { ...s, condition: { ...s.condition, yes: s.condition.yes === gone ? null : s.condition.yes, no: s.condition.no === gone ? null : s.condition.no } } : s))
      };
    });
  const toggleDay = (day: number) =>
    setD((cur) => ({ ...cur, window: { ...cur.window, days: cur.window.days.includes(day) ? cur.window.days.filter((x) => x !== day) : [...cur.window.days, day].sort() } }));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="border-t border-[#f2f2f2] p-4 space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveFlowDraft(flow.id, d));
      }}
    >
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
        Changes are saved as a draft. The live flow keeps running as it is until you publish the draft.
        {flow.hasDraft && ' You are editing the saved draft.'}
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name (English)">
          <input className={input} value={d.name?.en ?? ""} maxLength={200} onChange={(e) => setD({ ...d, name: { ...d.name, en: e.target.value } })} />
        </Field>
        <Field label="Name (Arabic, optional)">
          <input className={input} dir="rtl" value={d.name?.ar ?? ""} maxLength={200} onChange={(e) => setD({ ...d, name: { ...d.name, ar: e.target.value } })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea className={input} rows={2} value={d.description.en} maxLength={1000} onChange={(e) => setD({ ...d, description: { ...d.description, en: e.target.value } })} />
          </Field>
        </div>
        <Field label="Status">
          <select className={input} value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as FlowDraft['status'] })}>
            <option value="paused">Paused</option>
            <option value="running">Running</option>
          </select>
        </Field>
        <Field label="Re-entry">
          <select className={input} value={d.reentry} onChange={(e) => setD({ ...d, reentry: e.target.value as FlowDraft['reentry'] })}>
            <option value="once">Once per customer</option>
            <option value="per_cycle">Once per billing cycle</option>
          </select>
        </Field>
        <Field label="Send window start (Riyadh hour)">
          <input className={input} type="number" min={0} max={23} value={d.window.startHour} onChange={(e) => setD({ ...d, window: { ...d.window, startHour: num(e.target.value) } })} />
        </Field>
        <Field label="Send window end (Riyadh hour)">
          <input className={input} type="number" min={1} max={24} value={d.window.endHour} onChange={(e) => setD({ ...d, window: { ...d.window, endHour: num(e.target.value) } })} />
        </Field>
        <Field label="Limit per hour">
          <input className={input} type="number" min={1} value={d.volume.perHour} onChange={(e) => setD({ ...d, volume: { ...d.volume, perHour: num(e.target.value) } })} />
        </Field>
        <Field label="Limit per day">
          <input className={input} type="number" min={1} value={d.volume.perDay} onChange={(e) => setD({ ...d, volume: { ...d.volume, perDay: num(e.target.value) } })} />
        </Field>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="text-slate-500">Send days</span>
          {DAY_NAME.map((n, i) => (
            <label key={n} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={d.window.days.includes(i)} onChange={() => toggleDay(i)} /> {n}
            </label>
          ))}
          <label className="inline-flex items-center gap-1.5 ml-auto">
            <input type="checkbox" checked={d.approveFirstBatch} onChange={(e) => setD({ ...d, approveFirstBatch: e.target.checked })} /> First batch needs approval
          </label>
        </div>
      </section>

      <section>
        <h4 className="text-xs font-bold text-black mb-2">Who enters</h4>
        <TriggerEditor value={d.trigger} onChange={(trigger) => setD({ ...d, trigger })} flowId={flow.id} />
      </section>

      <section>
        <h4 className="text-xs font-bold text-black mb-2">Stops when</h4>
        <ExitEditor rules={d.exitWhen} onChange={(exitWhen) => setD({ ...d, exitWhen })} />
      </section>

      <section>
        <h4 className="text-xs font-bold text-black mb-2">Steps</h4>
        <ol className="space-y-2">
          {d.steps.map((s, i) => (
            <StepEditor key={s.id} step={s} index={i} all={d.steps} last={i === d.steps.length - 1} onChange={(patch) => setStep(i, patch)} onMove={(dir) => move(i, dir)} onDelete={() => remove(i)} />
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-xs text-slate-500">Add a step:</span>
          {NEW_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setD((cur) => ({ ...cur, steps: [...cur.steps, blankStep(k)] }))} className="inline-flex items-center gap-1 rounded-lg border border-[#e5e5e5] px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-black hover:border-slate-300">
              <Plus className="w-3 h-3" /> {STEP_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> Save draft
        </button>
        <button type="button" onClick={onClose} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-black">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        {flow.hasDraft && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Discard the saved draft? The live flow is not affected.')) void run(() => discardFlowDraft(flow.id));
            }}
            className="ml-auto text-xs font-semibold text-red-700 hover:underline"
          >
            Discard draft
          </button>
        )}
      </div>
    </form>
  );
}
