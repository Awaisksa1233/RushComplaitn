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
  variants?: { key: 'A' | 'B' | 'C'; templateId: string; weight: number }[];
  holdoutPct?: number;
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
  trigger?: FlowTrigger;
  exitWhen?: ExitRule[];
  reentry?: 'once' | 'per_cycle';
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

export function fetchFlows(): Promise<FlowsResponse> {
  return get<FlowsResponse>('/api/funnel/flows');
}
