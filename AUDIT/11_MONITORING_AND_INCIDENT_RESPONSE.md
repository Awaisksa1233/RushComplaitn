# 11 — Monitoring, Logging & Incident Response Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Scope:** Error tracking, structured logging, audit trail completeness, PII redaction, alerting, and incident response playbooks.

---

## 1. Logging, Monitoring & Audit Trail Assessment

| Capability | Current Implementation | Status | Gap / Finding |
|---|---|---|---|
| **Application Error Tracking** | `console.error("Server Error:", err?.message)` (`src/server.ts:160`) | **FAIL (`P2`)** | No Sentry SDK (`@sentry/node`) or centralized error aggregation. Drops stack traces, request IDs, and route paths, making production root-cause diagnosis blind. |
| **API & Auth Failure Logging** | None for `401`/`403`/`429` rejections | **FAIL (`P2`)** | Failed staff logins, OTP lockouts, HMAC webhook rejections, and `403` RBAC denials are **never logged**—brute-force or credential-stuffing attacks go undetected. |
| **Administrative Activity Logs** | `auditLog()` (`src/routes/admin.ts:52-54`) writes to stdout via `console.warn` | **FAIL (`P2`)** | `STAFF_CREATE`, `STAFF_UPDATE`, `STAFF_PASSWORD_RESET`, `CONFIG_UPDATE`, `EXPORT_FINANCE_CSV`, `CUSTOMER_EXPORT`, `CUSTOMER_ANONYMISE` are **ephemeral stdout only** (lost on restart; only ticket-level actions and `REVEAL_BANK_DETAILS` persist to `AuditLog` table). |
| **Background Job Monitoring** | `console.log` / `console.error` in `retention.ts` & `slaSweeper.ts` | **WARN (`P2`)** | No heartbeat, dead-man's switch, or alert if `runRetention` or `runSlaSweep` repeatedly fails. |
| **Uptime & Performance Monitoring** | `GET /api/health` (`src/server.ts:132-139`) checks `SELECT 1` | **WARN** | Health endpoint exists and leaks no internals, but no external uptime monitor/alerting config is documented in repo. |
| **Sensitive Data Redaction in Logs** | `maskPhone()` in `src/services/unifonic.ts:10-13` | **PASS** | Unifonic masks recipient phone (`966•••••78`); no passwords, JWTs, or full IBANs are logged. **Exception:** Chatwoot webhook `?token=` query parameter (`complaints.ts:508`) risks exposure in upstream reverse-proxy access logs! |

---

## 2. Production Incident Response Runbooks

### IR-1: Unauthorized Data Access / Cross-User Breach (`P0-01` / `P0-02`)
1. **Contain:** Rotate `JWT_SECRET` immediately (invalidates all Customer, Staff, and File URL tokens globally) and block `/api/complaints/track` `trackToken` issuance via WAF/hotfix.
2. **Investigate:** Review proxy access logs for `POST /api/complaints/track`, `GET /api/files/*`, and `POST /api/complaints/*/damage/step2`. Query `Complaint` rows modified recently for IBAN changes.
3. **Remediate & Notify:** Reset affected payout states (`PENDING_BANK_TRANSFER` -> hold), verify customer identity via phone + OTP before re-enabling payout, and assess PDPL breach notification obligations.

### IR-2: Fraudulent or Duplicate Payout / RRN Discrepancy
1. **Contain:** Immediately freeze finance transfers (`FINANCE` role pause via Owner console) and audit `AuditLog` for `MARK_PAID`, `APPROVE_BILLING_REFUND`, and `REVEAL_BANK_DETAILS`.
2. **Reconcile:** Cross-check `Complaint.transferRef`, `approvedAmount`, `invoiceTotalSar`, and Wafeq journal numbers against actual bank transfer statements.

### IR-3: Database Corruption or Accidental Seed Wipe (`P0-03`)
1. **Contain:** Put API into maintenance mode (`503`) to halt writes.
2. **Recover:** Execute Supabase Point-in-Time Recovery (PITR) or restore latest verified snapshot via `DIRECT_URL`, then re-run `tsx prisma/apply_rls.ts`.

### IR-4: Third-Party Outage (Unifonic SMS, Chatwoot WhatsApp, Cloudflare R2, or Supabase)
- **Unifonic Down:** Customers cannot complete OTP; monitor `/api/auth/request-otp` failure logs, switch customers to WhatsApp manual support (`966503444958`), and check Unifonic status.
- **Chatwoot Down:** Complaints still save in PostgreSQL (`catch` non-fatal); queue missed notifications for replay after recovery.
- **R2 Down:** Verify whether files fell back to local `uploads/` (`src/services/storage.ts:79-87`) and sync orphaned local files back to R2 before restarting/redeploying.
- **Failed Deploy:** Roll back `dist/` artifact to previous verified release tag and verify `/api/health` returns `200 {"status":"ok"}`.
