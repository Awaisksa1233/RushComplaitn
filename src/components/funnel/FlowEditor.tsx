import React, { useState } from 'react';
import { Save, X } from 'lucide-react';
import { discardFlowDraft, saveFlowDraft, type FlowConfig, type FlowDraft, type FlowStep } from './funnelApi';
import { isApprovedTemplate } from './funnelGraph';

const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The draft if there is one, otherwise the live values: what the editor starts from. */
function sanitizeName(n: any, fallback = ''): { en: string; ar?: string } {
  if (!n) return { en: fallback, ar: '' };
  if (typeof n === 'string') return { en: n, ar: '' };
  return { en: n.en || fallback, ar: n.ar || '' };
}

export const baseOf = (f: FlowConfig): FlowDraft => {
  const steps = (f.steps || []).map((s, idx) => ({
    ...s,
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
    steps
  };
};

const input = 'w-full rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-black focus:outline-none focus:ring-2 focus:ring-[#c91e2f]/20 focus:border-[#c91e2f]';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="block text-slate-500 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>}
    </label>
  );
}

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

export function FlowEditor({ flow, onClose, onSaved }: { flow: FlowConfig; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<FlowDraft>(() => structuredClone(baseOf(flow)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStep = (i: number, patch: Partial<FlowStep>) => setD((cur) => ({ ...cur, steps: cur.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
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
      className="border-t border-[#f2f2f2] p-4 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveFlowDraft(flow.id, d));
      }}
    >
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
        Changes are saved as a draft. The live flow keeps running as it is until the draft is published in the Funnel control panel.
        {flow.hasDraft && ' You are editing the saved draft.'}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      </div>

      <div>
        <h4 className="text-xs font-bold text-black mb-2">Steps</h4>
        <p className="text-[11px] text-slate-500 mb-2">Steps can be renamed, retimed, re-templated or switched off. Adding and removing steps stays in the Funnel control panel.</p>
        <ol className="space-y-2">
          {d.steps.map((s, i) => (
            <li key={s.id} className="rounded-lg border border-[#e5e5e5] p-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5">
                <Field label={`${i + 1}. ${s.kind.replace('_', ' ')}`}>
                  <input className={input} value={s.name?.en ?? ""} maxLength={200} onChange={(e) => setStep(i, { name: { ...s.name, en: e.target.value } })} />
                </Field>
              </div>
              {s.kind === 'wait' && (
                <div className="sm:col-span-3">
                  <Field label="Wait (hours)">
                    <input className={input} type="number" min={0} value={s.waitHours ?? 0} onChange={(e) => setStep(i, { waitHours: num(e.target.value) })} />
                  </Field>
                </div>
              )}
              {s.kind === 'send_template' && !s.variants?.length && (
                <div className="sm:col-span-4">
                  <Field label="Template id" hint={s.templateId && !isApprovedTemplate(s.templateId) ? 'Not in the approved list yet' : undefined}>
                    <input className={input} value={s.templateId ?? ''} onChange={(e) => setStep(i, { templateId: e.target.value })} />
                  </Field>
                </div>
              )}
              <label className="sm:col-span-3 inline-flex items-center gap-1.5 text-xs pb-1.5">
                <input type="checkbox" checked={!s.paused} onChange={(e) => setStep(i, { paused: !e.target.checked })} /> Step on
              </label>
              {s.variants?.map((v, j) => (
                <div key={v.key} className="sm:col-span-12 grid grid-cols-12 gap-3 items-end">
                  <span className="col-span-1 inline-flex h-6 w-6 items-center justify-center rounded bg-black text-white text-[10px] font-bold">{v.key}</span>
                  <div className="col-span-8">
                    <Field label="Template id" hint={!isApprovedTemplate(v.templateId) ? 'Not in the approved list yet' : undefined}>
                      <input className={input} value={v.templateId} onChange={(e) => setStep(i, { variants: s.variants!.map((x, k) => (k === j ? { ...x, templateId: e.target.value } : x)) })} />
                    </Field>
                  </div>
                  <div className="col-span-3">
                    <Field label="Weight %">
                      <input className={input} type="number" min={0} max={100} value={v.weight} onChange={(e) => setStep(i, { variants: s.variants!.map((x, k) => (k === j ? { ...x, weight: num(e.target.value) } : x)) })} />
                    </Field>
                  </div>
                </div>
              ))}
            </li>
          ))}
        </ol>
      </div>

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
