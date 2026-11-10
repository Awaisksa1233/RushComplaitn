"""
Integrate Funnel & Flows into main repository
Ported from commit 8b32873 (Awaisksa1233)
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

    # 1. Update server/index.js
    index_js = root / 'server' / 'index.js'
    content = index_js.read_text(encoding='utf-8')
    
    import_stmt = "import { registerFunnelRoutes } from './funnel.js';\n"
    if 'registerFunnelRoutes' not in content:
        content = content.replace(
            "import { MongoClient } from 'mongodb';",
            "import { MongoClient } from 'mongodb';\n" + import_stmt
        )
        funnel_reg = (
            "// Funnel & Flows (read-only): /api/funnel/graph, /api/funnel/trends, /api/funnel/flows\n"
            "registerFunnelRoutes(app, { getSourceDb: () => (isMongoConnected ? mongoDb : null) });\n\n"
        )
        target = "// 1. Health & Connection Status"
        content = content.replace(target, funnel_reg + target)
        index_js.write_text(content, encoding='utf-8')
        print("Updated server/index.js with registerFunnelRoutes")
    else:
        print("server/index.js already has registerFunnelRoutes")

    # 2. Update src/App.tsx to include FunnelPage route
    app_tsx = root / 'src' / 'App.tsx'
    app_content = app_tsx.read_text(encoding='utf-8')

    if 'from \'./components/funnel/FunnelPage\'' not in app_content and 'from "./components/funnel/FunnelPage"' not in app_content:
        # Import FunnelPage
        app_content = app_content.replace(
            "import { AnalyticsHub, AnalyticsSubTab } from './components/analytics/AnalyticsHub';",
            "import { AnalyticsHub, AnalyticsSubTab } from './components/analytics/AnalyticsHub';\nimport { FunnelPage } from './components/funnel/FunnelPage';"
        )
        
        # Route path detection
        app_content = app_content.replace(
            "if (p.startsWith('/cancel') || h.startsWith('#/cancel') || h === '#cancel' || q === 'cancel') {\n        return '/cancel';\n      }",
            "if (p.startsWith('/cancel') || h.startsWith('#/cancel') || h === '#cancel' || q === 'cancel') {\n        return '/cancel';\n      }\n      if (p.startsWith('/funnel') || h.startsWith('#/funnel') || h === '#funnel' || q === 'funnel') {\n        return '/funnel';\n      }"
        )
        
        # Popstate path detection
        app_content = app_content.replace(
            "if (p.startsWith('/cancel') || h.startsWith('#/cancel') || h === '#cancel' || q === 'cancel') {\n        setCurrentPath('/cancel');\n      } else if (p.startsWith('/v1')",
            "if (p.startsWith('/cancel') || h.startsWith('#/cancel') || h === '#cancel' || q === 'cancel') {\n        setCurrentPath('/cancel');\n      } else if (p.startsWith('/funnel') || h.startsWith('#/funnel') || h === '#funnel' || q === 'funnel') {\n        setCurrentPath('/funnel');\n      } else if (p.startsWith('/v1')"
        )

        # Handle domain change
        domain_change_needle = "const handleDomainChange = (domain: ActiveDomainTab) => {"
        domain_change_body = """const handleDomainChange = (domain: ActiveDomainTab) => {
    // Funnel & Flows lives at its own URL (/funnel); every other domain is a tab of the dashboard at /.
    if (domain === 'funnel') {
      navigate('/funnel');
      return;
    }
    if (isFunnel) {
      navigate('/');
      setActiveDomain(domain);
      return;
    }"""
        app_content = app_content.replace(
            domain_change_needle,
            "const isFunnel = currentPath.startsWith('/funnel');\n\n  " + domain_change_body
        )

        # Render FunnelPage
        render_target = "if (isCustomerCancel) {"
        render_replacement = """if (isFunnel) {
    return (
      <DashboardShell activeDomain="funnel" onDomainChange={handleDomainChange} onDrilldown={() => navigate('/')}>
        <FunnelPage onBack={() => navigate('/')} />
      </DashboardShell>
    );
  }

  if (isCustomerCancel) {"""
        app_content = app_content.replace(render_target, render_replacement)
        app_tsx.write_text(app_content, encoding='utf-8')
        print("Updated src/App.tsx with FunnelPage routing")
    else:
        print("src/App.tsx already has FunnelPage")

    # 3. Update src/components/layout/DashboardHeader.tsx
    header_tsx = root / 'src' / 'components' / 'layout' / 'DashboardHeader.tsx'
    header_content = header_tsx.read_text(encoding='utf-8')

    if "'funnel'" not in header_content:
        header_content = header_content.replace(
            "export type ActiveDomainTab = 'glance' | 'analytics' | 'revenue' | 'sales' | 'team' | 'memberships' | 'retention' | 'usage' | 'baremetrics';",
            "export type ActiveDomainTab = 'glance' | 'analytics' | 'revenue' | 'sales' | 'team' | 'memberships' | 'retention' | 'usage' | 'baremetrics' | 'funnel';"
        )
        if 'Filter,' not in header_content:
            header_content = header_content.replace(
                "FileText,",
                "FileText,\n  Filter,"
            )
        # Add to nav lists
        header_content = header_content.replace(
            "{ id: 'glance', label: 'At a Glance', icon: LayoutDashboard },\n        { id: 'analytics', label: 'Analytics', icon: Layers },",
            "{ id: 'glance', label: 'At a Glance', icon: LayoutDashboard },\n        { id: 'analytics', label: 'Analytics', icon: Layers },\n        { id: 'funnel', label: 'Funnel & Flows', icon: Filter },"
        )
        header_content = header_content.replace(
            "{ id: 'baremetrics', label: 'Baremetrics SaaS', icon: Layers },",
            "{ id: 'baremetrics', label: 'Baremetrics SaaS', icon: Layers },\n        { id: 'funnel', label: 'Funnel & Flows', icon: Filter },"
        )
        header_tsx.write_text(header_content, encoding='utf-8')
        print("Updated src/components/layout/DashboardHeader.tsx")
    else:
        print("src/components/layout/DashboardHeader.tsx already has funnel")

    # 4. Update src/components/layout/DashboardShell.tsx
    shell_tsx = root / 'src' / 'components' / 'layout' / 'DashboardShell.tsx'
    shell_content = shell_tsx.read_text(encoding='utf-8')

    if "'funnel'" not in shell_content:
        if 'Filter,' not in shell_content:
            shell_content = shell_content.replace(
                "FileText,",
                "FileText,\n  Filter,"
            )
        shell_content = shell_content.replace(
            "{ id: 'baremetrics', label: 'Baremetrics SaaS', icon: Layers, badge: 'SaaS' },",
            "{ id: 'baremetrics', label: 'Baremetrics SaaS', icon: Layers, badge: 'SaaS' },\n    { id: 'funnel', label: 'Funnel & Flows', icon: Filter, badge: 'WhatsApp' },"
        )
        shell_content = shell_content.replace(
            "{ id: 'analytics', label: 'Analytics Hub', icon: Layers, badge: 'Hub' },",
            "{ id: 'analytics', label: 'Analytics Hub', icon: Layers, badge: 'Hub' },\n    { id: 'funnel', label: 'Funnel & Flows', icon: Filter, badge: 'WhatsApp' },"
        )
        shell_tsx.write_text(shell_content, encoding='utf-8')
        print("Updated src/components/layout/DashboardShell.tsx")
    else:
        print("src/components/layout/DashboardShell.tsx already has funnel")

    # 5. Apply the user's explicit rule: Flow 3 Inactivity Nudge to 7 Days (not 14)
    funnel_seed = root / 'server' / 'funnelSeed.js'
    if funnel_seed.exists():
        seed_content = funnel_seed.read_text(encoding='utf-8')
        # Update Flow 6 (usage-nudge) to 7 days
        seed_content = seed_content.replace(
            "name: { en: 'Usage nudge' },\n    description: { en: 'Friendly nudge for active members with no wash in 14 days.' },\n    trigger: { type: 'segment', segment: 'inactive_14d' },",
            "name: { en: 'Usage nudge (7 days)' },\n    description: { en: 'Friendly nudge for active members with no wash in 7 days.' },\n    trigger: { type: 'segment', segment: 'inactive_7d' },"
        )
        funnel_seed.write_text(seed_content, encoding='utf-8')
        print("Updated server/funnelSeed.js: Usage nudge set to 7 days (inactive_7d)")

    print("All integration steps completed successfully.")

if __name__ == '__main__':
    main()
