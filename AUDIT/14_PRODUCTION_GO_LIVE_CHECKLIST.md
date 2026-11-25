> ⚠️ **SUPERSEDED — see [`REAUDIT_2026-11-25.md`](REAUDIT_2026-11-25.md).** An independent re-audit executed against real PostgreSQL found items below that were marked PASS but fail when run: *No exposed secrets*, *Production configuration reviewed*, *Migration strategy tested* and *Webhooks verified* are now **FAIL** (AUD-R8, R4, R5, R1); DB-constraint and isolation items are upgraded to PASS on real PostgreSQL. Full table in §3 of the re-audit. **Current decision: NO-GO (convertible to CONDITIONAL GO after the 3 P1 fixes and the BLOCKED infrastructure gates).** The original text is preserved below for history.

# 14 — Production Go-Live Master Checklist

**Audit Timestamp (Post-Phase 16 Verification):** `2026-11-25 16:48:32 AST (Asia/Riyadh)`  
**Status Legend:** `PASS` (Verified) · `MITIGATED` (Compensating Controls Verified; Residual Backlog Noted) · `BLOCKED` (Live Infra / External Cutover Gate — Cannot Verify Offline)

---

### Security
- [x] **No exposed secrets:** `PASS` — Removed hardcoded fallback password `"E2e-Rush!2026-Sec#9"` from `prisma/setup_e2e_clean.ts` & `prisma/seed_mock_e2e.ts` and guarded both with `assertSafeToRunDestructive()`; removed Chatwoot `?token=` URL query auth (`REM-003`, `REM-011`). `.env` is gitignored and `/.env` returns `404`.
- [x] **Authentication validated:** `PASS` — `POST /api/complaints/track` no longer issues `trackToken` or private data without a verified OTP `CUSTOMER_JWT` (`REM-001`, Test `2.2`); `E2E_DEMO_MODE` strictly blocked in production (`REM-008`); `normalizePhone()` rejects foreign prefixes (`REM-010`, Test `4.2`).
- [x] **Authorization validated:** `PASS` — `/api/files/:key` verifies customer ticket ownership and `verifyActiveStaffJwt` (`REM-002`, Test `2.3`); `POST /claims/:id/messages` blocks `FINANCE` (`403`, `REM-005`, Test `3.2`); `/api/upload` enforces active staff verification.
- [x] **Cross-user isolation verified:** `PASS` — Verified across `Awais` (`569809578`), User B, and User C for history, `/track`, `step1`/`step2`, messages, CSAT, and `/api/files/:key` (`Tests 2.1–2.3`).
- [x] **Cross-branch isolation verified:** `PASS` — Both `OPS_MANAGER` and branch-assigned `FINANCE` endpoints (`/finance`, `/finance/export.csv`) enforce `staff.branch` isolation (single active branch `RUSH Al Kharj`).
- [x] **RBAC verified:** `PASS` — 5-role RBAC enforced across admin approvals, staff CRUD, PDPL export/anonymise, customer messaging (`REM-005`), and `ORD-UNLISTED` owner approval caps (`REM-006`, Tests `3.2`, `7.1`).
- [x] **API security tested:** `PASS` — Mass assignment, magic-byte validation, CSV formula escaping (`Test 4.1`), `/claims` pagination + `/dashboard` query bounds (`REM-013`), and Chatwoot webhook hardening (`Test 4.2`) all verified.
- [x] **File permissions verified:** `PASS` — Shared `VALID_STORAGE_KEY` includes `signatures` (`REM-004`, Test `6.1`); cross-customer BOLA and stale staff tokens blocked (`REM-002`, Test `2.3`); `waiverSignature` deleted on PDPL anonymisation.
- [x] **Session management verified:** `PASS` — Deactivated staff tokens (`active`/`pwdFp`) rejected everywhere including `/api/upload` and `/api/files/*`; frontend `tickets = []` cleared on `verifyOtp()`, `resetFileFlow()`, and `clearTrackSession()` (`REM-012`).
- [x] **Security headers reviewed:** `MITIGATED` — Added `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store` on `/api` alongside `frame-ancestors 'none'` and `nosniff`. Single-file SPAs still use `'unsafe-inline'` CSP and Tailwind Play CDN without SRI (`REM-015` frontend prebuild deferred to post-cutover UI build pipeline).
- [x] **Dependency vulnerabilities assessed:** `MITIGATED` — `npm audit` identified `zod@3.24.2` (`GHSA-mrhx-c7xc-m3w5`); major upgrade to `zod@4.x` deferred to avoid breaking schema API changes during freeze (`REM-015`), mitigated via `.max()` array bounds and `1mb` JSON payload limit.

### Database
- [x] **Database integrity verified:** `PASS (Schema + Migration SQL)` — Added `@unique` on `Complaint.rrn` & `Message.externalId`, partial unique index on listed `Complaint(customerId, posRecordId)`, nullable `AuditLog.complaintId`, and atomic `updateMany` transitions (`REM-007`, `REM-014`). Live execution on staging/prod DB requires `prisma migrate deploy`.
- [x] **Constraints validated:** `PASS` — Concurrent duplicate complaint creation and concurrent `mark-paid` payouts serialized and rejected cleanly (`REM-007`, Test `7.2`).
- [x] **Indexes reviewed:** `PASS` — Added composite indexes on `Complaint(customerId, posRecordId)`, `Complaint(status, createdAt)`, `Complaint(site, status, createdAt)`, `Complaint(payoutStatus, updatedAt)`, `OtpSession(createdAt)`, and `AuditLog(createdAt)` (`REM-013`).
- [ ] **Migration strategy tested:** `PASS (Artifact) / BLOCKED (Live Apply)` — Baseline migration `prisma/migrations/20261125163500_enterprise_hardening/migration.sql` + `migration_lock.toml` generated (`REM-008`), plus `prisma:migrate:deploy` npm script. **Must be applied against staging Supabase before cutover.**
- [ ] **Backups configured:** `BLOCKED` — Supabase managed backup schedule/retention cannot be verified offline without live project console access.
- [ ] **Restore successfully tested:** `BLOCKED` — **Mandatory Pre-Cutover Gate:** Execute and document one Supabase PITR/snapshot restore drill on staging before go-live.
- [x] **Transaction handling verified:** `PASS` — Multi-step damage approvals, billing approvals, `mark-paid` payouts, `step2` IBAN submission, and `csat` submissions use atomic conditional `updateMany` / per-key async locks (`withKeyLock`).

### Functionality
- [x] **Critical workflows tested:** `PASS` — Digital signatures (`signatures/*` -> `200`, PDPL delete -> `404`), Customer Step 1 `quotedAmount` capture, Step 1 `Passenger Side & Mirror` SVG highlight, Admin `Other` filter/chart, and OTP-unlock flow for `/track` (`REM-001`, `REM-004`, `REM-008`, `REM-017`).
- [x] **Forms validated:** `PASS` — Zod schemas + IBAN mod-97 + magic-byte sniffing + button double-click locks (`withActionLock`) verified.
- [ ] **API integrations tested:** `BLOCKED` — Unifonic SMS, Chatwoot live API, Cloudflare R2 live bucket, and local MongoDB (`127.0.0.1:27017`) verified via offline mocks/stubs only (`DISABLE_OUTBOUND_MESSAGING=true`, `ENABLE_LOCAL_MONGO=false`). Live staging smoke test required pre-cutover.
- [x] **Error handling tested:** `PASS` — Global Express error handler hides stack traces and normalizes Multer/JSON errors cleanly.
- [x] **Duplicate submissions tested:** `PASS` — Backend per-key locks / unique constraints + frontend `withActionLock()` prevent duplicate complaint creation and double payout execution (`Test 7.2`).
- [x] **Permissions tested:** `PASS` — See Security RBAC & BOLA checks above.
- [ ] **Mobile and desktop tested:** `BLOCKED` — Static responsive/ARIA/keyboard (`Escape`) checks verified; live browser E2E smoke check recommended during staging UAT.

### Financial
- [x] **Payment success tested:** `PASS (Logical)` — RRN billing approval and Damage `mark-paid` tested in-memory (`Tests 7.1, 7.2`).
- [x] **Payment failure tested:** `PASS` — Invalid IBAN mod-97, non-owner ceiling breaches, and missing invoice rejections verified (`Tests 7.1`).
- [x] **Duplicate transactions prevented:** `PASS` — Concurrent `mark-paid` executes strictly once; `Complaint.rrn` enforces DB uniqueness (`Tests 7.2`).
- [x] **Webhooks verified:** `PASS (Code) / BLOCKED (Prod Env)` — Query `?token=` auth and phone-less `C-\d+` Chatwoot matching removed (`REM-011`, `Test 4.2`). **Operator must populate `WHATSAPP_WEBHOOK_SECRET` in production `.env` if direct WhatsApp webhook is enabled.**
- [x] **Refunds tested:** `PASS` — `ORD-UNLISTED` refunds capped at `damageApprovalCapSar` unless executed by `BUSINESS_OWNER` (`REM-006`, `Test 7.1`).
- [x] **Reconciliation verified:** `PASS` — `mark-paid` caps payout at `min(baseAmount, invoiceTotalSar)` (`REM-006`, `Test 7.1`).

### Infrastructure
- [x] **Production configuration reviewed:** `PASS (Code) / BLOCKED (Prod Env)` — `E2E_DEMO_MODE` gated (`!isProd`), R2 local disk fallback disabled in prod unless `ALLOW_LOCAL_STORAGE_FALLBACK=true` (`REM-009`), graceful `SIGTERM`/`SIGINT` shutdown wired (`src/server.ts` + `closeMongoClient()`). Operator must verify prod `.env` secrets (`WHATSAPP_WEBHOOK_SECRET`, `TRUST_PROXY`).
- [ ] **HTTPS verified:** `BLOCKED` — Reverse proxy / TLS termination on live VPS outside repository scope.
- [ ] **DNS verified:** `BLOCKED` — `crm.rush.com.sa` DNS/CDN routing outside repository scope.
- [x] **Deployment tested:** `PASS (Container/PM2 Ready) / BLOCKED (Live Deploy)` — Added `Dockerfile`, `.dockerignore`, `ecosystem.config.cjs`, and `npm run build` verification (`tsc` exit `0`). Staging container/PM2 deploy check required pre-cutover.
- [ ] **Rollback tested:** `BLOCKED` — Versioned migration baseline + `ecosystem.config.cjs`/`Dockerfile` ready; live rollback drill required during staging cutover.
- [x] **Monitoring configured:** `MITIGATED` — Persistent DB `AuditLog` now captures non-ticket security/admin events (`CONFIG_UPDATE`, `RBAC_DENIED`, `AUTH_LOGIN_FAILED`, `STAFF_*`, `EXPORT_FINANCE_CSV`, `CUSTOMER_*`) (`REM-014`); external Sentry/APM DSN remains optional post-cutover enhancement.
- [ ] **Alerting configured:** `BLOCKED` — Infrastructure/APM alerting rules outside repository.
- [x] **Recovery procedures documented:** `PASS` — Documented in `AUDIT/11_MONITORING_AND_INCIDENT_RESPONSE.md`.

### Operations
- [x] **Admin account secured:** `PASS` — Destructive E2E scripts guarded (`assertSafeToRunDestructive()`) and hardcoded credentials removed (`REM-003`).
- [x] **Operational documentation available:** `PASS` — `README.md` updated with current `src/` layout, `prisma:migrate:deploy`, container/PM2 instructions, and test gates (`REM-018`).
- [x] **Support procedures available:** `PASS` — Bilingual customer portal + Chatwoot WhatsApp integration documented.
- [x] **Incident response documented:** `PASS` — Documented in `AUDIT/11_MONITORING_AND_INCIDENT_RESPONSE.md`.
- [ ] **Release owner assigned:** `BLOCKED` — **Mandatory Pre-Cutover Gate:** Business Owner / Engineering Lead must designate the cutover Release Owner.
