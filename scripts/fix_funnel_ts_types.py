"""
Fix TypeScript compilation issues for Funnel components and DashboardShell.
Timestamps in Riyadh Time (AST).
"""

import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def main():
    root = Path(__file__).resolve().parent.parent

    # 1. Fix src/components/layout/DashboardHeader.tsx
    header_file = root / 'src' / 'components' / 'layout' / 'DashboardHeader.tsx'
    header_content = header_file.read_text(encoding='utf-8')
    if 'Filter,' not in header_content:
        header_content = header_content.replace(
            "ShieldCheck,\n  FileText\n} from 'lucide-react';",
            "ShieldCheck,\n  FileText,\n  Filter\n} from 'lucide-react';"
        )
        header_file.write_text(header_content, encoding='utf-8')
        print("Fixed Filter import in DashboardHeader.tsx")

    # 2. Fix src/components/layout/DashboardShell.tsx
    shell_file = root / 'src' / 'components' / 'layout' / 'DashboardShell.tsx'
    shell_content = shell_file.read_text(encoding='utf-8')
    bad_shell_pattern = "{ id: 'kpi_guide', label: 'KPI Guide (.md)', icon: FileText,\n  Filter, badge: 'Docs' },"
    if bad_shell_pattern in shell_content:
        shell_content = shell_content.replace(
            bad_shell_pattern,
            "{ id: 'kpi_guide', label: 'KPI Guide (.md)', icon: FileText, badge: 'Docs' },"
        )
        shell_file.write_text(shell_content, encoding='utf-8')
        print("Fixed syntax in DashboardShell.tsx")

    # 3. Fix src/components/funnel/MembershipFlowChart.tsx
    chart_file = root / 'src' / 'components' / 'funnel' / 'MembershipFlowChart.tsx'
    chart_content = chart_file.read_text(encoding='utf-8')

    # Fix STATE_CLASS & STATE_LABEL indexing
    chart_content = chart_content.replace(
        "const { node, variants } = data;",
        "const { node, variants } = data;\n  const stepState = (data.state as StepState) || 'none';"
    )
    chart_content = chart_content.replace(
        "${STATE_CLASS[data.state]}`}>{STATE_LABEL[data.state]}</span>",
        "${STATE_CLASS[stepState]}`}>{STATE_LABEL[stepState]}</span>"
    )

    # Fix variants.map type
    chart_content = chart_content.replace(
        "{variants.map((v, i) => (",
        "{variants.map((v: VariantView, i: number) => ("
    )

    # Fix onNodeClick
    chart_content = chart_content.replace(
        "onNodeClick={(_, node) => onSelect?.(node.id)}",
        "onNodeClick={(_: React.MouseEvent, node: Node) => onSelect?.(node.id)}"
    )

    chart_file.write_text(chart_content, encoding='utf-8')
    print("Fixed type issues in MembershipFlowChart.tsx")

if __name__ == '__main__':
    main()
