"""
Generate TypeScript template catalog from D:/Funnel/scripts/approved_templates_live.json
Timestamps in Riyadh Time (AST).
"""

import sys
import json
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT_DIR = Path(__file__).resolve().parent.parent

def main():
    json_path = Path("D:/Funnel/scripts/approved_templates_live.json")
    if not json_path.exists():
        raise FileNotFoundError(f"Missing {json_path}")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    templates_raw = data.get("templates", [])
    catalog = []

    for t in templates_raw:
        tid = t.get("name")
        lang = t.get("language", "ar")
        status = t.get("status", "APPROVED")
        category = t.get("category", "MARKETING").lower()

        body = ""
        buttons = []
        for comp in t.get("components", []):
            ctype = comp.get("type")
            if ctype == "BODY":
                body = comp.get("text", "")
            elif ctype == "BUTTONS":
                for b in comp.get("buttons", []):
                    buttons.append(b.get("text", ""))

        catalog.append({
            "id": tid,
            "name": tid,
            "language": lang,
            "category": category,
            "status": status,
            "body": body,
            "buttons": buttons
        })

    catalog.sort(key=lambda x: x["id"])

    ts_code = """// Official Catalog of Approved WhatsApp Templates for Rush Wash (رش واش).
// Synced from Meta/Unifonic live approved registry.

export interface WhatsAppTemplateItem {
  id: string;
  name: string;
  language: 'ar' | 'en';
  category: 'marketing' | 'utility' | 'service' | 'authentication';
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  body: string;
  buttons: string[];
}

export const TEMPLATE_CATALOG: WhatsAppTemplateItem[] = """ + json.dumps(catalog, indent=2, ensure_ascii=False) + """;

export const TEMPLATE_MAP: Record<string, WhatsAppTemplateItem> = Object.fromEntries(
  TEMPLATE_CATALOG.map((t) => [t.id, t])
);

export const getTemplateById = (id: string | null | undefined): WhatsAppTemplateItem | undefined => {
  if (!id) return undefined;
  return TEMPLATE_MAP[id];
};
"""

    dest = ROOT_DIR / "src" / "components" / "funnel" / "templateCatalog.ts"
    dest.write_text(ts_code, encoding="utf-8")
    print(f"Generated {dest} with {len(catalog)} templates.")

if __name__ == '__main__':
    main()
