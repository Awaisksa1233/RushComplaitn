import React, { useState } from 'react';
import { resetDefinition, saveDefinition, type FunnelDefinition, type StageId } from './funnelApi';

const STAGES: StageId[] = ['signed_up', 'free_wash_redeemed', 'subscribed', 'first_full_renewal'];
const input = 'w-full rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-black focus:outline-none focus:ring-2 focus:ring-[#c91e2f]/20 focus:border-[#c91e2f]';

/** Edits how the funnel is presented: stage names and the free-wash reminder / expiry days. Never changes what is sent. */
export function DefinitionEditor({ definition, onClose, onSaved }: { definition: FunnelDefinition; onClose: () => void; onSaved: (d: FunnelDefinition) => void }) {
  const [labels, setLabels] = useState(definition.stageLabels);
  const [reminder, setReminder] = useState(definition.freeWashReminderDay);
  const [expiry, setExpiry] = useState(definition.freeWashExpiryDay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<FunnelDefinition>) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await fn());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="rounded-2xl border border-[#e5e5e5] bg-white p-5 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveDefinition({ stageLabels: labels, freeWashReminderDay: reminder, freeWashExpiryDay: expiry }));
      }}
    >
      <div>
        <h3 className="text-sm font-bold text-black">Edit funnel definition</h3>
        <p className="text-xs text-slate-500 mt-0.5">Changes the stage names and the free-wash day thresholds used for the numbers on this page. Messages already set up in flows are not affected.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {STAGES.map((id, i) => (
          <label key={id} className="block text-xs">
            <span className="block text-slate-500 mb-1">Stage {i + 1} name</span>
            <input className={input} value={labels[id]} maxLength={60} onChange={(e) => setLabels({ ...labels, [id]: e.target.value })} />
          </label>
        ))}
        <label className="block text-xs">
          <span className="block text-slate-500 mb-1">Free-wash reminder day</span>
          <input className={input} type="number" min={1} max={30} value={reminder} onChange={(e) => setReminder(Number(e.target.value))} />
        </label>
        <label className="block text-xs">
          <span className="block text-slate-500 mb-1">Free-wash expiry day</span>
          <input className={input} type="number" min={2} max={60} value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} />
        </label>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save</button>
        <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-black">Cancel</button>
        {definition.custom && (
          <button type="button" disabled={busy} onClick={() => void run(resetDefinition)} className="ml-auto text-xs font-semibold text-red-700 hover:underline">
            Reset to defaults
          </button>
        )}
      </div>
    </form>
  );
}
