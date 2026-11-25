# 02 — User Isolation & Data Privacy Audit (P0 Critical)

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Verification Method:** Static code audit + isolated in-memory Supertest execution (`tests/enterprise_audit.test.ts`, Tests `2.1`–`2.4`) using synthetic users/branches (`User A`: `Awais` / `569809578` / `5962HSS` / `MG`; `User B`: `Synthetic User B` / `500000001` / `1111AAA`; `User C`: `Synthetic User C` / `500000002` / `2222BBB`).

---

## 1. Real Database Ownership Matrix (`prisma/schema.prisma` + MongoDB)

| Table / Collection | Owner | Branch / Tenant Scope | Access Rules | Sensitive Data |
|---|---|---|---|---|
| `SystemConfig` | System / `BUSINESS_OWNER` | Global (`id = "default"`) | Read: any staff (`GET /config`); Write: `BUSINESS_OWNER` only | VAT, CR, Unified No., WhatsApp No. |
| `StaffUser` | System / Privileged Staff | `branch` (`"All Branches"` or `"RUSH Al Kharj"`) | Read/Manage: `BUSINESS_OWNER`, `ADMIN` (non-privileged only); Self: `/me/signature`, `/auth/change-password` | Email, phone, `passwordHash` (bcrypt), `signatureUrl` |
| `AuditLog` | System / Staff | Inherited via `Complaint.site` | Created on ticket actions/SLA/bank reveal; Read: Staff via `/claims` | `actorName`, `action`, `details` |
| `Customer` | Customer (self) / Staff | Shared across branch visits | Auth via Plate+Phone OTP; Staff via `/claims`, `/finance`, Owner PDPL `/export` & `/anonymise` | Name, phone, email, license plate, vehicle model |
| `WashVisit` | Customer (`customerId`) | `site` (`RUSH Al Kharj`) | Customer JWT read (`GET /customer/history`, 7-day window) | Plate/visit history |
| `PosOrder` | Customer (`customerId`) | `site` (`RUSH Al Kharj`) | Customer JWT read (`GET /customer/history`), Refund ceiling check | Order amount, payment method |
| `OtpSession` | Customer identity (`phone`, `licensePlate`) | Global | Internal auth only; purged after 24h | `codeHash` (HMAC-SHA256), attempt counter |
| `Complaint` | Customer (`customerId`) + Assigned Staff | `site` (`RUSH Al Kharj`) | Customer: `ownsTicket()` (`customerId` + optional `ticketIds`); Staff: `OPS_MANAGER` restricted to `staff.branch`; others cross-branch | **CRITICAL:** AES-256-GCM `iban`, `accountHolder`, `bankName`, `cardLast4`, `bankSmsText`, `invoiceUrl`, `quotationUrl`, `waiverSignature`, `INTERNAL` messages |
| `Message` | Customer / Staff | Inherited via `Complaint` | Customer sees non-`INTERNAL` messages on owned tickets; Staff sees all | Customer communications & internal notes |
| `rushwash_*` (MongoDB) | POS External System | Single branch (`Al Kharj`) | Strictly read-only lookup (`findCustomerInMongo`, `getWashesFromMongo`, `getOrdersFromMongo`) | Customer names, phones, plates, orders |

---

## 2. Cross-User Isolation Test Results

| Test Case | Endpoint / Vector | Expected | Actual Result | Status |
|---|---|---|---|---|
| Read User B wash/order history as User A | `GET /api/customer/history` | Only User A records | Returns only `POS-AUD-A1`; User B's `POS-AUD-B1` excluded (`200`) | **PASS** |
| Submit complaint referencing User B's `POS-AUD-B1` as User A | `POST /api/complaints` | `400` rejected | `400` ("The selected visit/order was not found on your account.") | **PASS** |
| Mutate User B's ticket via authenticated endpoints (`step1`, `step2`, `upload-doc`, `whatsapp`, `messages`, `csat`) as User A | `POST /api/complaints/:id/*` | `404 Ticket not found` | `404` on all 6 endpoints; no existence leak | **PASS** |
| Cross-ticket `track`-scoped JWT accessing another ticket (`C-9999` token -> User B ticket) | `POST /api/complaints/:id/messages` | `404 Ticket not found` | `404` (`ownsTicket()` checks `c.ticketIds`) | **PASS** |
| **Unauthenticated-OTP Ticket Takeover & IBAN Hijack (`P0-01`)** | `POST /api/complaints/track` (`query: C-7701`, `phone: 0500000002`) -> `POST /api/complaints/C-7701/damage/step2` | Require OTP or read-only status only | **FAIL:** Returns `200`, leaks full `ticketDto` (`messages`, `rewashCode`, signed file URLs), issues 2h `trackToken`, and allows attacker to write attacker `iban` on `step2` (`200`), locking out User C (`409`) | **FAIL (P0)** |
| **Cross-Customer File BOLA (`P0-02`)** | User A JWT -> `GET /api/files/invoices/<User B key>` | `403` or `404` | **FAIL:** `realServerApp` returns **`200`** with User B's raw PDF bytes (`%USER-B-PRIVATE-INVOICE`) | **FAIL (P0)** |
| **Plate + Phone Lookup Weak Secret (`POST /track` with Plate)** | `POST /api/complaints/track` (`query: 5962HSS`, `phone: 0569809578`) | Limited status only | Returns `limited: true`, omits `trackToken`, `messages`, `iban`, `mediaUrls` (`200`) | **PASS** |

**Root Cause Evidence:**
- **P0-01 (`src/routes/complaints.ts:248-307`)**: `byId` (`/^C-\d+$/`) mints a full-privilege `track` JWT (`customerId`, `ticketIds`) without OTP verification, and sequential ticket IDs (`C-1043 + count`) make ticket IDs enumerable.
- **P0-02 (`src/server.ts:73-91`)**: `hasValidFileAuth()` checks only whether the Bearer token verifies against `CUSTOMER_JWT_SECRET` or `STAFF_JWT_SECRET`—it performs zero lookup associating `:key` with `req.customer.customerId`.

---

## 3. Multi-Branch (Tenant) Isolation Results

RUSH Car Wash operates a single production branch (`RUSH Al Kharj`). Multi-branch isolation was tested with synthetic `SYNTHETIC_BRANCH_B` (`src/routes/admin.ts:184-211`):
1. `OPS_MANAGER` (`RUSH Al Kharj`) cannot view `SYNTHETIC_BRANCH_B` tickets in `GET /api/admin/claims` (excluded) or `GET /api/admin/claims/C-7702` (`404`).
2. `OPS_MANAGER` (`SYNTHETIC_BRANCH_B`) can view `C-7702` (`200`).
3. **Finding (`P2`)**: `GET /api/admin/finance` (`src/routes/admin.ts:1120-1151`), `GET /api/admin/finance/export.csv` (`line 1260`), and `GET /api/admin/finance/:id/bank-details` (`line 1154`) do **not** filter by `branchScopeWhere` for `FINANCE` staff—if `FINANCE` is scoped to a single branch (`staff.branch = "RUSH Al Kharj"`), they still read all branches in `/finance` and `export.csv`.

---

## 4. Database-Level Isolation (PostgreSQL RLS & Supabase)

Inspected `prisma/enable_rls.sql` and `prisma/apply_rls.ts`:
- `ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY` is applied to all 9 application tables plus `_prisma_migrations`.
- `REVOKE ALL ON TABLE public.%I FROM anon` and `authenticated` blocks direct Supabase Data API (PostgREST) access.
- **Architecture Note**: Because Express connects via PgBouncer (`?pgbouncer=true` on port `6543`) as the privileged Prisma role (`postgres`), RLS is **bypassed** by the backend; tenant/user isolation depends 100% on Express route filters. Furthermore, no SQL migration records whether `prisma/apply_rls.ts` was executed on the target Supabase instance (**BLOCKED** live verification per Rule 1).

---

## 5. Session & Frontend Cache Isolation

| Control | Implementation | Result |
|---|---|---|
| **Staff Token Revocation (`pwdFp` + `active`)** | `requireStaff` (`src/routes/admin.ts:133-181`) checks `user.active` and `pwdFp` (HMAC of `passwordHash`) | Password reset / pause revokes `/api/admin/*` within **15s** (`staffCache` TTL); **HOWEVER**, deactivated staff tokens still pass `POST /api/upload` (`src/routes/upload.ts:12-24`) and `GET /api/files/:key` (`src/server.ts:73-91`) for up to **8 hours** (**P0-02**). |
| **Customer Token Logout / Revocation** | Stateless 30m (`otp`) / 2h (`track`) / 7d (`?t=`) JWTs (`src/middleware/auth.ts:17-47`) | **No server-side revocation**; 7-day `?t=` links delivered via Chatwoot/WhatsApp cannot be revoked if forwarded. |
| **Frontend Global State Leak (`P2-03`)** | `public/rush_wash_customer_care.html:309, 1558-1570, 1681-1698` | **FAIL:** Module-level `let tickets = []` is **never cleared** by `resetFileFlow()` or `clearTrackSession()`. On a shared kiosk/browser, User B submitting a Plate+Phone lookup falls back (`line 1660`) or accesses in-memory `tickets` from User A's earlier session until full page reload. |
| **HTTP Cache Headers** | `Cache-Control: no-store` on `/`, `/admin`, and `/api/files/:key` (`src/server.ts:99, 124-129`) | **PASS** for HTML shells and files; `/api/admin/*` and `/api/customer/*` JSON responses omit explicit `Cache-Control: private, no-store` (rely on browser default for Auth headers). |
| **Admin Console Logout** | `handleLogout()` (`public/rush_admin_operations_console.html:1836-1851`) clears `sessionStorage`, resets `claims = []`, `staffUsers = []`, and re-opens login modal | **PASS** |
