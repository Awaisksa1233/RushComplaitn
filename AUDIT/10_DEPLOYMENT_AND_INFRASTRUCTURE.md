# 10 — Deployment & Infrastructure Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Scope:** Environment completeness, secret management, reverse proxy/CORS/HTTPS, storage fallback resilience, process supervision, CI/CD, and deployment safety.

---

## 1. Environment Variable & Secret Completeness (`.env.example` vs `.env`)

Inspected `.env` **key presence and byte-length metadata only** (zero secret values read or logged):

| Variable | In `.env.example` | Present in `.env` | Length / Value Status | Audit Assessment |
|---|---|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Yes | Yes | 133 / 118 chars | Points to remote Supabase pooler/direct host |
| `JWT_SECRET` | Yes | Yes | 45 chars (>= 32) | Enforced by `requireSecret("JWT_SECRET", 32)` (`src/config/env.ts:5-13`) |
| `FIELD_ENCRYPTION_KEY` | Yes | Yes | 64 hex chars (32B) | Enforced at startup (`src/config/env.ts:41-51`) |
| `CHATWOOT_WEBHOOK_SECRET`, `CHATWOOT_API_TOKEN` | Yes | Yes | 48 / 24 chars | Configured |
| **`WHATSAPP_WEBHOOK_SECRET`** | Yes | **NO** | **0 chars (Missing)** | `/api/complaints/webhooks/whatsapp` is **disabled (`503`)** in current `.env`! |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Yes | Yes | 32 / 32 / 64 / 8 chars | Configured; `R2_PUBLIC_URL` empty (proxy-only mode) |
| `UNIFONIC_APP_ID`, `UNIFONIC_SENDER_ID`, `UNIFONIC_BASE_URL` | Yes | Yes | 30 / 8 / 29 chars | Configured |
| `TRUST_PROXY`, `NODE_ENV`, `PORT`, `PUBLIC_PORTAL_URL` | Yes | Yes | 1 / 11 / 4 / 23 chars | `TRUST_PROXY` validated as non-negative integer (`src/server.ts:27-33`) |
| `CORS_ORIGINS` | Yes | Empty | 0 chars | Same-origin enforced (`cors({ origin: false })`, `src/server.ts:57`) |
| `ALLOWED_SITES` | Yes | Empty | Defaults `"RUSH Al Kharj"` | Matches single active branch rule |
| `RETENTION_*` | Yes | Empty | Defaults `24h / 90d / 730d` | Functional defaults |

---

## 2. Deployment, Infrastructure & Hardening Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| **INF-01** | **P0 (`P0-03`)** | **Unguarded Destructive & Credential-Seeding Scripts** | `prisma/setup_e2e_clean.ts` and `prisma/seed_mock_e2e.ts` lack `assertSafeToRunDestructive()`. Running them against production wipes all tickets (`setup_e2e_clean.ts:12-14`) and creates privileged `BUSINESS_OWNER` / `ADMIN` accounts with fallback password `E2e-Rush!2026-Sec#9`. |
| **INF-02** | **P1** | **Silent Fallback from Cloudflare R2 to Ephemeral Local Disk** | `src/services/storage.ts:72-87`: If `client.send(PutObjectCommand)` throws an error, `uploadFile()` catches it, logs a warning, and silently writes to local `uploads/`. In multi-instance or containerized/ephemeral hosting, files vanish on redeploy or return `404` on sibling instances. |
| **INF-03** | **P1** | **No Production Process Supervision, CI/CD, or Container Config in Repo** | Only `Run_Customer_Portal.bat` (Windows local batch script) exists in `Customer Portal/`. There is no `Dockerfile`, `systemd` unit, `pm2` `ecosystem.config.js`, or `.github/workflows` CI running `tsc --noEmit` + `vitest` before deploy. |
| **INF-04** | **P1** | **`E2E_DEMO_MODE` Not Blocked in Production** | `src/config/env.ts:23-33` does not throw or disable `E2E_DEMO_MODE` when `NODE_ENV === "production"`, unlike `exposeDevOtp` (`line 22`) which checks `NODE_ENV === "development"`. |
| **INF-05** | **P2** | **No Graceful Shutdown (`SIGTERM`/`SIGINT`)** | `src/server.ts:168-173` does not close the HTTP server or call `prisma.$disconnect()` / Mongo `client.close()` on shutdown signals, risking aborted in-flight requests during zero-downtime restarts. |
| **INF-06** | **P3** | **Archive Artifact & Unchecked `uploads/` Presence** | `RushComplaitn_updated.zip` (96 KB) sits in the project root; `.gitignore` properly excludes `.env`, `dist/`, `uploads/`, `backups/`, `*.zip`. |

---

## 3. Live Infrastructure Items (`BLOCKED` — Outside Repo)
The following production infrastructure gates could not be inspected from the local repository alone and are marked **`BLOCKED`**:
- Live VPS / PaaS hosting OS, firewall rules, and process manager (`pm2` / `systemd`).
- Reverse proxy (Nginx / Caddy / Cloudflare) TLS/SSL certificate validity, HSTS, and `X-Forwarded-For` hop count matching `TRUST_PROXY=1`.
- Production DNS records for `crm.rush.com.sa` and staging environment parity.
- Supabase network restrictions / IP allowlists and automated backup restoration verification.
