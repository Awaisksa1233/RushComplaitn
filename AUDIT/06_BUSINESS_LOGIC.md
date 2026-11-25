# 06 — Business Logic & Workflow Validation Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Scope:** End-to-end validation of all 7 critical business workflows in `Customer Portal` against backend state machines, frontend UIs, and automated test results (`tests/enterprise_audit.test.ts`).

---

## 1. Critical Business Workflow Inventory

| # | Workflow | Entry / Files | Backend Enforced? | Verdict |
|---|---|---|---|---|
| **WF-1** | Customer OTP Auth & 7-Day Wash / Paid Order Lookup | `src/routes/auth.ts`, `src/routes/customer.ts`, `src/services/mongo.ts` | Yes (OTP + customerId) | **PASS** (minor phone suffix bug `P2-01`) |
| **WF-2** | Unsatisfied Wash -> Rewash Pass (`RW-xxxxxxxx`) | `src/routes/complaints.ts`, `src/routes/admin.ts:696-743` | Yes (role + open state) | **WARN** (No POS/Mongo sync; manual cashier check; TOCTOU race) |
| **WF-3** | Billing / Refund Dispute & RRN Approval | `src/routes/complaints.ts`, `src/routes/admin.ts:746-817` | Partial (listed ceiling only) | **FAIL (`P1-03`)** (`ORD-UNLISTED` unverified SAR 100k ceiling; no owner cap) |
| **WF-4** | Damage 2-Step Settlement (Quote -> Waiver -> Cap -> Invoice/IBAN -> Mark Paid) | `src/routes/complaints.ts:344-474`, `src/routes/admin.ts:626-1257` | Partial | **FAIL (`P0-01`, `P1-03`)** (OTP-less track hijack; `mark-paid` ignores `invoiceTotalSar` & signatures) |
| **WF-5** | Digital Signatures & Printable Damage Compensation Form | `src/routes/admin.ts:267-279, 935-1012`, `src/routes/complaints.ts:392-402` | **Broken file regex** | **FAIL (`P1-01`)** (100% of `/api/files/signatures/*` return `404`!) |
| **WF-6** | Omni-Channel Chatwoot / WhatsApp Sync & SLA Sweeper | `src/services/chatwoot.ts`, `src/services/slaSweeper.ts` | Partial | **WARN (`P1-02`, `P2-02`)** |
| **WF-7** | PDPL Data Export, Erasure & 6h Retention Scheduler | `src/services/retention.ts`, `src/routes/admin.ts:1384-1414` | Yes (`BUSINESS_OWNER`) | **WARN (`P1-01` orphan sig files; `P2` no transaction)** |

---

## 2. Detailed 10-Condition Workflow Verification Matrix

### WF-1: Customer Verification & Visit/Order History
1. **Normal execution**: Plate + Phone -> 6-digit OTP -> JWT (`30m`) -> `GET /api/customer/history` returns last 3 washes within 7 days or last 10 paid orders (`PASS`).
2. **Invalid input**: Non-Saudi phone or malformed plate rejected `400`; invalid OTP rejected `401` (`PASS`, Test `3.1`).
3. **Missing info**: Missing plate/phone rejected `400` (`PASS`).
4. **Duplicate submission**: Duplicate OTP invalidates prior active OTP (`PASS`); duplicate complaint on same `posRecordId` rejected `409` sequentially (`PASS`).
5. **Interrupted execution / Timeout**: Mongo adapter uses `2000ms` timeouts and fails closed returning `[]` (`PASS`).
6. **Concurrent execution**: Concurrent `verify-otp` uses atomic `updateMany` (`PASS`, Test `3.1`); concurrent `POST /api/complaints` bypasses duplicate check (**FAIL**, Test `7.2`).
7. **Unauthorized execution**: Cross-user visit ID submission rejected `400` (`PASS`, Test `2.1`).
8. **Partial failure / Retry**: Unifonic failure is caught/logged asynchronously (`src/routes/auth.ts:110-112`) without blocking; customer can resend after 60s UI cooldown (`PASS`).

### WF-2: Unsatisfied Wash -> Rewash Pass
- **Gap Identified**: Issuing `RW-XXXXXXXX` (`src/routes/admin.ts:704`) updates PostgreSQL and notifies the customer via Chatwoot, **but does not write any coupon/voucher to POS MongoDB (`rushwash_discounts`) or track redemption**. A cashier cannot scan/redeem the QR code in the POS register (the customer care HTML renders a **static decorative SVG** pretending to be a QR code at `public/rush_wash_customer_care.html:1719-1728`!).
- **Recommendation**: Document clearly as manual cashier visual verification or integrate POS voucher redemption post-launch.

### WF-3 & WF-4: Billing Refunds & Damage 2-Step Settlement
- **State Machine Gaps Confirmed**:
  1. `handoff-csm` checks `claim.type === "DAMAGE" && !isClosed(claim)`, **but does not require `vehicleZones.length > 0` or inspection note on the backend** (only checked in frontend `rush_admin_operations_console.html:2186-2189`). Calling API directly skips inspection.
  2. `damage/step1` (`src/routes/complaints.ts:376-423`) allows any `CUSTOMER_JWT` (including `trackToken` from OTP-less `/track` — **P0-01**) to set/overwrite `quotedAmount` up to `100,000` before approval.
  3. `damage/approve-quote` properly enforces `config.damageApprovalCapSar` (200 SAR) against stored `quotedAmount` and restricts overrides to `BUSINESS_OWNER` (`src/routes/admin.ts:882-896`).
  4. `damage/step2` locks `iban` write-once (`line 437`) — which becomes an account-lockout weapon when exploited via **P0-01** (proven in Test `2.2`).
  5. `finance/:id/mark-paid` (`src/routes/admin.ts:1213-1257`) transitions directly to `PAID`/`RESOLVED` without verifying: (a) `invoiceTotalSar` matches `quotedAmount`, (b) Wafeq journal number is entered, or (c) Tech/Ops/Finance signatures are signed.

### WF-5: Digital Signatures (`P1-01` — 100% Broken)
- **Proven in Test `6.1`**:
  - `POST /api/admin/me/signature` (`src/routes/admin.ts:272-279`), `POST /api/admin/claims/:id/damage/sign` (`line 969`), and `POST /api/complaints/:id/damage/step1` (`line 398`) upload signature PNGs under prefix `"signatures"` (`/api/files/signatures/<ts>-<32hex>.png`).
  - `src/server.ts:72` (`FILE_KEY`), `src/utils/crypto.ts:5` (`VALID_STORAGE_KEY`), and `src/services/storage.ts:112` (`VALID_STORAGE_KEY`) **only allow** `media|quotations|invoices|complaints|damage`.
  - Result:
    1. `signFileUrl()` refuses to sign signature URLs (`crypto.ts:67`), returning an unsigned URL.
    2. `GET /api/files/signatures/...` unconditionally returns **`404 File not found`** (proven in Test `6.1`).
    3. `deleteFile()` / `deleteFiles()` in `retention.ts` silently skips deleting customer `waiverSignature` files during PDPL anonymisation.

### WF-6 & WF-7: SLA Sweeper & Retention
- `runSlaSweep()` (`src/services/slaSweeper.ts`) correctly flags open tickets past `maxSlaHours` (48h) and logs `SLA_BREACH_AUTO` (proven in Test `6.2`), though sequential loop updates up to 200 rows at a time.
- `runRetention()` (`src/services/retention.ts`) purges OTPs >24h (proven in Test `6.2`), clears bank data 90d post-closure, and anonymises tickets >730d. Missing transaction wrapper and broken `waiverSignature` deletion (`P1-01`).
