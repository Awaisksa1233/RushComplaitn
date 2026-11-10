from pathlib import Path

p = Path('src/components/funnel/FlowEditor.tsx')
text = p.read_text(encoding='utf-8')

# Ensure diffFlow is null-safe for old/legacy flows
lines = text.splitlines(keepends=True)
new_lines = []
for line in lines:
    if 'if (live.name.en !== d.name.en)' in line:
        new_lines.append('  const liveName = live.name?.en ?? live.id;\n')
        new_lines.append('  const draftName = d.name?.en ?? live.id;\n')
        new_lines.append('  if (liveName !== draftName) out.push(`Name: "${liveName}" -> "${draftName}"`);\n')
    elif 'if (live.description.en !== d.description.en)' in line:
        new_lines.append('  if ((live.description?.en ?? "") !== (d.description?.en ?? "")) out.push("Description changed");\n')
    elif 'for (const s of live.steps)' in line:
        new_lines.append('  for (const s of (live.steps || [])) if (!draftIds.has(s.id)) out.push(`Removed step "${s.name?.en ?? s.id}"`);\n')
    elif 'const p = liveById.get(s.id);' in line:
        new_lines.append('    const p = liveById.get(s.id);\n')
        new_lines.append('    const sName = s.name?.en ?? s.id;\n')
    elif 'if (!p) return void out.push(`Added step ${i + 1}:' in line:
        new_lines.append('    if (!p) return void out.push(`Added step ${i + 1}: "${sName}"`);\n')
        new_lines.append('    const pName = p.name?.en ?? p.id;\n')
    elif 'if (p.name.en !== s.name.en)' in line:
        new_lines.append('    if (pName !== sName) bits.push(`renamed from "${pName}"`);\n')
    elif 'Step "${s.name.en}"' in line:
        new_lines.append('    if (bits.length) out.push(`Step "${sName}": ${bits.join(", ")}`);\n')
    elif 'live.steps.map' in line and 'draftIds.has' in line:
        new_lines.append('  const order = (ids: string[]) => ids.filter((id) => draftIds.has(id) && liveById.has(id)).join();\n')
        new_lines.append('  if (order((live.steps || []).map((s) => s.id)) !== order(d.steps.map((s) => s.id))) out.push("Step order changed");\n')
    elif 'if (order(live.steps.map' in line:
        continue
    else:
        new_lines.append(line)

p.write_text(''.join(new_lines), encoding='utf-8')
print("Successfully hardened diffFlow in FlowEditor.tsx!")
