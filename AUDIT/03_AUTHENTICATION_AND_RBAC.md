# 03 — Authentication & Role-Based Access Control (RBAC) Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Verification Method:** Static inspection of `src/routes/auth.ts`, `src/routes/admin.ts`, `src/middleware/auth.ts`, `src/middleware/security.ts`, `src/config/env.ts` + Vitest execution (`tests/security.test.ts` + `tests/enterprise_audit.test.ts` Tests `3.1`, `3.2`).

---

## 1. Customer Authentication Findings

| Control | Implementation (`src/routes/auth.ts`) | Verdict | Notes |
|---|---|---|---|
| **Plate + Phone Match** | Matches `Customer` in PostgreSQL, falling back to `findCustomerInMongo()` | **PASS** | `request-otp` returns `404` on mismatch (`lines 87-91`). Enables account existence enumeration by design for plate+phone check. |
| **OTP Generation & Storage** | `crypto.randomInt(100000, 1000000)` + `HMAC-SHA256(OTP_PEPPER, otp)`, 5m TTL | **PASS** | Prior active OTPs invalidated on resend (`lines 95-98`). |
| **Brute-Force Lockout** | `otpRequestLimiter` (10/15m IP), per-phone DB limit (5/15m), `otpVerifyLimiter` (20/15m IP), cumulative 5-attempt lockout across recent sessions (`lines 144-150`), atomic `updateMany` claim (`lines 175-186`) | **PASS** | Verified in Test `3.1`: 5 wrong OTPs trigger `429` on 6th; single-use replay returns `400`. |
| **International Phone Suffix Bug (`P2-01`)** | `normalizePhone()` (`src/utils/normalize.ts:8-10`) uses `.replace(/\D/g, "").slice(-9)` | **FAIL (P2)** | Test `4.2` proved `normalizePhone("+44 7569 809578") === "569809578"`, colliding with Saudi number `0569809578` without validating country prefix. |
| **`E2E_DEMO_MODE` Exposure Risk** | `src/config/env.ts:23-33`, `src/routes/auth.ts:118` returns `devOtp` in JSON if `E2E_DEMO_MODE === "true"` | **RISK (P1)** | Not gated by `!isProd`. If `E2E_DEMO_MODE=true` is left in production `.env`, any attacker requesting OTP for `569809578` receives the live `devOtp` in the HTTP response and bypasses rate limits (`line 45`). |
| **OTP-less `/track` Token Issuance (`P0-01`)** | `src/routes/complaints.ts:248-307` issues `trackToken` without OTP | **FAIL (P0)** | Completely bypasses OTP verification for any ticket whose sequential ID (`C-1043+`) and phone are known. |

---

## 2. Staff Authentication Findings

| Control | Implementation (`src/routes/admin.ts`) | Verdict | Notes |
|---|---|---|---|
| **Password Policy** | Min 12 chars, max 128, upper + lower + digit + symbol (`lines 39-43`) | **PASS** | Enforced on staff creation, self password change, and owner reset. |
| **Password Hashing & Timing** | `bcryptjs` cost 12; `DUMMY_HASH` comparison on unknown emails (`lines 36, 237`) | **PASS** | Prevents timing-based email enumeration. |
| **JWT & Session Revocation** | `HS256`, `8h` expiry, separate `STAFF_JWT_SECRET`, `pwdFp` fingerprint (`lines 56-58, 163-166`) | **PARTIAL** | Password change/reset invalidates JWTs, subject to a **15-second `staffCache` TTL** (`line 175`). Deactivated staff tokens still pass `/api/upload` and `/api/files/:key` (**P0-02**). |
| **Hardcoded E2E Credentials (`P0-03`)** | `prisma/setup_e2e_clean.ts:8`, `prisma/seed_mock_e2e.ts:19` | **FAIL (P0)** | Default fallback password `E2e-Rush!2026-Sec#9` for `BUSINESS_OWNER` / `ADMIN` without `prisma/guard.ts`. |

---

## 3. Actual Application RBAC Permission Matrix

Mapped directly from `src/routes/*.ts` (no invented roles):

| Endpoint / Capability | `BUSINESS_OWNER` | `ADMIN` | `OPS_MANAGER` | `CSM` | `FINANCE` | `Customer` |
|---|---|---|---|---|---|---|
| `GET /api/admin/config` | Allow | Allow | Allow | Allow | Allow | `401` |
| `PATCH /api/admin/config` | **Allow** | `403` | `403` | `403` | `403` | `401` |
| `GET /api/admin/dashboard` | Allow (All) | Allow (All) | Branch-scoped | Allow (All) | Allow (All) | `401` |
| `GET /api/admin/claims` & `/:id` | Allow (All) | Allow (All) | Branch-scoped | Allow (All) | Allow (All) | `401` |
| `POST /claims/:id/handoff-csm` | Allow | Allow | Branch-scoped | `403` | `403` | `401` |
| `POST /claims/:id/nudge` | Allow | Allow | Branch-scoped | Allow | Allow | `401` |
| `POST /claims/:id/unsatisfied/approve` | Allow | Allow | `403` | Allow | `403` | `401` |
| `POST /claims/:id/billing/approve` | Allow | Allow | `403` | `403` | `403` | `401` |
| `POST /claims/:id/damage/request-quote` | Allow | Allow | Branch-scoped | Allow | `403` | `401` |
| `POST /claims/:id/damage/approve-quote` | Allow (Any SAR) | <= Cap only | `403` | <= Cap only | <= Cap only | `401` |
| `POST /claims/:id/damage/sign` (`tech`/`ops`) | Allow | Allow | Branch-scoped | `403` | `403` | `401` |
| `POST /claims/:id/damage/sign` (`finance`) | Allow | Allow | `403` | `403` | Allow | `401` |
| `POST /claims/:id/refuse` | Allow | Allow | Branch-scoped | Allow | `403` | `401` |
| `PATCH /claims/:id` | Allow | Allow | Branch-scoped | Allow | `403` | `401` |
| `POST /claims/:id/messages` (**P1-02 BFLA**) | Allow | Allow | Branch-scoped | Allow | **Allow (BUG)** | `401` |
| `GET /finance`, `export.csv`, `bank-details` | Allow | Allow | `403` | `403` | Allow | `401` |
| `POST /finance/:id/invoice-details` & `mark-paid` | Allow | Allow | `403` | `403` | Allow | `401` |
| `GET/POST/PATCH /staff`, `reset-password` | Allow (All) | Non-privileged only | `403` | `403` | `403` | `401` |
| `GET /customers/:id/export`, `POST /anonymise` | **Allow** | `403` | `403` | `403` | `403` | `401` |
| `GET /api/customer/history`, `POST /complaints*` | `401` | `401` | `401` | `401` | `401` | Own tickets only |
| `POST /api/upload`, `GET /api/files/:key` | Allow (even inactive!) | Allow (even inactive!) | Allow (even inactive!) | Allow (even inactive!) | Allow (even inactive!) | **Any file (P0-02)** |

---

## 4. RBAC & Privilege Escalation Discrepancies

1. **BFLA on Staff Messages (`P1-02` — `src/routes/admin.ts:1093`)**: `POST /api/admin/claims/:id/messages` omits `requireRoles(...)`, allowing `FINANCE` (an accounting-only role) to send outbound customer WhatsApp messages via Chatwoot. Confirmed in Test `3.2` (`200`).
2. **Last-Owner & Self-Lockout Protection**: Verified in Test `3.2` — `ADMIN` receives `403` attempting to create `ADMIN`/`BUSINESS_OWNER` or modify `BUSINESS_OWNER`; `BUSINESS_OWNER` receives `403` attempting self-demotion and `409` if attempting to deactivate the sole remaining `BUSINESS_OWNER`.
3. **UI vs. Backend Staff Fetch (`public/rush_admin_operations_console.html:1865`)**: Frontend fetches `/api/admin/staff` for `isFinanceRole()` (including `FINANCE`), causing an automatic `403` error in browser devtools on every `FINANCE` login, while hiding Staff Management UI from `ADMIN` even though backend permits `ADMIN` to manage `OPS_MANAGER`/`CSM`/`FINANCE`.
4. **Administrative Audit Trail Gap (`P2`)**: Non-ticket admin actions (`STAFF_CREATE`, `STAFF_UPDATE`, `STAFF_PASSWORD_RESET`, `CONFIG_UPDATE`, `EXPORT_FINANCE_CSV`, `CUSTOMER_EXPORT`, `CUSTOMER_ANONYMISE`) only write to stdout via `console.warn("[AUDIT]...")` (`src/routes/admin.ts:52-54`), not PostgreSQL, because `AuditLog.complaintId` is non-nullable.
