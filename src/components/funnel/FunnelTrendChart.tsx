import React, { useMemo, useState } from 'react';
import type { FunnelTrends, StageId } from './funnelApi';

// Categorical slots 1-4, fixed order: colour follows the stage, never its rank or visibility.
export const STAGE_META: { id: StageId; label: string; color: string }[] = [
  { id: 'signed_up', label: 'Signed up', color: '#2a78d6' },
  { id: 'free_wash_redeemed', label: 'Free wash redeemed', color: '#eb6834' },
  { id: 'subscribed', label: 'Subscribed', color: '#1baf7a' },
  { id: 'first_full_renewal', label: 'First full-price renewal', color: '#eda100' }
];

const W = 960;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

const niceMax = (v: number) => {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
};
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function FunnelTrendChart({ trends, labels }: { trends: FunnelTrends; labels?: Record<StageId, string> }) {
  const [hidden, setHidden] = useState<Set<StageId>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const { days, series } = trends;
  const meta = STAGE_META.map((s) => ({ ...s, label: labels?.[s.id] || s.label }));
  const shown = meta.filter((s) => !hidden.has(s.id));

  const yMax = useMemo(() => niceMax(Math.max(1, ...shown.flatMap((s) => series[s.id]))), [shown, series]);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
  const labelEvery = Math.max(1, Math.ceil(days.length / 10));

  const toggle = (id: StageId) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < STAGE_META.length - 1) next.add(id);
      return next;
    });

  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const box = ev.currentTarget.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const i = days.length <= 1 ? 0 : Math.round(((px - PAD.left) / innerW) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };

  if (days.length === 0) return <div className="text-sm text-slate-500 py-8 text-center">No days in this period.</div>;

  return (
    <div>
      {/* Legend doubles as the show/hide control */}
      <div className="flex flex-wrap gap-2 mb-3">
        {meta.map((s) => {
          const off = hidden.has(s.id);
          const total = series[s.id].reduce((a, b) => a + b, 0);
          return (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              aria-pressed={!off}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-all ${off ? 'border-[#e5e5e5] bg-[#fafafa] text-slate-400' : 'border-[#d4d4d4] bg-white text-slate-800'}`}
            >
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: off ? '#cbd5e1' : s.color, height: 3 }} />
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums font-semibold">{total.toLocaleString()}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="People reaching each funnel stage per day" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={i === 0 ? '#a3a3a3' : '#ececec'} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={11} fill="#737373">{t}</text>
            </g>
          ))}
          {days.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#737373">{dayLabel(d)}</text>
            ) : null
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#a3a3a3" strokeWidth={1} strokeDasharray="3 3" />}
          {shown.map((s) => (
            <g key={s.id}>
              <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={series[s.id].map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
              {hover !== null && <circle cx={x(hover)} cy={y(series[s.id][hover])} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />}
            </g>
          ))}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 shadow-md text-xs"
            style={x(hover) / W > 0.6 ? { right: `${100 - (x(hover) / W) * 100 + 2}%` } : { left: `${(x(hover) / W) * 100 + 2}%` }}
          >
            <div className="font-semibold text-black mb-1">{dayLabel(days[hover])}</div>
            {shown.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 text-slate-700">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 rounded" style={{ background: s.color, height: 3 }} />
                  {s.label}
                </span>
                <span className="tabular-nums font-semibold text-black">{series[s.id][hover]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Table view: the same numbers without relying on colour */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-[#e5e5e5]">
              <th className="py-1.5 font-medium">Stage</th>
              <th className="py-1.5 font-medium text-right">Total</th>
              <th className="py-1.5 font-medium text-right">Daily avg</th>
              <th className="py-1.5 font-medium text-right">Peak day</th>
            </tr>
          </thead>
          <tbody>
            {meta.map((s) => {
              const vals = series[s.id];
              const total = vals.reduce((a, b) => a + b, 0);
              const peak = Math.max(...vals);
              return (
                <tr key={s.id} className="border-b border-[#f2f2f2] text-slate-800">
                  <td className="py-1.5">{s.label}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{total.toLocaleString()}</td>
                  <td className="py-1.5 text-right tabular-nums">{(total / vals.length).toFixed(1)}</td>
                  <td className="py-1.5 text-right tabular-nums">{peak > 0 ? `${peak} · ${dayLabel(days[vals.indexOf(peak)])}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
