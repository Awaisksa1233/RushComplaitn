/** Pure KPI computation over complaint docs (testable without Mongo). */
const DAY = 24 * 60 * 60 * 1000;
export const ACTIVE = ['new', 'in_review', 'investigating'];

export function computeStats(complaints, { now = Date.now(), slaHours = 24, trendDays = 14 } = {}) {
  const active = complaints.filter(c => ACTIVE.includes(c.status));
  const slaMs = slaHours * 3600 * 1000;
  const overdue = active.filter(c => now - c.createdAt > slaMs);

  const closed = complaints.filter(c => !ACTIVE.includes(c.status));
  const times = closed.map(c => (c.resolvedAtMs || c.updatedAt) - c.createdAt).filter(t => t >= 0);
  const avgResolutionHours = times.length ? times.reduce((a, b) => a + b, 0) / times.length / 3600000 : null;

  const countBy = (arr, key) => arr.reduce((m, c) => { const k = c[key] || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {});

  const trend = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const start = new Date(now - i * DAY); start.setUTCHours(0, 0, 0, 0);
    const s = start.getTime(), e = s + DAY;
    trend.push({
      date: start.toISOString().slice(0, 10),
      created: complaints.filter(c => c.createdAt >= s && c.createdAt < e).length,
      closed: closed.filter(c => (c.resolvedAtMs || c.updatedAt) >= s && (c.resolvedAtMs || c.updatedAt) < e).length
    });
  }

  return {
    total: complaints.length,
    open: active.length,
    overdue: overdue.length,
    slaHours,
    resolved: closed.filter(c => c.status === 'resolved').length,
    rejected: closed.filter(c => c.status === 'rejected').length,
    avgResolutionHours: avgResolutionHours === null ? null : Math.round(avgResolutionHours * 10) / 10,
    byStatus: countBy(complaints, 'status'),
    byCategory: countBy(complaints, 'category'),
    byResolution: countBy(closed.filter(c => c.resolutionType), 'resolutionType'),
    unassigned: active.filter(c => !c.assignedTo).length,
    trend
  };
}
