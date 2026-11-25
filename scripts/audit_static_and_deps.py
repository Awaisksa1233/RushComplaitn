"""
Standalone Enterprise Audit Static & Dependency Inspector for RUSH Customer Care Portal.
Strictly read-only against source files, schema, frontends, and package manifests.
Never prints or exposes secret values from .env.
"""
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

AST_TZ = timezone(timedelta(hours=3))
ROOT = Path(__file__).resolve().parent.parent


def now_ast_str() -> str:
    return datetime.now(AST_TZ).strftime("%Y-%m-%d %H:%M:%S AST")


def file_stats(path: Path) -> dict:
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    return {
        "rel_path": path.relative_to(ROOT).as_posix(),
        "bytes": len(raw),
        "lines": text.count("\n") + (0 if text.endswith("\n") or not text else 1),
        "sha256_12": hashlib.sha256(raw).hexdigest()[:12],
    }


def extract_routes(ts_path: Path) -> list[dict]:
    text = ts_path.read_text(encoding="utf-8")
    routes = []
    pattern = re.compile(r"\b(app|router)\.(get|post|put|patch|delete)\(\s*[\"']([^\"']+)[\"']\s*,?(.*)")
    for idx, line in enumerate(text.splitlines(), start=1):
        m = pattern.search(line)
        if m:
            routes.append({
                "file": ts_path.relative_to(ROOT).as_posix(),
                "line": idx,
                "target": m.group(1),
                "method": m.group(2).upper(),
                "path": m.group(3),
                "middleware_snippet": m.group(4).strip()[:120],
            })
    return routes


def scan_prisma_schema(schema_path: Path) -> dict:
    text = schema_path.read_text(encoding="utf-8")
    enums = re.findall(r"enum\s+(\w+)\s*\{", text)
    models = []
    model_blocks = re.finditer(r"model\s+(\w+)\s*\{(.*?)\n\}", text, re.DOTALL)
    for m in model_blocks:
        name = m.group(1)
        body = m.group(2)
        indexes = re.findall(r"@@(?:index|unique)\([^\)]+\)", body)
        relations = re.findall(r"@relation\([^\)]+\)", body)
        fields = [
            ln.strip()
            for ln in body.splitlines()
            if ln.strip() and not ln.strip().startswith("//") and not ln.strip().startswith("@@")
        ]
        models.append({
            "name": name,
            "field_count": len(fields),
            "indexes_and_uniques": indexes,
            "relations": relations,
        })
    return {"enums": enums, "models": models}


def scan_frontend_html(html_path: Path) -> dict:
    text = html_path.read_text(encoding="utf-8")
    cdn_scripts = re.findall(r"<script[^>]+src=[\"'](https?://[^\"']+)[\"'][^>]*>", text)
    cdn_sri = [tag for tag in re.findall(r"<script[^>]+src=[\"']https?://[^\"']+[\"'][^>]*>", text) if "integrity=" in tag]
    inner_html_count = len(re.findall(r"\.innerHTML\s*[+]?=", text))
    local_storage_keys = sorted(set(re.findall(r"localStorage\.(?:getItem|setItem|removeItem)\(\s*[\"']([^\"']+)[\"']", text)))
    session_storage_keys = sorted(set(re.findall(r"sessionStorage\.(?:getItem|setItem|removeItem)\(\s*[\"']([^\"']+)[\"']", text)))
    has_rosh_typo = "روش" in text
    has_rush_arabic = "رش واش" in text
    return {
        "rel_path": html_path.relative_to(ROOT).as_posix(),
        "bytes": html_path.stat().st_size,
        "lines": len(text.splitlines()),
        "external_scripts": cdn_scripts,
        "external_scripts_with_sri": len(cdn_sri),
        "innerHTML_assignments": inner_html_count,
        "localStorage_keys": local_storage_keys,
        "sessionStorage_keys": session_storage_keys,
        "has_rush_arabic_brand": has_rush_arabic,
        "has_rosh_typo": has_rosh_typo,
    }


def check_env_keys(env_example: Path, env_file: Path) -> dict:
    def parse_keys(path: Path) -> dict[str, int]:
        if not path.exists():
            return {}
        out: dict[str, int] = {}
        for ln in path.read_text(encoding="utf-8").splitlines():
            s = ln.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            val = v.strip().strip('"').strip("'")
            out[k.strip()] = len(val)
        return out

    ex_keys = parse_keys(env_example)
    env_keys = parse_keys(env_file)
    report = {}
    for k in sorted(set(ex_keys.keys()) | set(env_keys.keys())):
        report[k] = {
            "in_example": k in ex_keys,
            "present_in_env": k in env_keys and env_keys[k] > 0,
            "value_length": env_keys.get(k, 0),
        }
    return report


def run_npm_audit() -> dict:
    try:
        proc = subprocess.run(
            ["npm.cmd", "audit", "--json"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        raw = proc.stdout or "{}"
        data = json.loads(raw)
        vulns = []
        for pkg, info in (data.get("vulnerabilities") or {}).items():
            via_titles = []
            for v in info.get("via", []):
                if isinstance(v, dict):
                    via_titles.append({
                        "title": v.get("title"),
                        "severity": v.get("severity"),
                        "url": v.get("url"),
                        "range": v.get("range"),
                    })
                elif isinstance(v, str):
                    via_titles.append({"via_pkg": v})
            vulns.append({
                "package": pkg,
                "severity": info.get("severity"),
                "isDirect": info.get("isDirect"),
                "range": info.get("range"),
                "fixAvailable": info.get("fixAvailable"),
                "via": via_titles,
            })
        return {
            "metadata": data.get("metadata", {}),
            "vulnerabilities": vulns,
        }
    except Exception as exc:
        return {"error": str(exc)}


def main() -> None:
    targets = []
    for sub in ("src", "prisma", "public", "tests"):
        p = ROOT / sub
        if p.exists():
            for f in sorted(p.rglob("*")):
                if f.is_file() and f.suffix in {".ts", ".html", ".sql", ".prisma", ".json"}:
                    targets.append(f)

    files = [file_stats(f) for f in targets]
    routes = []
    for f in sorted((ROOT / "src").rglob("*.ts")):
        routes.extend(extract_routes(f))

    schema_info = scan_prisma_schema(ROOT / "prisma" / "schema.prisma")
    frontends = [
        scan_frontend_html(ROOT / "public" / "rush_wash_customer_care.html"),
        scan_frontend_html(ROOT / "public" / "rush_admin_operations_console.html"),
    ]
    env_keys = check_env_keys(ROOT / ".env.example", ROOT / ".env")
    npm_audit = run_npm_audit()

    summary = {
        "generated_at_ast": now_ast_str(),
        "file_count": len(files),
        "files": files,
        "route_count": len(routes),
        "routes": routes,
        "prisma_schema": schema_info,
        "frontends": frontends,
        "env_key_presence": env_keys,
        "npm_audit": npm_audit,
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
