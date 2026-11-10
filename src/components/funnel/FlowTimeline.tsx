import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { computeTimeline, formatElapsed, timingWarnings, type TimedFlow } from './flowTiming';

const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Shows when each message and deadline lands, counted from entry, plus any timing problems. */
export function FlowTimeline({ flow, freeWashExpiryDay }: { flow: TimedFlow; freeWashExpiryDay: number }) {
  const points = computeTimeline(flow.steps);
  const warnings = timingWarnings(flow, freeWashExpiryDay);
  if (points.length === 0) return null;
  const { days, startHour, endHour } = flow.window;
  return (
    <div className="space-y-2" aria-label="Flow timeline">
      <ol className="flex flex-wrap items-stretch gap-x-1.5 gap-y-2 text-[11px]">
        {points.map((p, i) => (
          <li key={`${p.stepId}-${p.kind}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-300" aria-hidden>→</span>}
            <span
              className={`rounded-lg border px-2 py-1 ${
                p.kind === 'deadline' ? 'border-dashed border-slate-300 bg-white text-slate-600' : p.reminder ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-[#d4d4d4] bg-[#fafafa] text-slate-800'
              }`}
            >
              <span className="block font-semibold tabular-nums">{formatElapsed(p.atHours)}</span>
              <span className="block max-w-[180px] truncate" title={p.name}>
                {p.kind === 'deadline' ? `Deadline: ${p.onExpire === 'exit' ? 'leaves flow' : p.onExpire === 'next' ? 'moves on' : 'goes to a step'}` : `${p.reminder ? 'Reminder: ' : ''}${p.name}`}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-slate-500">
        Counted from when the customer enters. Messages go out in the send window ({days.map((d) => DAY_NAME[d]).join(', ')}, {startHour}:00–{endHour}:00 Riyadh), so one that falls outside it waits for the next slot.
      </p>
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}
