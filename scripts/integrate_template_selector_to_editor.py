"""
Integrate TemplateSelector with content preview into FlowEditor.tsx
Timestamps in Riyadh Time (AST).
"""

import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT_DIR = Path(__file__).resolve().parent.parent

def main():
    editor_path = ROOT_DIR / 'src' / 'components' / 'funnel' / 'FlowEditor.tsx'
    text = editor_path.read_text(encoding='utf-8')

    # Add import
    if "import { TemplateSelector } from './TemplateSelector';" not in text:
        text = text.replace(
            "import { isApprovedTemplate } from './funnelGraph';",
            "import { isApprovedTemplate } from './funnelGraph';\nimport { TemplateSelector } from './TemplateSelector';"
        )

    # Replace single template input
    old_single = """              {s.kind === 'send_template' && !s.variants?.length && (
                <div className="sm:col-span-4">
                  <Field label="Template id" hint={s.templateId && !isApprovedTemplate(s.templateId) ? 'Not in the approved list yet' : undefined}>
                    <input className={input} value={s.templateId ?? ''} onChange={(e) => setStep(i, { templateId: e.target.value })} />
                  </Field>
                </div>
              )}"""

    new_single = """              {s.kind === 'send_template' && !s.variants?.length && (
                <div className="sm:col-span-12">
                  <TemplateSelector
                    label="WhatsApp Template"
                    value={s.templateId ?? ''}
                    onChange={(tid) => setStep(i, { templateId: tid })}
                  />
                </div>
              )}"""

    if old_single in text:
        text = text.replace(old_single, new_single)
        print("Replaced single template input with TemplateSelector")
    else:
        print("Could not find old_single directly, checking normalized...")
        # Check normalized
        old_single_norm = old_single.replace('\r\n', '\n')
        text_norm = text.replace('\r\n', '\n')
        if old_single_norm in text_norm:
            text = text_norm.replace(old_single_norm, new_single)
            print("Replaced normalized single template input")

    # Replace variants template input
    old_variants = """              {s.variants?.map((v, j) => (
                <div key={v.key} className="sm:col-span-12 grid grid-cols-12 gap-3 items-end">
                  <span className="col-span-1 inline-flex h-6 w-6 items-center justify-center rounded bg-black text-white text-[10px] font-bold">{v.key}</span>
                  <div className="col-span-8">
                    <Field label="Template id" hint={!isApprovedTemplate(v.templateId) ? 'Not in the approved list yet' : undefined}>
                      <input className={input} value={v.templateId} onChange={(e) => setStep(i, { variants: s.variants!.map((x, k) => (k === j ? { ...x, templateId: e.target.value } : x)) })} />
                    </Field>
                  </div>
                  <div className="col-span-3">
                    <Field label="Weight %">
                      <input className={input} type="number" min={0} max={100} value={v.weight} onChange={(e) => setStep(i, { variants: s.variants!.map((x, k) => (k === j ? { ...x, weight: num(e.target.value) } : x)) })} />
                    </Field>
                  </div>
                </div>
              ))}"""

    new_variants = """              {s.variants && s.variants.length > 0 && (
                <div className="sm:col-span-12 space-y-3 pt-1">
                  <div className="text-xs font-semibold text-slate-700">A/B Testing Variants</div>
                  {s.variants.map((v, j) => (
                    <div key={v.key} className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-black text-white text-[10px] font-bold">{v.key}</span>
                          <span className="text-xs font-bold text-black">Variant {v.key}</span>
                        </div>
                        <div className="w-24">
                          <Field label="Weight %">
                            <input className={input} type="number" min={0} max={100} value={v.weight} onChange={(e) => setStep(i, { variants: s.variants!.map((x, k) => (k === j ? { ...x, weight: num(e.target.value) } : x)) })} />
                          </Field>
                        </div>
                      </div>
                      <TemplateSelector
                        label={`WhatsApp Template for Variant ${v.key}`}
                        value={v.templateId}
                        onChange={(tid) => setStep(i, { variants: s.variants!.map((x, k) => (k === j ? { ...x, templateId: tid } : x)) })}
                      />
                    </div>
                  ))}
                </div>
              )}"""

    if old_variants in text:
        text = text.replace(old_variants, new_variants)
        print("Replaced variants input with TemplateSelector")
    else:
        old_variants_norm = old_variants.replace('\r\n', '\n')
        text_norm = text.replace('\r\n', '\n')
        if old_variants_norm in text_norm:
            text = text_norm.replace(old_variants_norm, new_variants)
            print("Replaced normalized variants input")

    editor_path.write_text(text, encoding='utf-8')
    print("Successfully updated FlowEditor.tsx")

if __name__ == '__main__':
    main()
