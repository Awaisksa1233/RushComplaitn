"""
Add GET /api/funnel/templates endpoint to server/funnel.js
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
    catalog = []
    if json_path.exists():
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for t in data.get("templates", []):
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

    funnel_js = ROOT_DIR / "server" / "funnel.js"
    text = funnel_js.read_text(encoding="utf-8")

    if "/api/funnel/templates" not in text:
        target = "  app.get('/api/funnel/definition', async (req, res) => {"
        endpoint_code = f"""  const TEMPLATE_CATALOG = {json.dumps(catalog, indent=4, ensure_ascii=False)};

  // GET /api/funnel/templates -> list of approved WhatsApp templates with copy
  app.get('/api/funnel/templates', (req, res) => {{
    res.json({{ success: true, data: TEMPLATE_CATALOG }});
  }});

"""
        text = text.replace(target, endpoint_code + target)
        funnel_js.write_text(text, encoding="utf-8")
        print("Added GET /api/funnel/templates to server/funnel.js")
    else:
        print("GET /api/funnel/templates already present in server/funnel.js")

if __name__ == '__main__':
    main()
