import React, { useState, useMemo } from 'react';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ShieldAlert, 
  Layers, 
  Cpu, 
  Code, 
  Filter, 
  Search, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink, 
  FileText, 
  ArrowRight,
  TrendingDown,
  RefreshCw,
  Sliders,
  Sparkles,
  Info
} from 'lucide-react';

interface RcaItem {
  id: string;
  category: 'waterfall' | 'washes' | 'members' | 'revenue' | 'etl';
  categoryLabel: string;
  title: string;
  severity: 'critical' | 'high' | 'medium';
  status: 'fixed_dashboard' | 'pending_backend' | 'hardware_action' | 'reconciled';
  statusLabel: string;
  systems: string[];
  reportedValue: string;
  groundTruth: string;
  impactSummary: string;
  codeSnippet: string;
  codeExplanation: string;
  remediation: string[];
}

export const RcaMasterView: React.FC<{ onNavigateToKpiGuide?: () => void }> = ({ onNavigateToKpiGuide }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({
    'RCA-01': true,
    'RCA-02': true,
  });

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    rcaData.forEach(item => { all[item.id] = true; });
    setExpandedIds(all);
  };

  const collapseAll = () => {
    setExpandedIds({});
  };

  const rcaData: RcaItem[] = [
    {
      id: 'RCA-01',
      category: 'waterfall',
      categoryLabel: 'Waterfall & Retention',
      title: 'Mathematical Fallacy in Membership Movement Waterfall',
      severity: 'critical',
      status: 'fixed_dashboard',
      statusLabel: 'Fixed in Dashboard · Pending Backend DTO',
      systems: ['rush-frontend', 'rush-backend'],
      reportedValue: 'Closing: 1,688 (Opening 1,682 + Acq 57 − Churn 83 = 1,656)',
      groundTruth: 'Closing: 1,656 (Mathematical identity strictly balanced)',
      impactSummary: 'Existing recurring renewals (45) and recovered card retries (3) were added into gross acquisitions, implying that existing members increase the customer base. "Retention Efficiency" formula conflated top-of-funnel marketing sales with retention.',
      codeSnippet: `// BEFORE (Flawed):
const acquisition = movement.newMembers + reactive + winback + renewFirstTry + recovered;
const churnLosses = movement.voluntaryChurn + movement.involuntaryChurn;
const retentionEfficiencyPct = acquisition / (acquisition + churnLosses) * 100;

// AFTER (Corrected):
const grossAcquisitions = movement.newConversions + movement.reactivations + movement.winbacks;
const closingMembers = openingMembers + grossAcquisitions - totalChurn;
const renewalCollectionRate = (firstTry + recovered) / scheduledRenewals * 100;`,
      codeExplanation: 'Renewals and card recovery preserve existing subscribers; they do not increase total fleet size. They must live in a dedicated Renewal Retention strip below the waterfall.',
      remediation: [
        'Enforce Closing = Opening + Gross Acquisitions - Total Churn across all endpoints.',
        'Isolate renewFirstTry and recovered into a separate nested { retention } object in the API response.',
        'Replace synthetic retention efficiency with verified Renewal Collection Rate.'
      ]
    },
    {
      id: 'RCA-02',
      category: 'waterfall',
      categoryLabel: 'Waterfall & Retention',
      title: 'Involuntary Churn Undercount (5 vs. 248 Expired Subscriptions)',
      severity: 'critical',
      status: 'fixed_dashboard',
      statusLabel: 'Fixed in Dashboard · Pending Backend Match',
      systems: ['rush-backend', 'MongoDB Atlas'],
      reportedValue: 'Involuntary Churn: 5 subscriptions',
      groundTruth: 'Involuntary Churn: 248 expired parent subscriptions',
      impactSummary: 'The backend query churnInRangeMatch strictly queried status: "cancelled_billing" (a legacy, rarely applied flag). The automated billing runner transitions failed renewals to status: "expired", completely hiding 248 payment churns from the dashboard.',
      codeSnippet: `// BEFORE:
subs.countDocuments(churnInRangeMatch(range, 'cancelled_billing', shopId));

// AFTER:
subs.countDocuments({
  ...rootShopMatch(shopId),
  parentSubCode: null,
  status: { $in: ['expired', 'cancelled_billing', 'terminated', 'payment_failed'] },
  $or: [
    { firstRenewalFailureAt: { $gte: range.from, $lte: range.to } },
    { renewalDate: { $gte: range.from, $lte: range.to } }
  ]
});`,
      codeExplanation: 'On Oct 5, 2026, the database held 248 parent subscriptions with status: "expired" and 8 with status: "terminated", but only 5 with "cancelled_billing". Querying only "cancelled_billing" masked 98% of payment failures.',
      remediation: [
        'Update churnInRangeMatch to capture status: { $in: ["cancelled_billing", "expired", "terminated"] }.',
        'Align period scoping to firstRenewalFailureAt or renewalDate.',
        'Distinguish voluntary customer cancellations from involuntary card declines.'
      ]
    },
    {
      id: 'RCA-03',
      category: 'waterfall',
      categoryLabel: 'Waterfall & Retention',
      title: 'New Member Conversions Diverted to Reactivation',
      severity: 'high',
      status: 'pending_backend',
      statusLabel: 'Identified · Backend Refactor Required',
      systems: ['rush-backend'],
      reportedValue: '+3 New Conversions',
      groundTruth: '+9 to 13 Newly Activated Vehicle Subscriptions',
      impactSummary: '13 paid subscription orders and 9 new parent subscriptions activated on Oct 5. However, a customer-lifetime historical lookup classified 6 customers who had ever interacted before as "reactivated", leaving only 3 as new conversions and distorting marketing attribution.',
      codeSnippet: `// Problematic logic:
// Evaluates historical gap across all customer phone records:
const newMembers = Math.max(0, enrollments - reactive - winback);
// Classifies customer as reactive even if registering a completely new car.`,
      codeExplanation: 'Multi-car families or returning users activating a different license plate were misclassified as reactive rather than vehicle acquisitions.',
      remediation: [
        'Differentiate Vehicle Plate Activation (new license plate) from Customer Account Creation.',
        'Record acquisition type explicitly at the time of POS checkout or portal registration.'
      ]
    },
    {
      id: 'RCA-04',
      category: 'washes',
      categoryLabel: 'Washes & Telemetry',
      title: 'Retail Walk-In Exterior Washes Dropped from Service Mix',
      severity: 'high',
      status: 'fixed_dashboard',
      statusLabel: 'Fixed in Dashboard · Backend Update Required',
      systems: ['rush-backend', 'rushwash_subscriptions'],
      reportedValue: '225 Tier Breakdown (127 Nano + 59 Fresh + 39 Shiny)',
      groundTruth: '265 Total Exterior Passes (225 Subscriptions + 40 Retail Walk-in)',
      impactSummary: 'The aggregate joined subscriptions on customerId. Non-subscription walk-in cashier tickets have no subscription document, defaulting to "other". The aggregation loop explicitly dropped "other", omitting 40 paid passes from the tier chart.',
      codeSnippet: `// BEFORE (reports.repository.ts):
for (const row of rows) {
  const key = normalizeServiceTierKey(row._id);
  if (key === 'other' || key === 'interior_clean') continue; // DROPPED 40 PASSES!
  buckets.set(key, (buckets.get(key) ?? 0) + row.count);
  exteriorTierTotal += row.count;
}

// AFTER:
if (key === 'other') key = 'retail_walk_in'; // Conserve all 265 physical passes`,
      codeExplanation: 'Silently discarding non-subscription passes created a 40-pass discrepancy between the headline wash counter (265) and the sub-tier bars (225).',
      remediation: [
        'Add dedicated retail_walk_in category to service mix payload.',
        'Ensure sum of exterior tiers strictly equals headline exterior passes.'
      ]
    },
    {
      id: 'RCA-05',
      category: 'washes',
      categoryLabel: 'Washes & Telemetry',
      title: 'Conveyor Gate (EL-01) Wrongly Labeled as Interior Cleaning Bay',
      severity: 'critical',
      status: 'hardware_action',
      statusLabel: 'Firmware & Ingest Refactor Required',
      systems: ['rush-backend', 'Hardware ANPR', 'CAM-00005'],
      reportedValue: '176 Interior Cleans (clamped with Math.min)',
      groundTruth: '24–26 Physical Interior Bay Passes',
      impactSummary: 'Exterior conveyor cameras (EL-01 / AG-01) automatically stamped interiorStatus: "done" on wash history records whenever a vehicle owned an interior add-on package, even though it never entered the physical interior bay (IL-01). The backend hid the bug via Math.min(interior, exterior).',
      codeSnippet: `// BEFORE (executive-matches.ts):
$or: [{ laneReadableCode: 'IL-01' }, { interiorStatus: 'done' }]

// Clamping workaround that masked the bug:
Math.min(interiorEvents, exteriorEvents)`,
      codeExplanation: 'IL-01 is the only interior bay camera. Stamping interior done at the exterior entrance inflated interior clean throughput by over 600%.',
      remediation: [
        'Only mark interior completed upon CAM-00005 LPR capture on lane IL-01 or manual interior tablet check-in.',
        'Do not stamp interior status from conveyor entrance (EL-01).',
        'Remove artificial Math.min() clamping in reports.'
      ]
    },
    {
      id: 'RCA-06',
      category: 'members',
      categoryLabel: 'Subscription Hierarchy',
      title: 'Child Add-On Contracts Leaking into Vehicle Membership Counts',
      severity: 'critical',
      status: 'fixed_dashboard',
      statusLabel: 'Fixed in Dashboard (`parentSubCode: null`)',
      systems: ['rush-backend', 'MongoDB Atlas'],
      reportedValue: '2,212 Headline Memberships',
      groundTruth: '1,795 Valid Plans (1,688 Active Physical Cars + 107 Valid-to-Expiry)',
      impactSummary: 'Raw queries counted every row in rushwash_subscriptions without filtering parentSubCode: null. 524 interior add-on child contracts (SPK-00004) were summed as separate vehicle memberships, inflating the fleet count from 1,688 to 2,212.',
      codeSnippet: `// BEFORE:
const count = await subs.countDocuments({ status: 'active', ...shopMatch });

// AFTER:
const count = await subs.countDocuments({ 
  status: 'active', 
  parentSubCode: null, // ENFORCE ROOT VEHICLE ONLY
  ...shopMatch 
});`,
      codeExplanation: '1,688 Root vehicle plans (1,027 Nano + 413 Fresh + 248 Shiny) + 524 Child add-ons = 2,212 contract rows. A car with an interior add-on was counted as 2 memberships.',
      remediation: [
        'Enforce rootSubscriptionMongoMatch() across all member metrics.',
        'Display interior add-on contracts as an attached add-on rate rather than primary cars.'
      ]
    },
    {
      id: 'RCA-07',
      category: 'revenue',
      categoryLabel: 'Financial Reconciliation',
      title: 'Net Revenue Refund Double-Deduction & Clamping',
      severity: 'high',
      status: 'reconciled',
      statusLabel: 'Documented & Reconciled in Audit Page',
      systems: ['rush-backend', 'Streamlit Dashboard'],
      reportedValue: 'Hero Net vs Daily Series Divergence (~SAR 1,970)',
      groundTruth: 'Exact Net Cash Inflow',
      impactSummary: 'Refunded orders (status=refunded) are not included in gross inflow, yet their value was deducted again. Refunds lacking refundedAt fall back to createdAt in daily series but not in Hero net. Negative days clamped to 0 with Math.max(0, net), hiding losses.',
      codeSnippet: `// Mismatch in backend:
hero_net = inflow - refunds_with_refundedAt;
series_net = inflow - (refunds_with_refundedAt + refunds_missing_refundedAt);
// Missing refundedAt orders cause SAR 1,970+ variance between cards.`,
      codeExplanation: 'Legacy refunds were stored with negative numbers requiring abs(). Orders refunded outside the sales period create synthetic distortions.',
      remediation: [
        'Only subtract refunds whose gross payment was recognized in inflow.',
        'Ensure refundedAt is mandatory on all refund events.',
        'Remove Math.max(0, net) clamping on daily charts.'
      ]
    },
    {
      id: 'RCA-08',
      category: 'revenue',
      categoryLabel: 'Financial Reconciliation',
      title: 'Revenue vs. Order-Count Filter Mismatch (Settled vs. Unsettled)',
      severity: 'medium',
      status: 'reconciled',
      statusLabel: 'Documented & Reconciled in Audit Page',
      systems: ['rush-backend'],
      reportedValue: '84 Orders / SAR 4,890 Discrepancy',
      groundTruth: 'Orders strictly match settled payment receipts',
      impactSummary: 'Revenue sums all orders with status in [paid, completed, active] (including unsettled orders). Orders metric counts only settled orders where captured payments cover the total. This mismatch skews Average Order Value.',
      codeSnippet: `// Settlement check mismatch:
Revenue: status in ['paid', 'completed', 'active'] (includes unsettled)
Orders:  status in ['paid', 'completed', 'active'] AND capturedPayments >= total`,
      codeExplanation: 'Unsettled orders exist inside Revenue but outside Orders count, confusing reconciliation.',
      remediation: [
        'Align order count and revenue filters to the exact same payment settlement boundary.',
        'Surface unsettled orders in a dedicated review queue.'
      ]
    },
    {
      id: 'RCA-09',
      category: 'etl',
      categoryLabel: 'ETL & Catalog Migration',
      title: 'Legacy ETL Catalog Remap & Upgrade Classification Drift',
      severity: 'high',
      status: 'fixed_dashboard',
      statusLabel: 'Dry-Run Validated & Remapped',
      systems: ['Legacy Laravel ETL', 'rush-backend'],
      reportedValue: 'Active Nano members prompted to "Upgrade" to Nano with prorata charge',
      groundTruth: 'Already on Nano; Change Plan button blocked',
      impactSummary: 'Laravel migration created cloned packages (SPK-XXXXX) per legacy plan instead of linking to the live seed catalog (SPK-00003). Classifier matched on exact package code, treating same-tier memberships as upgrades.',
      codeSnippet: `// Catalog pointer drift:
Subscription package: SPK-00005 (legacy import clone, order: 0)
POS / Portal catalog:  SPK-00003 (live seed Nano, order: 3)
// Different code -> classified as upgrade with prorated payment!`,
      codeExplanation: 'Subscription identity was decoupled from the sellable catalog. Subscriptions needed identity pointers updated to the live package code while leaving prices and billing dates untouched.',
      remediation: [
        'Run dry-run remapping script to update packageReadableCode to live seed package.',
        'Preserve historical pricing, renewalDate, and payment tokens untouched.'
      ]
    },
    {
      id: 'RCA-10',
      category: 'members',
      categoryLabel: 'Temporal & Scoping Queries',
      title: 'updatedAt Proxy Used as Renewal Timestamp',
      severity: 'medium',
      status: 'reconciled',
      statusLabel: 'Documented & Reconciled in Audit Page',
      systems: ['rush-backend'],
      reportedValue: 'Non-renewal updates counted as renewals',
      groundTruth: 'Only verified isRenewal: true orders counted',
      impactSummary: 'The backend queried subscriptions where updatedAt fell in the date window as a proxy for renewal. Routine administrative updates (account freezes, plate edits, customer notes, ETL runs) were counted as subscription renewals.',
      codeSnippet: `// BEFORE:
{ parentSubCode: null, status: 'active', updatedAt: { $gte: start, $lte: end } }

// AFTER:
sale_orders.find({ createdAt: { $gte: start, $lte: end }, isRenewal: true, status: { $in: REVENUE } })`,
      codeExplanation: 'updatedAt changes for any database mutation. Renewal counting must rely strictly on financial transaction records.',
      remediation: [
        'Deprecate updatedAt proxy queries in favor of sale_orders with isRenewal: true.',
        'Cross-verify that renewalDate actually moved into the future.'
      ]
    }
  ];

  const filteredData = useMemo(() => {
    return rcaData.filter(item => {
      const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || 
        item.id.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.impactSummary.toLowerCase().includes(q) ||
        item.systems.some(s => s.toLowerCase().includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  const categories = [
    { id: 'all', label: 'All Root Causes', count: rcaData.length },
    { id: 'waterfall', label: 'Waterfall & Churn', count: rcaData.filter(d => d.category === 'waterfall').length },
    { id: 'washes', label: 'Washes & ANPR', count: rcaData.filter(d => d.category === 'washes').length },
    { id: 'members', label: 'Fleet & Hierarchy', count: rcaData.filter(d => d.category === 'members').length },
    { id: 'revenue', label: 'Financial & Refunds', count: rcaData.filter(d => d.category === 'revenue').length },
    { id: 'etl', label: 'ETL & Catalogs', count: rcaData.filter(d => d.category === 'etl').length },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-black rounded-2xl p-6 text-white border border-slate-700/60 shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-full bg-[#c91e2f]/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#c91e2f] text-white">
                Master RCA · v2.0
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Consolidated Engineering Reference (October 2026)
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black font-display tracking-tight text-white flex items-center gap-2">
              <span>Executive Dashboard Root Cause Analysis</span>
              <span className="text-[#c91e2f]">Hub</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
              Consolidated audit uniting the October 5 Executive RCA, the Legacy ETL Catalog Remap RCA, 
              and the 13 Database Reconciliation findings. Covers mathematical balance, ANPR camera telemetry, 
              contract hierarchies, and financial settlement boundaries.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start lg:self-center shrink-0">
            {onNavigateToKpiGuide && (
              <button
                onClick={onNavigateToKpiGuide}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm"
              >
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                <span>KPI Guide (.md)</span>
              </button>
            )}
            <a
              href="docs/MASTER_RCA_DASHBOARD.md"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#c91e2f] hover:bg-[#a81927] text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-[#c91e2f]/30"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Full MASTER_RCA.md</span>
              <ExternalLink className="w-3 h-3 ml-0.5 opacity-80" />
            </a>
          </div>
        </div>

        {/* Quick KPI Health Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-700/60">
          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
            <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Identified Issues</div>
            <div className="text-lg font-black text-white mt-0.5">{rcaData.length} Root Causes</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Across 4 operational domains</div>
          </div>
          <div className="bg-emerald-950/40 rounded-xl p-3 border border-emerald-800/40">
            <div className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Fixed in Dashboard</div>
            <div className="text-lg font-black text-emerald-300 mt-0.5">
              {rcaData.filter(d => d.status === 'fixed_dashboard' || d.status === 'reconciled').length} Addressed
            </div>
            <div className="text-[10px] text-emerald-400/80 mt-0.5">Waterfall, fleet, mix isolated</div>
          </div>
          <div className="bg-amber-950/40 rounded-xl p-3 border border-amber-800/40">
            <div className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">Pending Backend DTO</div>
            <div className="text-lg font-black text-amber-300 mt-0.5">
              {rcaData.filter(d => d.status === 'pending_backend').length} Action Items
            </div>
            <div className="text-[10px] text-amber-400/80 mt-0.5">Involuntary churn, gap check</div>
          </div>
          <div className="bg-rose-950/40 rounded-xl p-3 border border-rose-800/40">
            <div className="text-[10px] text-rose-400 font-semibold uppercase tracking-wider">Hardware / Telemetry</div>
            <div className="text-lg font-black text-rose-300 mt-0.5">1 Critical Action</div>
            <div className="text-[10px] text-rose-400/80 mt-0.5">EL-01 / IL-01 decoupling</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Domain Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 md:pb-0">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-[#c91e2f] text-white shadow-xs'
                    : 'text-slate-600 hover:text-black hover:bg-slate-100'
                }`}
              >
                <span>{cat.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  selectedCategory === cat.id ? 'bg-black/30 text-white' : 'bg-slate-200/70 text-slate-700'
                }`}>
                  {cat.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search Box & Expand/Collapse */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search RCAs, code, metrics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs rounded-xl pl-9 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#c91e2f]/20 focus:border-[#c91e2f] transition-all"
              />
            </div>
            <button
              onClick={expandAll}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              title="Expand All"
            >
              Expand
            </button>
            <button
              onClick={collapseAll}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              title="Collapse All"
            >
              Collapse
            </button>
          </div>
        </div>
      </div>

      {/* RCA Cards Listing */}
      <div className="space-y-4">
        {filteredData.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
            <Info className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="font-semibold text-sm">No root causes matched your filter.</p>
            <button
              onClick={() => { setSelectedCategory('all'); setSearchQuery(''); }}
              className="mt-2 text-xs font-bold text-[#c91e2f] hover:underline"
            >
              Reset filters
            </button>
          </div>
        ) : (
          filteredData.map((item) => {
            const isExpanded = !!expandedIds[item.id];
            const severityColor = 
              item.severity === 'critical' ? 'text-rose-600 bg-rose-50 border-rose-200' :
              item.severity === 'high' ? 'text-amber-600 bg-amber-50 border-amber-200' :
              'text-blue-600 bg-blue-50 border-blue-200';

            const statusBadgeColor =
              item.status === 'fixed_dashboard' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              item.status === 'pending_backend' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              item.status === 'hardware_action' ? 'bg-rose-50 text-rose-700 border-rose-200' :
              'bg-blue-50 text-blue-700 border-blue-200';

            return (
              <div 
                key={item.id}
                className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden transition-all hover:border-slate-300"
              >
                {/* Collapsible Header */}
                <div 
                  onClick={() => toggleExpand(item.id)}
                  className="p-5 flex items-start justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors select-none"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-[#c91e2f]">
                        {item.id}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {item.categoryLabel}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${severityColor}`}>
                        {item.severity.toUpperCase()}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusBadgeColor}`}>
                        {item.statusLabel}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 leading-snug">
                      {item.title}
                    </h3>

                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                      {item.impactSummary}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 pt-1">
                    <div className="text-right hidden sm:block">
                      <div className="text-[10px] text-slate-400 font-semibold uppercase">Systems</div>
                      <div className="text-xs text-slate-700 font-mono font-medium">
                        {item.systems.join(' · ')}
                      </div>
                    </div>
                    <button 
                      className="p-1 rounded-lg text-slate-400 hover:text-black hover:bg-slate-200/60 transition-colors"
                      aria-label="Toggle details"
                    >
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Deep Dive Content */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-100 space-y-4 text-xs bg-slate-50/40">
                    {/* Discrepancy comparison pill box */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <div className="p-3 bg-rose-50/70 border border-rose-200/80 rounded-xl space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          <span>Reported Baseline (Discrepant)</span>
                        </div>
                        <div className="font-mono font-bold text-rose-950 text-xs">
                          {item.reportedValue}
                        </div>
                      </div>

                      <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-xl space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Ground Truth (Reconciled Target)</span>
                        </div>
                        <div className="font-mono font-bold text-emerald-950 text-xs">
                          {item.groundTruth}
                        </div>
                      </div>
                    </div>

                    {/* Code Breakdown & Why It Fails */}
                    <div className="space-y-2">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <Code className="w-3.5 h-3.5 text-[#c91e2f]" />
                        <span>Code Snapshot & Diagnostic Audit</span>
                      </div>
                      <div className="bg-[#0f172a] text-slate-200 p-3.5 rounded-xl font-mono text-[11px] leading-relaxed overflow-x-auto shadow-inner border border-slate-800">
                        <pre>{item.codeSnippet}</pre>
                      </div>
                      <p className="text-slate-600 leading-relaxed text-xs italic">
                        {item.codeExplanation}
                      </p>
                    </div>

                    {/* Remediation Action Steps */}
                    <div className="space-y-1.5 bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Actionable Engineering Remediation</span>
                      </div>
                      <ul className="space-y-1 pl-4 list-disc text-slate-700 leading-relaxed">
                        {item.remediation.map((step, idx) => (
                          <li key={idx} className="marker:text-[#c91e2f]">
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Engineering Remediation Roadmap Phases */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-2xs space-y-5">
        <div className="space-y-1">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#c91e2f]">
            Engineering Blueprint
          </div>
          <h3 className="text-lg font-black text-slate-900 font-display">
            Multi-Phase Remediation Roadmap
          </h3>
          <p className="text-xs text-slate-500">
            Systemic changes required across backend DTOs, frontend waterfall balancing, and ANPR hardware ingest.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-slate-900">Phase 1: Backend DTOs</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">In Progress</span>
            </div>
            <ul className="text-xs space-y-1.5 text-slate-600">
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>Fix churnInRangeMatch to capture status: 'expired' (248 subs).</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>Group retail walk-in washes under dedicated key (conserve 265).</span>
              </li>
              <li className="flex items-start gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>Enforce parentSubCode: null across all headline counts.</span>
              </li>
            </ul>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-slate-900">Phase 2: Frontend Balancing</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">Completed in App</span>
            </div>
            <ul className="text-xs space-y-1.5 text-slate-600">
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>Closing = Opening + Gross Acq − Churn strictly enforced.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>Dedicated Renewal Retention strip separated from acquisitions.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>Include retail walk-ins in wash tier breakdown.</span>
              </li>
            </ul>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-slate-900">Phase 3: Hardware / ANPR</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold">Hardware Action</span>
            </div>
            <ul className="text-xs space-y-1.5 text-slate-600">
              <li className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                <span>Decouple conveyor EL-01 from interiorStatus: 'done'.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <span>Require CAM-00005 LPR capture at lane IL-01.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <span>Remove Math.min() artificial clamping in reports.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
