import React from 'react';
import type { AbTest, FunnelPerformance, PerformanceStep, StageId, TemplatePerformance } from './funnelApi';
import { WHY_TEXT } from './funnelGraph';

/** Performance tab: where customers are right now, every step reached, and which WhatsApp templates convert. */

const STEP_LABEL: Record<string, string> = {
  coupon_sent: 'Free-wash coupon sent',
  fw_reminder_sent: 'Free-wash reminder sent',
  offer_a_sent: 'Offer A sent (100 SAR membership)',
  offer_b_sent: 'Offer B sent (50 SAR wallet balance)',
  offer_c_sent: 'Offer C sent (free interior visit)',
  offer_d_sent: 'Offer D sent (free interior month)',
  offer_reminder_sent: 'Offer reminder sent',
  offer_redeemed: 'Offer redeemed (promo code)',
  membership_offer_sent: 'Membership offer sent',
  membership_reminder_sent: 'Membership reminder sent'
};
const WHY: Record<string, string> = { ...WHY_TEXT, pfWhyNoGoal: 'The flow that sends this has no conversion goal, so only volume is shown.' };

const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString() : '—');
const fmtPct = (n: number | null | undefined) => (typeof n === 'number' ? `${n}%` : '—');

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e5e5e5] bg-white p-5">
      <h3 className="text-sm font-bold text-black">{title}</h3>
      {note && <p className="text-xs text-slate-500 mt-0.5 mb-4">{note}</p>}
      {children}
    </section>
  );
}

/** One bar per step, one hue: the bars are a single measure, so length carries the meaning. Unmeasured steps show a dash and the reason. */
function StepBars({ steps, label, pctOf, pctText }: { steps: PerformanceStep[]; label: (id: string) => string; pctOf: (s: PerformanceStep) => number | null | undefined; pctText: string }) {
  const max = Math.max(1, ...steps.map((s) => s.count ?? 0));
  return (
    <div className="space-y-2.5">
      {steps.map((s) => (
        <div key={s.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs mb-1">
            <span className={s.kind === 'stage' ? 'font-semibold text-black' : 'text-slate-700 pl-3'}>{label(s.id)}</span>
            <span className="text-slate-600 tabular-nums">
              <span className="text-sm font-bold text-black">{fmt(s.count)}</span>
              {typeof pctOf(s) === 'number' && <> · {pctOf(s)}% {pctText}</>}
            </span>
          </div>
          {s.count === null ? (
            <div className="text-[11px] text-slate-500">{s.why ? WHY[s.why] : 'Not measured yet'}</div>
          ) : (
            <div className="h-2.5 rounded bg-[#f2f2f2]" title={`${label(s.id)}: ${s.count.toLocaleString()}`}>
              <div className="h-2.5 rounded bg-[#2a78d6]" style={{ width: `${s.count > 0 ? Math.max(0.5, (s.count / max) * 100) : 0}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ConversionCell({ t, minMatured }: { t: TemplatePerformance; minMatured: number }) {
  if (t.eligible === null) return <span className="text-slate-500">{t.why ? WHY[t.why] : '—'}</span>;
  return (
    <div>
      <div className="tabular-nums">
        {t.matured ? (
          <>
            <span className={`text-sm font-bold ${t.enough ? 'text-black' : 'text-slate-500'}`}>{fmtPct(t.rate)}</span>{' '}
            <span className="text-slate-500">
              ({fmt(t.converted)} of {fmt(t.matured)})
            </span>
          </>
        ) : (
          <span className="text-slate-500">Too early</span>
        )}
      </div>
      <div className="text-[11px] text-slate-500 tabular-nums">
        So far {fmt(t.convertedSoFar)} of {fmt(t.eligible)} eligible
        {!t.enough && <> · needs {minMatured} past their window to be ranked</>}
      </div>
    </div>
  );
}

const VERDICT: Record<AbTest['verdict'], string> = {
  leader: 'Clear leader',
  no_clear_winner: 'No clear winner yet',
  too_few: 'Too few results to judge',
  no_goal: 'No measurable goal',
  not_measured: 'Not measured'
};

export function PerformancePanel({ data, labels }: { data: FunnelPerformance | null; labels: Record<StageId, string> }) {
  if (!data) return <div className="h-72 rounded-2xl bg-white border border-[#e5e5e5] animate-pulse" />;

  const stepLabel = (id: string) => (labels as Record<string, string>)[id] ?? STEP_LABEL[id] ?? id;
  const goalLabel = (g: string) => (g === 'promo' ? 'Promo code redeemed' : g === 'none' ? 'No goal' : stepLabel(g));
  const { hero, snapshot, reached, templates, abTests, attributionDays, minMatured, sources } = data;
  const tests = abTests.filter((t) => t.variants.some((v) => v.stats));

  const tiles = [
    { label: 'Customers in the funnel', value: fmt(hero.tracked), sub: 'Everyone who has signed up, all time' },
    { label: 'Sign-up to member', value: fmtPct(hero.memberPct), sub: `${fmt(hero.members)} of ${fmt(hero.cohortSize)} who signed up in this period` },
    {
      label: 'Best template',
      value: hero.best ? hero.best.templateId : '—',
      sub: hero.best ? `${hero.best.rate}% reached "${goalLabel(hero.best.goal)}" within ${attributionDays} days` : `No template has ${minMatured} results past the ${attributionDays}-day window yet`
    },
    {
      label: 'Biggest drop-off',
      value: hero.dropOff ? fmt(hero.dropOff.count) : '—',
      sub: hero.dropOff ? `${stepLabel(hero.dropOff.from)} → ${stepLabel(hero.dropOff.to)}${hero.dropOff.pctLost !== null ? ` (${hero.dropOff.pctLost}% lost)` : ''}` : 'No drop-off in this period'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-[#e5e5e5] bg-white p-4 min-w-0">
            <div className="text-xs text-slate-500">{t.label}</div>
            <div className="text-2xl font-bold tabular-nums text-black mt-1 truncate" title={t.value}>{t.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{t.sub}</div>
          </div>
        ))}
      </div>

      {!sources.messages && (
        <p className="text-xs text-amber-700 -mt-2">The funnel database could not be read, so message steps and template results are shown as dashes.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Where customers are right now" note="Everyone who has signed up, counted once at the furthest step they have reached. Not affected by the period.">
          <StepBars steps={snapshot.steps} label={stepLabel} pctOf={(s) => s.pctOfTotal} pctText="of all" />
          <p className="text-[11px] text-slate-500 mt-3 tabular-nums">
            {snapshot.expiredUnredeemed.toLocaleString()} of the people before “{stepLabel('free_wash_redeemed')}” are past the free-wash expiry day.
          </p>
        </Card>

        <Card title="Steps reached" note="People who signed up in this period, and every step they have reached since. A person can appear in several steps.">
          <StepBars steps={reached.steps} label={stepLabel} pctOf={(s) => s.pctOfTop} pctText="of sign-ups" />
        </Card>
      </div>

      <Card
        title="Template results"
        note={`Messages sent in this period. A template is judged on the goal of the flow that sent it: the customer must get there within ${attributionDays} days of the message. Only customers whose ${attributionDays} days have passed count in the rate.`}
      >
        {templates.length === 0 ? (
          <p className="text-xs text-slate-500">{sources.messages ? 'No WhatsApp messages were sent in this period.' : 'Not measured.'}</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs text-left min-w-[640px]">
              <thead>
                <tr className="text-slate-500 border-b border-[#e5e5e5]">
                  <th className="font-semibold py-2 px-1">Template</th>
                  <th className="font-semibold py-2 px-1">Judged on</th>
                  <th className="font-semibold py-2 px-1 text-right">Sent</th>
                  <th className="font-semibold py-2 px-1 text-right">Delivered</th>
                  <th className="font-semibold py-2 px-1 text-right">Read</th>
                  <th className="font-semibold py-2 px-1">Goal conversion</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={`${t.templateId}|${t.goal}`} className="border-b border-[#f2f2f2] align-top">
                    <td className="py-2 px-1">
                      <code className="text-black">{t.templateId}</code>
                      {(t.untracked > 0 || !!t.alreadyReached) && (
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          Left out: {[t.untracked > 0 && `${t.untracked.toLocaleString()} not in the funnel`, !!t.alreadyReached && `${t.alreadyReached.toLocaleString()} already there`].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-1 text-slate-800">{goalLabel(t.goal)}</td>
                    <td className="py-2 px-1 text-right tabular-nums">{fmt(t.sent)}</td>
                    <td className="py-2 px-1 text-right tabular-nums">{fmtPct(t.deliveredPct)}</td>
                    <td className="py-2 px-1 text-right tabular-nums">{fmtPct(t.readPct)}</td>
                    <td className="py-2 px-1">
                      <ConversionCell t={t} minMatured={minMatured} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sources.messages && !sources.receipts && templates.length > 0 && (
          <p className="text-[11px] text-slate-500 mt-3">Delivered and read are dashes because no delivery receipts are recorded yet: every message is only marked as sent.</p>
        )}
        <p className="text-[11px] text-slate-500 mt-1">A customer who got two templates before converting counts for both, so compare templates with care. The A/B tests below split customers at random and are the fair comparison.</p>
      </Card>

      <Card title="A/B tests" note="Flow steps that split customers between templates. A leader is named only when the gap is statistically significant.">
        {tests.length === 0 ? (
          <p className="text-xs text-slate-500">No A/B step has sent messages in this period.</p>
        ) : (
          <div className="space-y-4">
            {tests.map((t) => (
              <div key={`${t.flowId}|${t.stepId}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                  <span className="font-semibold text-black">
                    {t.flowName} · {t.stepName}
                  </span>
                  <span className={t.verdict === 'leader' ? 'font-semibold text-emerald-700' : 'text-slate-500'}>
                    {VERDICT[t.verdict]}
                    {t.leader && `: ${t.leader}`}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mb-1.5">Judged on: {goalLabel(t.goal)}</div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {t.variants.map((v) => (
                    <div key={v.key} className={`rounded-xl border p-3 text-xs min-w-0 ${t.leader === v.key ? 'border-emerald-600' : 'border-[#e5e5e5]'}`}>
                      <div className="text-slate-500">
                        {v.key} · {v.weight}%
                      </div>
                      <code className="block truncate text-black" title={v.templateId}>{v.templateId}</code>
                      <div className="text-lg font-bold tabular-nums text-black mt-1">{v.stats?.enough ? fmtPct(v.stats.rate) : '—'}</div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {!v.stats
                          ? 'Nothing sent'
                          : v.stats.matured
                            ? `${fmt(v.stats.sent)} sent · ${fmt(v.stats.converted)} of ${fmt(v.stats.matured)} converted`
                            : `${fmt(v.stats.sent)} sent · too early to judge`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default PerformancePanel;
