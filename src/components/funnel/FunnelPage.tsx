import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Calendar, ChevronDown, Pencil, RefreshCw, X } from 'lucide-react';
import { fetchDefinition, fetchFlows, fetchFunnelGraph, fetchFunnelPerformance, fetchFunnelTrends, type CohortStage, type FlowsResponse, type FunnelDefinition, type FunnelGraphStats, type FunnelPerformance, type FunnelTrends, type StageId } from './funnelApi';
import { DefinitionEditor } from './DefinitionEditor';
import { MF_NODES, MF_NODE_FLOW, WHY_TEXT, deriveWhen, isApprovedTemplate } from './funnelGraph';
import { delayBefore } from './flowTiming';
import { MembershipFlowChart, stepStateOf } from './MembershipFlowChart';
import { FunnelTrendChart, STAGE_META } from './FunnelTrendChart';
import { FlowsPanel } from './FlowsPanel';
import { PerformancePanel } from './PerformancePanel';
import { FreeWashConversionFunnel, PaidWashConversionFunnel, SignupConversionFunnel } from '../charts/ConversionFunnel';
import { EngagementDashboard } from '../charts/EngagementDashboard';
import { TemplatesCatalogPanel } from './TemplatesCatalogPanel';

type Tab = 'funnel' | 'free_funnel' | 'paid_funnel' | 'signup_funnel' | 'engagement' | 'performance' | 'flows' | 'trends' | 'templates';
type Preset = 'yesterday' | '7' | '30' | '90' | 'all';

const DAY = 86_400_000;
const POLL_MS = 60_000;
const YESTERDAY = new Date('2026-11-09T21:00:00Z'); // Tuesday 10 Nov 2026, 00:00 Riyadh: funnel baseline
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'yesterday', label: 'Since yesterday (10 Nov 2026)' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'all', label: 'All time' }
];
const presetFrom = (p: Preset): Date | null => (p === 'all' ? null : p === 'yesterday' ? YESTERDAY : new Date(Date.now() - Number(p) * DAY));

const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString() : '—');
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const DEFAULT_LABELS = Object.fromEntries(STAGE_META.map((s) => [s.id, s.label])) as Record<StageId, string>;

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e5e5e5] bg-white p-5">
      <h3 className="text-sm font-bold text-black">{title}</h3>
      {note && <p className="text-xs text-slate-500 mt-0.5 mb-4">{note}</p>}
      {children}
    </section>
  );
}

/** Strict cohort funnel: one bar per stage, same hue (the bars are one measure, so position carries the meaning). */
function CohortBars({ stages, labels }: { stages: CohortStage[]; labels: Record<StageId, string> }) {
  const STAGE_LABEL = labels;
  const top = stages[0]?.count ?? 0;
  return (
    <div className="space-y-3">
      {stages.map((s, i) => (
        <div key={s.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs mb-1">
            <span className="font-semibold text-black">
              {i + 1}. {STAGE_LABEL[s.id]}
            </span>
            <span className="text-slate-600 tabular-nums">
              <span className="text-sm font-bold text-black">{s.count.toLocaleString()}</span>
              {i > 0 && (
                <>
                  {' '}· {s.pctOfPrevious}% of previous · {s.pctOfTop}% of sign-ups
                  {s.medianDaysFromPrevious !== null && <> · median {s.medianDaysFromPrevious} days</>}
                </>
              )}
            </span>
          </div>
          <div className="h-3 rounded bg-[#f2f2f2]" title={`${STAGE_LABEL[s.id]}: ${s.count.toLocaleString()}`}>
            <div className="h-3 rounded bg-[#2a78d6]" style={{ width: `${top > 0 ? Math.max(s.count > 0 ? 0.5 : 0, (s.count / top) * 100) : 0}%` }} />
          </div>
          {i > 0 && (s.dropOffCount > 0 || s.outsideChain > 0) && (
            <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
              {s.dropOffCount > 0 && <>{s.dropOffCount.toLocaleString()} did not get here from the previous stage</>}
              {s.dropOffCount > 0 && s.outsideChain > 0 && ' · '}
              {s.outsideChain > 0 && <>{s.outsideChain.toLocaleString()} more reached this stage without the previous one (not counted above)</>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StepDetail({ nodeId, stats, flows, onClose }: { nodeId: string; stats: FunnelGraphStats | null; flows: FlowsResponse | null; onClose: () => void }) {
  const node = MF_NODES.find((n) => n.id === nodeId);
  if (!node) return null;
  const count = stats ? (stats.nodes[node.id] ?? null) : null;
  const why = stats && count === null ? stats.why[node.id] : undefined;
  const ref = MF_NODE_FLOW[node.id];
  const flow = ref ? flows?.flows.find((f) => f.id === ref.flowId) : undefined;
  const state = stepStateOf(node.id, flows?.flows ?? null);
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {node.stage && <div className="text-[11px] text-slate-500">Stage {node.stage}</div>}
          <div className="text-sm font-bold text-black">{node.title}</div>
          {deriveWhen(node, flows?.flows ?? null) && <div className="text-xs text-slate-500">{deriveWhen(node, flows?.flows ?? null)}</div>}
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-black">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div>
          <div className="text-slate-500">Reached</div>
          <div className="text-xl font-bold tabular-nums text-black">{fmt(count)}</div>
          {count === null && <div className="text-slate-500">{why ? WHY_TEXT[why] : 'Not measured yet'}</div>}
        </div>
        {node.kind === 'step' && (
          <div>
            <div className="text-slate-500">Automation</div>
            {flow ? (
              <div className="text-slate-800 mt-0.5">
                <div className="font-semibold text-black">{flow.name?.en || (typeof flow.name === "string" ? flow.name : flow.id)}</div>
                <div>{state === 'on' ? 'Running' : state === 'step_off' ? 'This step is switched off' : `Flow is ${flow.status}`}</div>
              </div>
            ) : (
              <div className="text-slate-800 mt-0.5">No live flow sends this step yet.</div>
            )}
          </div>
        )}
        {node.variants && (
          <div>
            <div className="text-slate-500">Templates</div>
            <ul className="mt-0.5 space-y-0.5">
              {node.variants.map((v, i) => (
                <li key={i} className="text-slate-800">
                  <code>{v.template}</code>{' '}
                  <span className={isApprovedTemplate(v.template) ? 'text-emerald-700' : 'text-amber-600'}>{isApprovedTemplate(v.template) ? 'approved' : 'needs approval'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function FunnelPage({ onBack }: { onBack: () => void }) {
  const initialTab = useMemo<Tab>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('tab');
      if (q && ['funnel', 'free_funnel', 'paid_funnel', 'signup_funnel', 'engagement', 'performance', 'flows', 'trends'].includes(q)) {
        return q as Tab;
      }
    } catch (e) {}
    return 'funnel';
  }, []);
  const [tab, setTab] = useState<Tab>(initialTab);

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', newTab);
      window.history.replaceState({}, '', url.toString());
    } catch (e) {}
  };
  const [preset, setPreset] = useState<Preset>('yesterday');
  const [stats, setStats] = useState<FunnelGraphStats | null>(null);
  const [trends, setTrends] = useState<FunnelTrends | null>(null);
  const [perf, setPerf] = useState<FunnelPerformance | null>(null);
  const [perfError, setPerfError] = useState<string | null>(null);
  const [flows, setFlows] = useState<FlowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [definition, setDefinition] = useState<FunnelDefinition | null>(null);
  const [editingDef, setEditingDef] = useState(false);
  const labels = definition?.stageLabels ?? DEFAULT_LABELS;
  const reminderDay = definition?.freeWashReminderDay ?? 5;
  const expiryDay = definition?.freeWashExpiryDay ?? 7;

  // A failed read clears the numbers: nothing stale is ever shown as current.
  const load = useCallback(
    async (blank: boolean) => {
      if (blank) {
        setStats(null);
        setTrends(null);
        setPerf(null);
      }
      setLoading(true);
      const from = presetFrom(preset);
      const to = new Date();
      const [g, t, f, d, p] = await Promise.allSettled([fetchFunnelGraph(from, to, false), fetchFunnelTrends(from, to), fetchFlows(), fetchDefinition(), fetchFunnelPerformance(from, to)]);
      setStats(g.status === 'fulfilled' ? g.value : null);
      setTrends(t.status === 'fulfilled' ? t.value : null);
      setPerf(p.status === 'fulfilled' ? p.value : null);
      setPerfError(p.status === 'rejected' ? (p.reason as Error).message : null);
      if (f.status === 'fulfilled') setFlows(f.value);
      if (d.status === 'fulfilled') setDefinition(d.value);
      setError(g.status === 'rejected' ? (g.reason as Error).message : null);
      if (g.status === 'fulfilled') setUpdatedAt(new Date());
      setLoading(false);
    },
    [preset]
  );

  useEffect(() => {
    void load(true);
    const tick = () => {
      if (!document.hidden) void load(false);
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  const tiles = useMemo(
    () => [
      { label: 'Sign-ups', value: stats?.cohortSize ?? null },
      { label: 'Redeemed free wash', value: stats?.redeemedTotal ?? null },
      { label: 'Became members', value: stats?.nodes.members ?? null },
      { label: 'Renewed at full price', value: stats?.nodes.fnf ?? null }
    ],
    [stats]
  );

  // The free-wash arrows are counted with the definition's reminder day. If the live reminder flow waits a different time, say so.
  const flowReminderDay = useMemo(() => {
    const flow = flows?.flows.find((f) => f.id === MF_NODE_FLOW.s1remind.flowId);
    const step = flow?.steps.find((s) => s.id === MF_NODE_FLOW.s1remind.stepId);
    return flow && step ? delayBefore(flow.steps, step.id) / 24 : null;
  }, [flows]);

  const templateNames = useMemo(() => Array.from(new Set(MF_NODES.flatMap((n) => n.variants?.map((v) => v.template) ?? []))), []);
  const approved = templateNames.filter(isApprovedTemplate).length;

  const tabs: { id: Tab; label: string; badge?: string }[] = [
    { id: 'funnel', label: 'Lifecycle Flow' },
    { id: 'free_funnel', label: 'Free Wash Funnel', badge: 'Cohort' },
    { id: 'paid_funnel', label: 'Paid Wash Funnel', badge: 'Cohort' },
    { id: 'signup_funnel', label: 'Signup Funnel' },
    { id: 'engagement', label: 'Nudges & Reminders' },
    { id: 'performance', label: 'Performance' },
    { id: 'flows', label: `Flows${flows ? ` (${flows.flows.length})` : ''}` },
    { id: 'trends', label: 'Daily trends' },
    { id: 'templates', label: 'Templates Catalog', badge: '35 Approved' }
  ];

  return (
    <>
      <header className="bg-white border-b border-[#e5e5e5] sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={onBack} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-black bg-white border border-[#e5e5e5] hover:border-slate-300 rounded-lg" title="Back to the dashboard">
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </button>
              <div className="min-w-0">
                <h1 className="text-base font-black font-display text-black tracking-tight">Funnel &amp; Flows</h1>
                <p className="text-[11px] text-slate-500 truncate">From sign-up and free wash, to membership, to the first full-price renewal.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {updatedAt && !error && (
                <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Updated <span className="tabular-nums">{updatedAt.toLocaleTimeString()}</span>
                </span>
              )}
              <div className="relative">
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as Preset)}
                  aria-label="Period"
                  className="appearance-none bg-white border border-[#e5e5e5] hover:border-slate-400 text-slate-800 text-xs font-semibold py-1.5 pl-8 pr-7 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#c91e2f]/20 focus:border-[#c91e2f] cursor-pointer"
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <Calendar className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <button
                onClick={() => setTab('templates')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm transition-all"
                title="View & Refresh WhatsApp Templates"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Update Templates</span>
              </button>
              <button onClick={() => void load(false)} disabled={loading} title="Refresh" className="p-1.5 text-slate-500 hover:text-slate-800 bg-white border border-[#e5e5e5] hover:border-slate-300 rounded-lg disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#c91e2f]' : ''}`} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 pt-2.5 overflow-x-auto no-scrollbar" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => handleTabChange(t.id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${tab === t.id ? 'bg-black text-white' : 'text-slate-600 hover:text-black hover:bg-[#f2f2f2]'}`}
              >
                <span>{t.label}</span>
                {t.badge && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                    tab === t.id ? 'bg-white/20 text-white' : 'bg-rose-50 text-[#c91e2f]'
                  }`}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-2 text-sm text-red-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Could not load the funnel numbers. None are shown rather than wrong ones.</div>
              <div className="text-xs mt-0.5">{error}. Check that the API server is running (npm run dev:full) and MongoDB is reachable.</div>
            </div>
          </div>
        )}

        {tab === 'funnel' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tiles.map((t, i) => (
              <div key={t.label} className="rounded-2xl border border-[#e5e5e5] bg-white p-4">
                <div className="text-xs text-slate-500">{t.label}</div>
                <div className="text-2xl font-bold tabular-nums text-black mt-1">{fmt(t.value)}</div>
                {i > 0 && t.value !== null && stats && <div className="text-xs text-slate-500 tabular-nums mt-0.5">{pct(t.value, stats.cohortSize)}% of sign-ups</div>}
              </div>
            ))}
          </div>
        )}

        {tab === 'funnel' && (
          <>
            <p className="text-xs text-slate-500 -mt-2">
              Numbers count people who signed up in this period and what they did afterwards. Read live from the Rush database; the Rush data is never written to.
              {stats && !stats.sources.funnelDb && ' The funnel database could not be read, so messages sent and offers are shown as dashes.'}
            </p>

            {flowReminderDay !== null && flowReminderDay !== reminderDay && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  The free-wash reminder flow sends on day {Math.round(flowReminderDay * 10) / 10}, but the numbers below are counted with day {reminderDay}. Update the funnel definition so they match.
                </span>
              </div>
            )}

            {editingDef && definition && (
              <DefinitionEditor
                definition={definition}
                onClose={() => setEditingDef(false)}
                onSaved={(d) => {
                  setDefinition(d);
                  void load(false);
                }}
              />
            )}

            <Card title="Conversion funnel" note="Each stage counts only people who came through the stage before it.">
              {definition && !editingDef && (
                <button
                  onClick={() => setEditingDef(true)}
                  disabled={!definition.editable}
                  title={definition.editable ? 'Edit stage names and free-wash days' : 'The funnel database is not reachable, so the definition cannot be edited right now'}
                  className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-black hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Pencil className="w-3 h-3" /> Edit funnel definition
                </button>
              )}
              {stats ? <CohortBars stages={stats.cohort.stages} labels={labels} /> : <div className="h-40 rounded-lg bg-[#fafafa] animate-pulse" />}
            </Card>

            {stats && (
              <Card title="Free-wash redemption speed" note={`How quickly new sign-ups use the free wash before it expires on day ${expiryDay}.`}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  {[
                    { label: `Redeemed within ${reminderDay} days`, value: stats.edges.e3 },
                    { label: `Redeemed in days ${reminderDay} to ${expiryDay}`, value: stats.edges.e5 },
                    { label: `Not redeemed by day ${expiryDay}`, value: stats.edges.e4 }
                  ].map((x) => (
                    <div key={x.label}>
                      <div className="text-slate-500">{x.label}</div>
                      <div className="text-xl font-bold tabular-nums text-black">{fmt(x.value)}</div>
                      {typeof x.value === 'number' && <div className="text-slate-500 tabular-nums">{pct(x.value, stats.cohortSize)}% of sign-ups</div>}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-3">“Not redeemed” counts only people whose {expiryDay} days have already passed.</p>
              </Card>
            )}

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <h3 className="text-sm font-bold text-black">Membership funnel map</h3>
                <p className="text-xs text-slate-500">
                  {approved}/{templateNames.length} WhatsApp templates approved (green). Dashed arrows are not measured yet. Click a step for details.
                </p>
              </div>
              {selectedId && (
                <div className="mb-3">
                  <StepDetail nodeId={selectedId} stats={stats} flows={flows} onClose={() => setSelectedId(null)} />
                </div>
              )}
              <MembershipFlowChart stats={stats} flows={flows?.flows ?? null} reminderDay={reminderDay} expiryDay={expiryDay} selectedId={selectedId} onSelect={(id) => id && setSelectedId(id)} />
            </div>
          </>
        )}

        {tab === 'free_funnel' && (
          <div className="animate-in fade-in duration-150">
            <FreeWashConversionFunnel />
          </div>
        )}

        {tab === 'paid_funnel' && (
          <div className="animate-in fade-in duration-150">
            <PaidWashConversionFunnel />
          </div>
        )}

        {tab === 'signup_funnel' && (
          <div className="animate-in fade-in duration-150">
            <SignupConversionFunnel />
          </div>
        )}

        {tab === 'engagement' && (
          <div className="animate-in fade-in duration-150">
            <EngagementDashboard />
          </div>
        )}

        {tab === 'performance' &&
          (perfError && !error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-2 text-sm text-red-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Could not load the performance numbers. None are shown rather than wrong ones.</div>
                <div className="text-xs mt-0.5">{perfError}</div>
              </div>
            </div>
          ) : (
            !error && <PerformancePanel data={perf} labels={labels} />
          ))}

        {tab === 'trends' && (
          <Card
            title="People reaching each stage, per day"
            note={`First time each person reached the stage, by Riyadh calendar day.${trends?.clipped ? ' Showing the most recent 120 days of this period.' : ''}`}
          >
            {trends ? <FunnelTrendChart trends={trends} labels={labels} /> : <div className="h-72 rounded-lg bg-[#fafafa] animate-pulse" />}
          </Card>
        )}

        {tab === 'flows' && (flows ? <FlowsPanel data={flows} onChanged={() => void load(false)} freeWashExpiryDay={expiryDay} /> : <div className="h-72 rounded-2xl bg-white border border-[#e5e5e5] animate-pulse" />)}

        {tab === 'templates' && (
          <div className="animate-in fade-in duration-150">
            <TemplatesCatalogPanel />
          </div>
        )}
      </main>
    </>
  );
}

export default FunnelPage;
