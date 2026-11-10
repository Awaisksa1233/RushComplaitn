/** Client for the read-only Funnel & Flows endpoints (server/funnel.js). Failures throw: the page then shows no numbers. */

export type StageId = 'signed_up' | 'free_wash_redeemed' | 'subscribed' | 'first_full_renewal';

export interface CohortStage {
  id: StageId;
  /** Cohort members who reached this stage through the previous one. */
  count: number;
  /** Reached this stage without the previous one (e.g. subscribed without a free wash). Reported, not counted above. */
  outsideChain: number;
  pctOfPrevious: number;
  pctOfTop: number;
  dropOffCount: number;
  medianDaysFromPrevious: number | null;
}

export interface FunnelGraphStats {
  window: { from: string; to: string };
  /** People who signed up in the window. */
  cohortSize: number;
  redeemedTotal: number;
  /** Per chart node: how many people reached it. null = not measured. */
  nodes: Record<string, number | null>;
  /** Per chart arrow: how many people took it. */
  edges: Record<string, number | null>;
  /** Messages sent per WhatsApp template in the window. null = the funnel database could not be read. */
  templateSent: Record<string, number> | null;
  promoRedemptions: { offerB: number | null; offerC: number | null };
  why: Record<string, string>;
  cohort: { cohortSize: number; stages: CohortStage[] };
  sources: { funnelDb: boolean; messages: boolean; eventsAsOf: string };
}

export interface FunnelTrends {
  window: { from: string; to: string };
  days: string[];
  series: Record<StageId, number[]>;
  clipped: boolean;
}

export type FlowStepKind = 'send_template' | 'wait' | 'condition' | 'ab_split' | 'grant_offer';

export interface FlowStep {
  id: string;
  kind: FlowStepKind;
  name: { en: string; ar?: string };
  templateId?: string;
  variants?: { key: 'A' | 'B' | 'C' | 'D'; templateId: string; weight: number }[];
  holdoutPct?: number;
  /** Marks a follow-up message; counted against the flow's maxReminders. */
  reminder?: boolean;
  /** How long the customer has to act after this message before they move on. Needs the funnel runtime to enforce it. */
  deadline?: { afterHours: number; onExpire: string };
  waitHours?: number;
  condition?: { check: { type: string; [k: string]: unknown }; yes: string | null; no: string | null };
  paused: boolean;
}

export type FlowTrigger =
  | { type: 'event'; stageId: string; maxAgeHours?: number }
  | { type: 'segment'; segment: string }
  | { type: 'promo_redeemed'; offers: string[]; maxAgeHours?: number }
  | { type: 'offer_sent'; templateIds: string[]; fromFlowId?: string; maxAgeHours?: number };

export type ExitRule =
  | { type: 'stage_reached'; stageId: string }
  | { type: 'has_entitled_subscription' }
  | { type: 'promo_redeemed'; offers: string[] };

export interface FlowConfig {
  id: string;
  number: number;
  name: { en: string; ar?: string };
  description: { en: string; ar?: string };
  status: string;
  volume: { perHour: number; perDay: number };
  window: { days: number[]; startHour: number; endHour: number };
  audience: { count: number; overlap: number; measured?: boolean };
  approveFirstBatch: boolean;
  steps: FlowStep[];
  hasDraft: boolean;
  /** Unpublished edits. Never sent; the live fields above stay in force until the draft is published in the Funnel control panel. */
  draft?: FlowDraft;
  trigger?: FlowTrigger;
  exitWhen?: ExitRule[];
  maxReminders?: number;
  reentry?: 'once' | 'per_cycle';
}

/** The editable part of a flow. */
export interface FlowDraft {
  name: { en: string; ar?: string };
  description: { en: string; ar?: string };
  status: 'running' | 'paused';
  window: { days: number[]; startHour: number; endHour: number };
  volume: { perHour: number; perDay: number };
  reentry: 'once' | 'per_cycle';
  approveFirstBatch: boolean;
  trigger?: FlowTrigger;
  exitWhen: ExitRule[];
  /** Most reminders one customer gets per run. */
  maxReminders?: number;
  steps: FlowStep[];
}

export interface FunnelDefinition {
  stageLabels: Record<StageId, string>;
  freeWashReminderDay: number;
  freeWashExpiryDay: number;
  /** false = built-in defaults. */
  custom: boolean;
  /** false = the funnel database cannot be written right now. */
  editable: boolean;
}

export interface FlowsResponse {
  /** live = read from the funnel database; seed = built-in definitions only (the funnel database could not be read). */
  source: 'live' | 'seed';
  flows: FlowConfig[];
  settings: { killSwitch?: boolean; testMode?: boolean; quietHours?: { start: string; end: string }; frequencyCap?: unknown } | null;
  sent: { flowId?: string | null; stepId?: string | null; templateId: string; sent: number; lastAt?: string }[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
  return body.data as T;
}

const range = (from: Date | null, to: Date) => {
  const q = new URLSearchParams({ to: to.toISOString() });
  // No start date = everyone since the first sign-up.
  q.set('from', (from ?? new Date(0)).toISOString());
  return q;
};

export function fetchFunnelGraph(from: Date | null, to: Date, includeHistorical: boolean): Promise<FunnelGraphStats> {
  const q = range(from, to);
  if (includeHistorical) q.set('includeHistorical', 'true');
  return get<FunnelGraphStats>(`/api/funnel/graph?${q}`);
}

export function fetchFunnelTrends(from: Date | null, to: Date): Promise<FunnelTrends> {
  return get<FunnelTrends>(`/api/funnel/trends?${range(from, to)}`);
}

/** A step of the membership funnel on the Performance tab. `count` null = not measured (see `why`). */
export interface PerformanceStep {
  id: string;
  kind: 'stage' | 'message' | 'promo';
  /** Templates a message step sends. */
  templates?: string[];
  count: number | null;
  pctOfTop?: number | null;
  pctOfTotal?: number | null;
  why?: string;
}

/** One WhatsApp template judged on one goal. Rates are null when they cannot be measured. */
export interface TemplatePerformance {
  templateId: string;
  /** A stage id, 'promo' (promo code redeemed, not measurable yet) or 'none'. */
  goal: string;
  sent: number;
  recipients: number;
  /** Recipients who are not in the funnel (no portal sign-up), so their outcome is unknown. Left out of the rate. */
  untracked: number;
  /** Recipients who had already reached the goal before the message. Left out of the rate. */
  alreadyReached: number | null;
  eligible: number | null;
  /** Eligible recipients whose attribution window has fully passed. The rate is converted / matured. */
  matured: number | null;
  converted: number | null;
  /** Conversions among all eligible recipients, including those still inside their window. */
  convertedSoFar: number | null;
  rate: number | null;
  /** false = too few matured recipients to judge. */
  enough: boolean;
  deliveredPct: number | null;
  readPct: number | null;
  why?: string;
}

export interface AbTest {
  flowId: string;
  flowName: string;
  stepId: string;
  stepName: string;
  goal: string;
  variants: { key: string; templateId: string; weight: number; stats: TemplatePerformance | null }[];
  verdict: 'leader' | 'no_clear_winner' | 'too_few' | 'no_goal' | 'not_measured';
  leader: string | null;
}

export interface FunnelPerformance {
  window: { from: string; to: string };
  attributionDays: number;
  minMatured: number;
  sources: { messages: boolean; receipts: boolean; funnelDb: boolean; flows: 'live' | 'seed'; eventsAsOf: string };
  hero: {
    tracked: number;
    cohortSize: number;
    members: number;
    memberPct: number | null;
    best: { templateId: string; goal: string; rate: number; matured: number } | null;
    dropOff: { from: StageId; to: StageId; count: number; pctLost: number | null } | null;
  };
  snapshot: { total: number; expiredUnredeemed: number; steps: PerformanceStep[] };
  reached: { cohortSize: number; steps: PerformanceStep[] };
  templates: TemplatePerformance[];
  abTests: AbTest[];
}

export function fetchFunnelPerformance(from: Date | null, to: Date): Promise<FunnelPerformance> {
  return get<FunnelPerformance>(`/api/funnel/performance?${range(from, to)}`);
}

export function fetchFlows(): Promise<FlowsResponse> {
  return get<FlowsResponse>('/api/funnel/flows');
}

async function send<T>(method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
  return json.data as T;
}

/** Saves edits as an unpublished draft. The live flow is not changed. */
export const saveFlowDraft = (flowId: string, draft: FlowDraft) => send<{ hasDraft: boolean }>('PUT', `/api/funnel/flows/${encodeURIComponent(flowId)}/draft`, draft);
/** Applies the saved draft to the live flow. Starting a paused flow needs confirmStart, otherwise the server answers code 'confirm_start'. */
export async function publishFlowDraft(flowId: string, confirmStart = false) {
  const res = await fetch(`/api/funnel/flows/${encodeURIComponent(flowId)}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmStart }) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw Object.assign(new Error(json?.error || `HTTP ${res.status}`), { code: json?.code as string | undefined });
  return json.data as { hasDraft: boolean };
}
export const discardFlowDraft = (flowId: string) => send<{ hasDraft: boolean }>('DELETE', `/api/funnel/flows/${encodeURIComponent(flowId)}/draft`);

export const fetchDefinition = () => get<FunnelDefinition>('/api/funnel/definition');
export const saveDefinition = (d: Pick<FunnelDefinition, 'stageLabels' | 'freeWashReminderDay' | 'freeWashExpiryDay'>) => send<FunnelDefinition>('PUT', '/api/funnel/definition', d);
export const resetDefinition = () => send<FunnelDefinition>('DELETE', '/api/funnel/definition');
