import type { FlowDraft, FlowStep, FlowTrigger } from './funnelApi';

/** The parts of a flow the timing helpers read: satisfied by both a live FlowConfig and a FlowDraft. */
export interface TimedFlow {
  steps: FlowStep[];
  trigger?: FlowTrigger;
  maxReminders?: number;
  window: FlowDraft['window'];
}

export interface TimelinePoint {
  stepId: string;
  name: string;
  /** Hours after the customer enters the flow, counting only the waits, before sends are pushed to the next send window. */
  atHours: number;
  kind: 'send' | 'deadline';
  reminder: boolean;
  /** Where a deadline leads: 'exit', 'next' or a step id. */
  onExpire?: string;
}

/** Cumulative time of each message and deadline. A wait counts from the step before it; a switched-off step is skipped. */
export function computeTimeline(steps: FlowStep[]): TimelinePoint[] {
  const out: TimelinePoint[] = [];
  let t = 0;
  for (const s of steps) {
    if (s.paused) continue;
    if (s.kind === 'wait') t += Math.max(0, s.waitHours ?? 0);
    if (s.kind === 'send_template') {
      out.push({ stepId: s.id, name: s.name.en, atHours: t, kind: 'send', reminder: !!s.reminder });
      if (s.deadline) out.push({ stepId: s.id, name: s.name.en, atHours: t + s.deadline.afterHours, kind: 'deadline', reminder: false, onExpire: s.deadline.onExpire });
    }
  }
  return out.sort((a, b) => a.atHours - b.atHours || (a.kind === 'send' ? -1 : 1));
}

/** "Right away", "6 hours", "Day 2", "Day 5": the same wording the funnel map uses. */
export function formatElapsed(hours: number): string {
  if (hours <= 0) return 'Right away';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  if (hours % 24 === 0) return `Day ${hours / 24}`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

/** The delay in front of a send step: the waits between the previous message (or the start) and it. */
export function delayBefore(steps: FlowStep[], stepId: string): number {
  let total = 0;
  for (const s of steps) {
    if (s.id === stepId) return total;
    if (s.paused) continue;
    if (s.kind === 'wait') total += s.waitHours ?? 0;
    if (s.kind === 'send_template') total = 0;
  }
  return total;
}

export const SIGNUP_FLOW_TRIGGERS = new Set(['signed_up']);

/** Problems worth a second look. They warn; they never block saving. */
export function timingWarnings(flow: TimedFlow, freeWashExpiryDay: number): string[] {
  const out: string[] = [];
  const points = computeTimeline(flow.steps);
  const sends = points.filter((p) => p.kind === 'send');
  const reminders = sends.filter((p) => p.reminder);

  for (const r of reminders) {
    if (delayBefore(flow.steps, r.stepId) === 0) out.push(`“${r.name}” is marked as a reminder but sends right away. Add a delay before it.`);
    for (const d of points) {
      if (d.kind === 'deadline' && d.stepId !== r.stepId && d.onExpire === 'exit' && d.atHours <= r.atHours && sends.some((s) => s.stepId === d.stepId && s.atHours < r.atHours)) {
        out.push(`Customers leave the flow at ${formatElapsed(d.atHours)} (deadline of “${d.name}”), before “${r.name}” is due at ${formatElapsed(r.atHours)}.`);
      }
    }
    if (flow.trigger?.type === 'event' && SIGNUP_FLOW_TRIGGERS.has(flow.trigger.stageId) && r.atHours > freeWashExpiryDay * 24) {
      out.push(`“${r.name}” is due at ${formatElapsed(r.atHours)}, after the free wash expires on day ${freeWashExpiryDay}.`);
    }
  }
  if (flow.maxReminders !== undefined && reminders.length > flow.maxReminders) {
    out.push(`This flow has ${reminders.length} reminders but a cap of ${flow.maxReminders} per customer, so the last ${reminders.length - flow.maxReminders} will never send.`);
  }
  for (const s of flow.steps) {
    if (s.kind === 'wait' && !s.paused && (s.waitHours ?? 0) === 0) out.push(`“${s.name.en}” waits 0 hours, so it has no effect.`);
  }
  return out;
}
