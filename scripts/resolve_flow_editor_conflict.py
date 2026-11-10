import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

file_path = Path('src/components/funnel/FlowEditor.tsx')
text = file_path.read_text(encoding='utf-8')

# 1. Resolve baseOf conflict
lines = text.splitlines(keepends=True)
out_lines = []
in_conflict = False
conflict_idx = 0

for line in lines:
    if line.startswith('<<<<<<<'):
        in_conflict = True
        conflict_idx += 1
        continue
    if in_conflict and line.startswith('======='):
        continue
    if in_conflict and line.startswith('>>>>>>>'):
        in_conflict = False
        continue
    
    if in_conflict:
        if conflict_idx == 1:
            # First conflict is in baseOf:
            # We want trigger, exitWhen, and steps from 2b74027, but with our sanitized steps
            if 'trigger:' in line or 'exitWhen:' in line:
                out_lines.append(line)
            elif 'steps' in line and not line.strip().startswith('steps: f.steps'):
                out_lines.append('    steps\n')
        elif conflict_idx == 2:
            # Second conflict is in the steps rendering:
            # We want StepEditor from 2b74027
            if 'StepEditor key={s.id}' in line:
                out_lines.append(line)
        continue
    
    out_lines.append(line)

merged_text = ''.join(out_lines)

# Now enhance TemplateInput to use TemplateSelector
old_template_input = """function TemplateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label} hint={value && !isApprovedTemplate(value) ? 'Not in the approved list yet' : undefined}>
      <input className={input} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}"""

new_template_input = """function TemplateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <TemplateSelector
      label={label}
      value={value}
      onChange={onChange}
    />
  );
}"""

assert old_template_input in merged_text, 'old_template_input not found'
merged_text = merged_text.replace(old_template_input, new_template_input)

# Defensively guard s.name.en and step.name.en
merged_text = merged_text.replace('{all.indexOf(s) + 1}. {s.name.en}', '{all.indexOf(s) + 1}. {s.name?.en ?? s.id}')
merged_text = merged_text.replace('<input className={input} value={step.name.en}', '<input className={input} value={step.name?.en ?? ""}')

file_path.write_text(merged_text, encoding='utf-8')
print("Successfully resolved FlowEditor.tsx conflict and updated TemplateInput!")
