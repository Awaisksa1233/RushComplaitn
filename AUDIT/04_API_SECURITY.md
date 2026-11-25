# 04 — API Security Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Total Endpoints Audited:** 32 HTTP routes across `src/server.ts` (4), `src/routes/auth.ts` (2), `src/routes/customer.ts` (1), `src/routes/complaints.ts` (11), `src/routes/upload.ts` (1), and `src/routes/admin.ts` (22 — note static script counted 50 lines including comments/helpers; exact Express route handlers verified below).

---

## 1. Complete API Endpoint Security Inventory

| Method | URL | Auth | Role | Ownership / Scope | Validation | Rate Limit | Security Status |
|---|---|---|---|---|---|---|---|
| `GET` | `/` | Public | Any | Public SPA | N/A | Global `300/m` | **WARN** (CSP `'unsafe-inline'`, no SRI) |
| `GET` | `/admin` | Public shell | Staff (on API) | Public SPA | N/A | Global `300/m` | **PASS** (no hardcoded creds) |
| `GET` | `/api/health` | Public | Any | System | N/A | Global `300/m` | **PASS** |
| `GET` | `/api/files/:key(*)` | Signed URL or Any JWT | Any JWT | **NONE (BOLA)** | Regex `FILE_KEY` | Global `300/m` | **FAIL (`P0-02`, `P1-01`)** |
| `POST` | `/api/auth/request-otp` | Public | Customer | Plate+Phone | Zod + `isSaudiMobile` | `10/15m` IP + `5/15m` phone | **WARN (`P2-01` suffix)** |
| `POST` | `/api/auth/verify-otp` | Public | Customer | Plate+Phone | Zod `^\d{6}$` | `20/15m` IP + 5 attempts | **PASS** |
| `GET` | `/api/customer/history` | Customer JWT | Customer | `req.customer.customerId` | Query string | Global `300/m` | **PASS** |
| `POST` | `/api/complaints` | Customer JWT | Customer | `req.customer.customerId` + visit check | Zod schema | Daily unlisted limits | **WARN (TOCTOU race)** |
| `POST` | `/api/complaints/track` | **Public (No OTP)** | Public | Phone + Ticket ID / Plate | Zod schema | `20/15m` IP | **FAIL (`P0-01`)** |
| `GET` | `/api/complaints/direct` | Customer JWT (`?t=`) | Customer | `c.customerId` + `ticketIds` | JWT verify | Global `300/m` | **WARN (7d token in URL)** |
| `POST` | `/api/complaints/:id/damage/upload-doc` | Customer JWT | Customer | `ownsTicket()` | Zod + `isSafeFileUrl` | Global `300/m` | **FAIL via `P0-01`** |
| `POST` | `/api/complaints/:id/damage/step1` | Customer JWT | Customer | `ownsTicket()` | Zod + magic sniff | Global `300/m` | **FAIL via `P0-01`** |
| `POST` | `/api/complaints/:id/damage/step2` | Customer JWT | Customer | `ownsTicket()` | Zod + IBAN mod-97 | Global `300/m` | **FAIL via `P0-01`** |
| `POST` | `/api/complaints/:id/whatsapp` | Customer JWT | Customer | `ownsTicket()` | Zod `1..2000` | Global `300/m` | **PASS** (if OTP-authed) |
| `POST` | `/api/complaints/:id/messages` | Customer JWT | Customer | `ownsTicket()` | Zod `1..2000` | Global `300/m` | **PASS** (if OTP-authed) |
| `POST` | `/api/complaints/:id/csat` | Customer JWT | Customer | `ownsTicket()` | Zod `int 1..5` | Global `300/m` | **PASS** |
| `POST` | `/api/complaints/webhooks/chatwoot` | HMAC or Secret header/query | Chatwoot | Ticket attr / regex / phone | Partial | `120/m` | **WARN (`P2-02`)** |
| `POST` | `/api/complaints/webhooks/whatsapp` | HMAC-SHA256 (`x-hub-signature-256`) | WhatsApp | `ticketId` lookup | Zod schema | `120/m` | **PASS** (`503` if unset) |
| `POST` | `/api/upload` | Any Customer/Staff JWT | Any | Active staff NOT checked | Magic-byte sniff + `15MB` | `40/15m` | **WARN (`P0-02` inactive staff)** |
| `POST` | `/api/admin/auth/login` | Public | Staff | Email + bcrypt | Zod email/pw | `10/15m` (skip success) | **PASS** |
| `GET`/`POST` | `/api/admin/me/signature` | Staff JWT | Any Staff | `req.staff.staffId` | DataURL PNG/JPEG/WebP + sniff | Global `300/m` | **FAIL (`P1-01` 404 serve)** |
| `POST` | `/api/admin/auth/change-password` | Staff JWT | Any Staff | `req.staff.staffId` | `PASSWORD_POLICY` | `10/15m` | **PASS** |
| `GET` | `/api/admin/auth/me`, `/config` | Staff JWT | Any Staff | Global | N/A | Global `300/m` | **PASS** |
| `PATCH` | `/api/admin/config` | Staff JWT | `BUSINESS_OWNER` | Global | Zod regexes | Global `300/m` | **PASS** |
| `GET` | `/api/admin/dashboard`, `/claims`, `/claims/:id` | Staff JWT | Any Staff | `OPS_MANAGER` branch-scoped | Query enum checks | Global `300/m` | **WARN (`P2-04` unpaginated)** |
| `POST` | `/api/admin/claims/:id/handoff-csm` | Staff JWT | `OPS_MANAGER`, `ADMIN`, `BUSINESS_OWNER` | `loadClaim()` | State check | Global `300/m` | **PASS** |
| `POST` | `/api/admin/claims/:id/nudge` | Staff JWT | Any Staff | `loadClaim()` | SLA overdue check | Global `300/m` | **PASS** |
| `POST` | `/api/admin/claims/:id/unsatisfied/approve` | Staff JWT | `ADMIN`, `BUSINESS_OWNER`, `CSM` | `loadClaim()` | State check | Global `300/m` | **PASS** |
| `POST` | `/api/admin/claims/:id/billing/approve` | Staff JWT | `ADMIN`, `BUSINESS_OWNER` | `loadClaim()` + order ceiling | Zod RRN + amount | Global `300/m` | **WARN (`P1-03` unlisted cap)** |
| `POST` | `/api/admin/claims/:id/damage/request-quote` | Staff JWT | `OPS_MANAGER`, `CSM`, `ADMIN`, `BUSINESS_OWNER` | `loadClaim()` | Zod note | Global `300/m` | **PASS** |
| `POST` | `/api/admin/claims/:id/damage/approve-quote` | Staff JWT | `FINANCE`, `CSM`, `ADMIN`, `BUSINESS_OWNER` | `loadClaim()` + SAR cap | Zod positive amount | Global `300/m` | **PASS** |
| `POST` | `/api/admin/claims/:id/damage/sign` | Staff JWT | Slot-gated | `loadClaim()` | Zod + sniff | Global `300/m` | **FAIL (`P1-01` 404 serve)** |
| `POST` | `/api/admin/claims/:id/refuse` | Staff JWT | `ADMIN`, `OWNER`, `CSM`, `OPS_MANAGER` | `loadClaim()` | Zod `min(5)` | Global `300/m` | **PASS** |
| `PATCH` | `/api/admin/claims/:id` | Staff JWT | `ADMIN`, `OWNER`, `CSM`, `OPS_MANAGER` | `loadClaim()` | Zod `.strict()` | Global `300/m` | **PASS** |
| `POST` | `/api/admin/claims/:id/messages` | Staff JWT | **Any Staff (Missing gate)** | `loadClaim()` | Zod `1..2000` | Global `300/m` | **FAIL (`P1-02` BFLA)** |
| `GET`/`POST` | `/api/admin/finance*` (`/`, `/bank-details`, `/invoice-details`, `/mark-paid`, `/export.csv`) | Staff JWT | `OWNER`, `ADMIN`, `FINANCE` | `loadClaim()` on `:id` only | Zod / `ibanRevealLimiter` (`30/15m`) | Global + `30/15m` | **WARN (`P1-03`, TOCTOU, branch)** |
| `GET`/`POST`/`PATCH` | `/api/admin/staff*` & `reset-password` | Staff JWT | `BUSINESS_OWNER`, `ADMIN` | `canManage()` | `PASSWORD_POLICY` + `.strict()` | Global `300/m` | **PASS** |
| `GET`/`POST` | `/api/admin/customers/:id/export` & `anonymise` | Staff JWT | `BUSINESS_OWNER` | Open-ticket guard | ID param | Global `300/m` | **WARN (`P1-01` orphan sigs)** |

---

## 2. Vulnerability Assessment Details

- **BOLA / IDOR**: Confirmed **FAIL (`P0-02`)** on `GET /api/files/:key(*)` (`src/server.ts:73-96`, verified in Test `2.3`).
- **BFLA**: Confirmed **FAIL (`P1-02`)** on `POST /api/admin/claims/:id/messages` (`src/routes/admin.ts:1093`, verified in Test `3.2`).
- **Authentication Bypass / Ticket Enumeration**: Confirmed **FAIL (`P0-01`)** on `POST /api/complaints/track` (`src/routes/complaints.ts:248-307`, verified in Test `2.2`).
- **SQL / NoSQL Injection**: **PASS**. Prisma uses parameterized queries everywhere (except static `SELECT 1` in `/api/health` and static `pg_tables` query in `apply_rls.ts`). MongoDB queries escape user input via `escapeRegex()` (`src/utils/normalize.ts:20-22`) and `ObjectId.isValid()` (`src/services/mongo.ts:142, 288`).
- **Mass Assignment**: **PASS**. Verified in Test `4.1`: `PATCH /api/admin/claims/:id`, `PATCH /api/admin/staff/:id`, and `POST /api/admin/finance/:id/invoice-details` use Zod `.strict()`, rejecting `approvedAmount` / `payoutStatus` tampering with `400`.
- **XSS / File Upload / SSRF**: **PASS** with CSP caveat. All dynamic HTML rendering escapes via `esc()` / `safeUrl()`; uploads enforce magic-byte verification (`sniffMatches()`, Test `4.1`), random hex keys, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` on `/api/files/:key`; `isSafeFileUrl` blocks external SSRF URLs.
- **CSRF**: **PASS** (stateless `Authorization: Bearer` headers only; no cookies).
- **Webhooks (`P2-02`)**:
  - `POST /api/complaints/webhooks/whatsapp` verifies HMAC-SHA256 on `req.rawBody` (`timingSafeEqual`) and deduplicates on `externalId` (`src/routes/complaints.ts:620-660`). Note: `WHATSAPP_WEBHOOK_SECRET` is unset in `.env` (returns `503`).
  - `POST /api/complaints/webhooks/chatwoot` accepts `?token=<secret>` in URL query string (`line 508`), risking secret leakage in proxy/access logs. Additionally, fallback step 2 (`lines 556-567`) attaches an incoming message to any `C-\d+` mentioned in `bodyText` if `sender.phone_number` is absent or invalid (verified in Test `4.2`).
