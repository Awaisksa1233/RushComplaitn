"""
Defensive step.kind normalization in backend and frontend.
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

    old_step_map = """const steps = (f.steps || []).map((s, idx) => {
                  const sname = typeof s?.name === 'object' && s.name ? { en: s.name.en || s.templateId || s.id || `Step ${idx+1}`, ar: s.name.ar || '' } : { en: String(s?.name || s?.templateId || s?.id || `Step ${idx+1}`) };
                  return { ...s, name: sname };
                });"""

    new_step_map = """const steps = (f.steps || []).map((s, idx) => {
                  const kind = s?.kind || (s?.waitHours != null ? 'wait' : s?.condition ? 'condition' : 'send_template');
                  const sname = typeof s?.name === 'object' && s.name ? { en: s.name.en || s.templateId || s.id || `Step ${idx+1}`, ar: s.name.ar || '' } : { en: String(s?.name || s?.templateId || s?.id || `Step ${idx+1}`) };
                  return { ...s, id: s?.id || `s${idx+1}`, kind, name: sname };
                });"""

    if old_step_map in text:
        text = text.replace(old_step_map, new_step_map)
        funnel_js.write_text(text, encoding='utf-8')
        print("Patched server/funnel.js step mapping with kind deduction")
    else:
        print("Could not find old_step_map in server/funnel.js")

def patch_flow_editor():
    editor_file = ROOT_DIR / 'src' / 'components' / 'funnel' / 'FlowEditor.tsx'
    text = editor_file.read_text(encoding='utf-8')

    # Fix baseOf
    old_base_step = "name: sanitizeName(s.name, s.templateId || s.id || `Step ${idx + 1}`)"
    new_base_step = """id: s.id || `s${idx + 1}`,
    kind: (s.kind || (s.waitHours != null ? 'wait' : s.condition ? 'condition' : 'send_template')) as any,
    name: sanitizeName(s.name, s.templateId || s.id || `Step ${idx + 1}`)"""

    if old_base_step in text:
        text = text.replace(old_base_step, new_base_step)

    # Fix line 138 replace call
    text = text.replace(
        "${s.kind.replace('_', ' ')}",
        "${(s.kind || 'step').replace('_', ' ')}"
    )

    editor_file.write_text(text, encoding='utf-8')
    print("Patched FlowEditor.tsx")

def patch_flows_panel():
    panel_file = ROOT_DIR / 'src' / 'components' / 'funnel' / 'FlowsPanel.tsx'
    text = panel_file.read_text(encoding='utf-8')

    text = text.replace(
        "const messages = flow.steps.filter((s) => s.kind === 'send_template').length;",
        "const messages = flow.steps.filter((s) => (!s.kind || s.kind === 'send_template')).length;"
    )
    text = text.replace(
        "const Icon = STEP_ICON[s.kind] ?? MessageCircle;",
        "const Icon = STEP_ICON[s.kind || 'send_template'] ?? MessageCircle;"
    )

    panel_file.write_text(text, encoding='utf-8')
    print("Patched FlowsPanel.tsx")

def main():
    patch_backend()
    patch_flow_editor()
    patch_flows_panel()
    print("All step.kind patches complete.")

if __name__ == '__main__':
    main()
