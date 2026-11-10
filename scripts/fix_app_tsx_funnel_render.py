"""
Fix src/App.tsx to insert FunnelPage render block.
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
    app_file = root / 'src' / 'App.tsx'
    text = app_file.read_text(encoding='utf-8')

    target = "  if (currentPath === '/cancel') {\n    return <CustomerCancelPage onBackToDashboard={() => navigate('/')} />;\n  }"

    replacement = """  if (currentPath === '/cancel') {
    return <CustomerCancelPage onBackToDashboard={() => navigate('/')} />;
  }

  if (isFunnel) {
    return (
      <DashboardShell activeDomain="funnel" onDomainChange={handleDomainChange} onDrilldown={() => navigate('/')}>
        <FunnelPage onBack={() => navigate('/')} />
      </DashboardShell>
    );
  }"""

    # Normalize newlines
    is_crlf = '\r\n' in text
    normalized_text = text.replace('\r\n', '\n')

    if "<FunnelPage onBack=" in normalized_text:
        print("FunnelPage is already rendered in App.tsx")
        return

    if target in normalized_text:
        normalized_text = normalized_text.replace(target, replacement)
        if is_crlf:
            normalized_text = normalized_text.replace('\n', '\r\n')
        app_file.write_text(normalized_text, encoding='utf-8')
        print("Successfully added FunnelPage return block to src/App.tsx")
    else:
        print("Target not found in normalized text")

if __name__ == '__main__':
    main()
