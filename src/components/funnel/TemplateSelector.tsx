import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, Eye, EyeOff, MessageSquare, AlertCircle, Sparkles } from 'lucide-react';
import { TEMPLATE_CATALOG, getTemplateById, type WhatsAppTemplateItem } from './templateCatalog';
import { isApprovedTemplate } from './funnelGraph';

interface TemplateSelectorProps {
  value: string;
  onChange: (templateId: string) => void;
  label?: string;
  hint?: string;
}

export function TemplateSelector({ value, onChange, label, hint }: TemplateSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedTemplate = useMemo(() => getTemplateById(value), [value]);

  // Filter templates based on ID, category, or body content
  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return TEMPLATE_CATALOG;
    return TEMPLATE_CATALOG.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.buttons.some((b) => b.toLowerCase().includes(q))
    );
  }, [search]);

  // Handle clicking outside to close the dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (templateId: string) => {
    onChange(templateId);
    setIsOpen(false);
    setSearch('');
  };

  const isApproved = isApprovedTemplate(value);

  return (
    <div className="space-y-1.5" ref={containerRef}>
      {label && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">{label}</span>
          {value && (
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="text-[11px] text-slate-500 hover:text-black flex items-center gap-1 cursor-pointer"
            >
              {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              <span>{showPreview ? 'Hide preview' : 'View content'}</span>
            </button>
          )}
        </div>
      )}

      {/* Main Combobox Trigger */}
      <div className="relative">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full rounded-lg border bg-white px-2.5 py-1.5 text-xs text-black cursor-pointer flex items-center justify-between transition-all ${
            isOpen ? 'border-[#c91e2f] ring-2 ring-[#c91e2f]/20' : 'border-[#e5e5e5] hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-mono font-medium truncate">
              {value || <span className="text-slate-400 font-sans">Select a WhatsApp template...</span>}
            </span>
            {isApproved && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Check className="w-2.5 h-2.5" /> Approved
              </span>
            )}
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute z-50 left-0 right-0 mt-1 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
            {/* Search Input Box */}
            <div className="p-2 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by template name or content..."
                className="w-full bg-transparent text-xs text-black placeholder:text-slate-400 focus:outline-none"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-[10px] text-slate-400 hover:text-black font-semibold px-1"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Template List */}
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {filteredTemplates.length > 0 ? (
                filteredTemplates.map((t) => {
                  const isSelected = t.id === value;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelect(t.id)}
                      className={`w-full text-left p-2.5 hover:bg-slate-50 transition-colors cursor-pointer flex flex-col gap-1 ${
                        isSelected ? 'bg-red-50/40' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <code className={`text-xs font-bold ${isSelected ? 'text-[#c91e2f]' : 'text-slate-900'}`}>{t.id}</code>
                          <span className="text-[10px] uppercase font-semibold px-1 rounded bg-slate-100 text-slate-600">
                            {t.category}
                          </span>
                        </div>
                        <span className="text-[10px] font-semibold text-emerald-600 shrink-0">✓ Approved</span>
                      </div>
                      <p
                        className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed"
                        dir={t.language === 'ar' || /[\u0600-\u06FF]/.test(t.body) ? 'rtl' : 'ltr'}
                      >
                        {t.body}
                      </p>
                      {t.buttons.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {t.buttons.map((b, bi) => (
                            <span key={bi} className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                              🔘 {b}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="p-4 text-center">
                  <p className="text-xs text-slate-500 mb-2">No templates match &quot;{search}&quot;</p>
                  <button
                    type="button"
                    onClick={() => handleSelect(search.trim())}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 font-medium cursor-pointer"
                  >
                    <span>Use &quot;{search.trim()}&quot; as custom ID</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}

      {/* Full Message Preview Card */}
      {showPreview && (selectedTemplate || value) && (
        <div className="rounded-xl border border-emerald-100 bg-[#f0fdf4]/50 p-3 text-xs transition-all space-y-2 mt-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-800 border-b border-emerald-200/50 pb-1.5">
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3 text-emerald-600" />
              <span>WhatsApp Message Body</span>
            </span>
            <span className="font-mono text-[10px] text-emerald-700">
              {selectedTemplate ? `${selectedTemplate.category} • ${selectedTemplate.language.toUpperCase()}` : 'Custom ID'}
            </span>
          </div>

          {selectedTemplate ? (
            <>
              <div
                className="text-xs text-slate-800 leading-relaxed whitespace-pre-line font-sans p-2 rounded-lg bg-white border border-emerald-100 shadow-2xs"
                dir={selectedTemplate.language === 'ar' || /[\u0600-\u06FF]/.test(selectedTemplate.body) ? 'rtl' : 'ltr'}
              >
                {selectedTemplate.body}
              </div>

              {selectedTemplate.buttons.length > 0 && (
                <div className="pt-1 flex flex-wrap gap-1.5">
                  {selectedTemplate.buttons.map((btn, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white border border-emerald-300 text-emerald-800 shadow-2xs"
                    >
                      <span>🔗</span> {btn}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-slate-500 italic p-2 bg-white rounded border border-slate-100">
              Custom template ID without pre-registered copy. Messages will be sent according to Meta configuration for `{value}`.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
