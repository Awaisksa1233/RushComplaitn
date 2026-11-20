import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Copy, ExternalLink, Filter, FolderOpen, Layers, MessageCircle, RefreshCw, Search, Sparkles } from 'lucide-react';
import { isApprovedTemplate } from './funnelGraph';

export interface WhatsAppTemplateItem {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  buttons?: string[];
  lastUpdated?: string;
}

export function TemplatesCatalogPanel({ onSelectTemplate }: { onSelectTemplate?: (tplName: string) => void }) {
  const [templates, setTemplates] = useState<WhatsAppTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'marketing' | 'utility' | 'winback'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadTemplates = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // First try live Unifonic refresh API, fallback to /api/funnel/templates
      let res = await fetch('/api/realtime/templates/refresh');
      if (!res.ok) {
        res = await fetch('/api/funnel/templates');
      }
      const data = await res.json();
      const list: WhatsAppTemplateItem[] = data.templates || data.data || [];
      if (list && list.length > 0) {
        setTemplates(list);
        if (isManualRefresh) {
          setSuccessMsg(`Successfully synced ${list.length} approved templates from Unifonic`);
          setTimeout(() => setSuccessMsg(null), 4000);
        }
      } else {
        throw new Error('No template records returned');
      }
    } catch (err: any) {
      console.warn('Failed to load templates:', err);
      // Fallback local fetch
      try {
        const fRes = await fetch('/api/funnel/templates');
        const fData = await fRes.json();
        setTemplates(fData.data || []);
      } catch (fErr: any) {
        setError(err.message || 'Failed to load templates from Unifonic');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTemplates(false);
  }, []);

  const handleCopy = (name: string) => {
    navigator.clipboard.writeText(name);
    setCopiedId(name);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      const name = (t.name || t.id || '').toLowerCase();
      const body = (t.body || '').toLowerCase();
      const cat = (t.category || '').toLowerCase();
      const isWinback = name.includes('winback') || name.includes('wiback');

      if (categoryFilter === 'marketing' && cat !== 'marketing') return false;
      if (categoryFilter === 'utility' && cat !== 'utility') return false;
      if (categoryFilter === 'winback' && !isWinback) return false;

      if (!q) return true;
      return name.includes(q) || body.includes(q) || cat.includes(q);
    });
  }, [templates, search, categoryFilter]);

  const counts = useMemo(() => {
    const total = templates.length;
    const marketing = templates.filter((t) => (t.category || '').toLowerCase() === 'marketing').length;
    const utility = templates.filter((t) => (t.category || '').toLowerCase() === 'utility').length;
    const winback = templates.filter((t) => (t.name || t.id || '').toLowerCase().includes('winback')).length;
    return { total, marketing, utility, winback };
  }, [templates]);

  return (
    <div className="space-y-6">
      {/* Control Header Card */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 border border-purple-200 flex items-center justify-center font-bold">
                <Layers className="w-4 h-4" />
              </span>
              <h2 className="text-base font-bold text-black">WhatsApp Template Catalog</h2>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                {counts.total > 0 ? `${counts.total} Approved` : 'Live Unifonic Sync'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Official approved WhatsApp templates for Rush Wash (<strong>رش واش</strong>). Synchronized live with Unifonic &amp; Meta.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadTemplates(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Updating from Unifonic...' : 'Update Templates from Unifonic'}</span>
            </button>
          </div>
        </div>

        {successMsg && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Search & Category Filter Toolbar */}
        <div className="mt-5 pt-4 border-t border-[#f0f0f0] flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by template name, Arabic copy, or category..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 hover:bg-white focus:bg-white border border-[#e5e5e5] focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 rounded-xl outline-none transition-all"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                categoryFilter === 'all'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:text-black hover:bg-slate-200'
              }`}
            >
              All ({counts.total})
            </button>
            <button
              onClick={() => setCategoryFilter('winback')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                categoryFilter === 'winback'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <Sparkles className="w-3 h-3 text-rose-400" />
              <span>Winback 90D ({counts.winback})</span>
            </button>
            <button
              onClick={() => setCategoryFilter('marketing')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                categoryFilter === 'marketing'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
            >
              Marketing ({counts.marketing})
            </button>
            <button
              onClick={() => setCategoryFilter('utility')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                categoryFilter === 'utility'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              Utility ({counts.utility})
            </button>
          </div>
        </div>
      </section>

      {/* Grid of Templates */}
      {loading ? (
        <div className="min-h-[280px] rounded-2xl border border-[#e5e5e5] bg-white flex flex-col items-center justify-center p-8 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-purple-600 mb-2" />
          <p className="text-xs">Fetching live templates catalog from Unifonic API...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="min-h-[240px] rounded-2xl border border-[#e5e5e5] bg-white flex flex-col items-center justify-center p-8 text-slate-400">
          <FolderOpen className="w-8 h-8 opacity-40 mb-2" />
          <p className="text-xs">No matching WhatsApp templates found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => {
            const tname = t.name || t.id;
            const isWinback = tname.toLowerCase().includes('winback') || tname.toLowerCase().includes('wiback');
            const isRain = tname.includes('rain');
            const isWinter = tname.includes('winter');
            const cat = (t.category || 'marketing').toLowerCase();
            const isCopied = copiedId === tname;

            return (
              <div
                key={tname}
                className={`rounded-2xl border bg-white p-4.5 flex flex-col justify-between gap-3 shadow-sm hover:shadow-md transition-all ${
                  isWinback
                    ? 'border-rose-300 ring-1 ring-rose-300/40'
                    : 'border-[#e5e5e5] hover:border-purple-300'
                }`}
              >
                <div className="space-y-2.5">
                  {/* Top Bar: Template ID + Copy + Category Badges */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <code className="text-xs font-mono font-bold bg-slate-100 text-slate-800 px-2 py-0.5 rounded-lg border border-slate-200">
                        {tname}
                      </code>
                      <button
                        onClick={() => handleCopy(tname)}
                        title="Copy template name"
                        className="p-1 rounded-md text-slate-400 hover:text-black hover:bg-slate-100 transition-colors"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          cat === 'marketing'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {cat}
                      </span>
                      <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase">
                        {t.language || 'en'}
                      </span>
                    </div>
                  </div>

                  {/* Seasonal Highlight Pill */}
                  {isWinback && (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                        <Sparkles className="w-3 h-3 text-rose-500" />
                        <span>
                          {isRain
                            ? '🌧️ Winback A/B: Variant A (Rain 25%)'
                            : isWinter
                            ? '❄️ Winback A/B: Variant B (Winter 112 SAR)'
                            : '🎯 Winback 90D Cohort'}
                        </span>
                      </span>
                    </div>
                  )}

                  {/* Arabic Message Body Card */}
                  <div
                    dir="rtl"
                    className="p-3 rounded-xl bg-[#fafafa] border border-[#f0f0f0] text-xs leading-relaxed text-slate-800 font-medium whitespace-pre-line select-text"
                  >
                    {t.body}
                  </div>
                </div>

                {/* Footer Buttons List */}
                {t.buttons && t.buttons.length > 0 && (
                  <div className="pt-2 border-t border-[#f0f0f0] flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Action Button:</span>
                    {t.buttons.map((b, bIdx) => (
                      <span
                        key={bIdx}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 shadow-2xs"
                      >
                        <ExternalLink className="w-3 h-3 text-slate-400" />
                        <span>{b}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
