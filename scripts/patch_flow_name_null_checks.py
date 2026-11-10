"""
Defensive null-checks for flow.name and step.name across frontend and backend.
Timestamps in Riyadh Time (AST).
"""

import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT_DIR = Path(__file__).resolve().parent.parent

def patch_backend():
    funnel_js = ROOT_DIR / 'server' / 'funnel.js'
    text = funnel_js.read_text(encoding='utf-8')

    old_map = """.map(({ _id, ...f }) => ({ ...f, id: f.id ?? String(_id), hasDraft: !!f.draft || !!f.hasDraft }))"""
    
    new_map = """.map(({ _id, ...f }) => {
                const id = f.id ?? String(_id);
                const name = typeof f.name === 'object' && f.name ? { en: f.name.en || id, ar: f.name.ar || '' } : { en: String(f.name || id) };
                const steps = (f.steps || []).map((s, idx) => {
                  const sname = typeof s?.name === 'object' && s.name ? { en: s.name.en || s.templateId || s.id || `Step ${idx+1}`, ar: s.name.ar || '' } : { en: String(s?.name || s?.templateId || s?.id || `Step ${idx+1}`) };
                  return { ...s, name: sname };
                });
                return { ...f, id, name, steps, hasDraft: !!f.draft || !!f.hasDraft };
              })"""

    if old_map in text:
        text = text.replace(old_map, new_map)
        funnel_js.write_text(text, encoding='utf-8')
        print("Patched server/funnel.js")
    else:
        print("Pattern in server/funnel.js already patched or not matched")

def patch_flows_panel():
    panel_file = ROOT_DIR / 'src' / 'components' / 'funnel' / 'FlowsPanel.tsx'
    text = panel_file.read_text(encoding='utf-8')

    text = text.replace(
        '<span className="text-sm font-bold text-black">{flow.name.en}</span>',
        '<span className="text-sm font-bold text-black">{flow.name?.en || (typeof flow.name === "string" ? flow.name : flow.id)}</span>'
    )
    text = text.replace(
        '<span className={`text-xs font-semibold ${s.paused ? \'text-slate-400\' : \'text-black\'}`}>{s.name.en}</span>',
        '<span className={`text-xs font-semibold ${s.paused ? \'text-slate-400\' : \'text-black\'}`}>{s.name?.en || (typeof s.name === "string" ? s.name : s.templateId || s.id || `Step ${i + 1}`)}</span>'
    )
    text = text.replace(
        '!/\\d/.test(s.name.en)',
        '!/\\d/.test(s.name?.en ?? "")'
    )

    panel_file.write_text(text, encoding='utf-8')
    print("Patched FlowsPanel.tsx")

def patch_funnel_page():
    page_file = ROOT_DIR / 'src' / 'components' / 'funnel' / 'FunnelPage.tsx'
    text = page_file.read_text(encoding='utf-8')

    text = text.replace(
        '<div className="font-semibold text-black">{flow.name.en}</div>',
        '<div className="font-semibold text-black">{flow.name?.en || (typeof flow.name === "string" ? flow.name : flow.id)}</div>'
    )

    page_file.write_text(text, encoding='utf-8')
    print("Patched FunnelPage.tsx")

def patch_flow_editor():
    editor_file = ROOT_DIR / 'src' / 'components' / 'funnel' / 'FlowEditor.tsx'
    text = editor_file.read_text(encoding='utf-8')

    # Update baseOf
    old_base_of = """export const baseOf = (f: FlowConfig): FlowDraft =>
  f.draft ?? {
    name: f.name,
    description: f.description,
    status: f.status === 'running' ? 'running' : 'paused',
    window: f.window,
    volume: f.volume,
    reentry: f.reentry ?? 'once',
    approveFirstBatch: f.approveFirstBatch,
    steps: f.steps
  };"""

    new_base_of = """function sanitizeName(n: any, fallback = ''): { en: string; ar?: string } {
  if (!n) return { en: fallback, ar: '' };
  if (typeof n === 'string') return { en: n, ar: '' };
  return { en: n.en || fallback, ar: n.ar || '' };
}

export const baseOf = (f: FlowConfig): FlowDraft => {
  const steps = (f.steps || []).map((s, idx) => ({
    ...s,
    name: sanitizeName(s.name, s.templateId || s.id || `Step ${idx + 1}`)
  }));
  return f.draft ?? {
    name: sanitizeName(f.name, f.id),
    description: f.description,
    status: f.status === 'running' ? 'running' : 'paused',
    window: f.window,
    volume: f.volume,
    reentry: f.reentry ?? 'once',
    approveFirstBatch: f.approveFirstBatch,
    steps
  };
};"""

    if old_base_of in text:
        text = text.replace(old_base_of, new_base_of)
    
    # Safe value access
    text = text.replace('value={d.name.en}', 'value={d.name?.en ?? ""}')
    text = text.replace('value={d.name.ar ?? \'\'}', 'value={d.name?.ar ?? ""}')
    text = text.replace('value={s.name.en}', 'value={s.name?.en ?? ""}')

    editor_file.write_text(text, encoding='utf-8')
    print("Patched FlowEditor.tsx")

def main():
    patch_backend()
    patch_flows_panel()
    patch_funnel_page()
    patch_flow_editor()
    print("All patches applied successfully.")

if __name__ == '__main__':
    main()
