# 07 — Payment & Financial Integrity Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Scope:** Financial operations within RUSH Customer Care Portal: Damage compensation disbursements (bank IBAN transfers), Billing/Refund RRN approvals, and Rewash voucher issuance. *(Note: This portal does not process direct card payments or payment gateway webhooks; it issues monetary refunds/payouts and stores sensitive customer IBANs).*

---

## 1. Financial Controls Verification Matrix

| Control | Expected Standard | Implementation & Evidence | Verdict |
|---|---|---|---|
| **Server-side Amount / Ceiling Calculation** | Payouts/refunds capped against verified server order or approved quote | Listed orders checked against `posOrder.amountSar` or MongoDB paid order (`admin.ts:764-776`, Test `7.1`); **HOWEVER** `ORD-UNLISTED` uses unverified client-supplied `requestedAmount` up to **SAR 100,000** (`complaints.ts:121`, `admin.ts:769-773`)! | **FAIL (`P1-03`)** |
| **Customer & Transaction Ownership** | Only verified OTP-authenticated owner can submit/modify payout IBAN | Broken by **P0-01**: `/api/complaints/track` issues `trackToken` without OTP, allowing IBAN takeover on `step2` (proven in Test `2.2`). | **FAIL (`P0-01`)** |
| **Currency Validation** | SAR enforced consistently | Implicit SAR across all fields (`amountSar`, `requestedAmount`, `quotedAmount`, `approvedAmount`, `damageApprovalCapSar`). No multi-currency field exists. | **PASS** |
| **IBAN Validation & Encryption at Rest** | Saudi IBAN format + ISO 7064 mod-97 + strong encryption | `isValidSaIban()` (`complaints.ts:19-26`) + AES-256-GCM (`crypto.ts:8-37`) with 32-byte `FIELD_ENCRYPTION_KEY`; masked in list/detail responses; full IBAN reveal rate-limited (`30/15m`) & audit-logged. | **PASS** (note: single static key version `enc:v1:`) |
| **Idempotency & Duplicate Prevention** | Concurrent payout/refund requests cannot execute twice | **No idempotency keys, no DB locks, no `$transaction`**. Concurrent `mark-paid` executes twice under async DB latency (proven in Test `7.2`). `rrn` lacks DB `@unique` constraint. | **FAIL (TOCTOU)** |
| **Quote-to-Invoice Reconciliation (`P1-03`)** | Final bank transfer must match verified tax invoice (`invoiceTotalSar`) | `mark-paid` (`admin.ts:1224`) computes `amount = Number(complaint.approvedAmount || complaint.quotedAmount || 0)` and **completely ignores `invoiceTotalSar`**. Test `7.1` proved `mark-paid` disburses SAR 500 even when Finance logged `invoiceTotalSar = 300`. | **FAIL (`P1-03`)** |
| **Segregation of Duties** | Approver of quote/refund should not unilaterally execute disbursement | `FINANCE` role can both `approve-quote` (<= SAR 200) and `mark-paid`; `ADMIN` and `BUSINESS_OWNER` can perform every step from ticket triage to `mark-paid` / `billing/approve` without dual-control. | **WARN (`P1-03`)** |
| **Reconciliation & Audit Trail** | Financial totals reconcile cleanly with ledger & Wafeq | `GET /api/admin/dashboard` sums `approvedAmount` (`admin.ts:373`), whereas `GET /api/admin/finance` displays `approvedAmount || requestedAmount || quotedAmount` (`line 1140`), causing dashboard vs. finance ledger figures to diverge on pending claims! | **WARN (`P2`)** |

---

## 2. Detailed Financial Vulnerability Breakdown

### P0-01: Unauthenticated-OTP IBAN Takeover (`step2`)
- **Attack Path (Reproduced in Test `2.2`)**:
  1. Attacker probes sequential `C-1043+` IDs with target customer's phone on `POST /api/complaints/track`.
  2. Server returns `trackToken` + full ticket status (`payoutStatus: AWAITING_INVOICE_IBAN`).
  3. Attacker calls `POST /api/complaints/:id/damage/step2` with attacker's Saudi IBAN and dummy tax invoice PDF.
  4. Write-once guard (`src/routes/complaints.ts:437`) permanently locks out the legitimate customer (`409`) and queues payout to the attacker's IBAN.

### P1-03: Uncapped `ORD-UNLISTED` Refunds & Unreconciled Damage Disbursements
- **Attack/Error Path 1 (Reproduced in Test `7.1`)**:
  - Customer submits `ORD-UNLISTED` billing dispute with `requestedAmount: 50000`.
  - Any `ADMIN` staffer can approve `SAR 50,000` via `POST /api/admin/claims/:id/billing/approve` with **no `damageApprovalCapSar`-style owner approval gate** and **no mandatory verification of `bankSmsUrl`/`bankSmsText` integrity**.
- **Attack/Error Path 2 (Reproduced in Test `7.1`)**:
  - `POST /api/admin/finance/:id/mark-paid` does not require `wafeqJournalNo`, `invoiceNumber`, `invoiceTotalSar`, or `financeSignatureUrl` before closing the ticket as `PAID`, and pays `quotedAmount` even if the final workshop invoice was lower.

### P2: Dashboard vs. Finance Ledger & Frontend Amount Discrepancies
- In `src/routes/admin.ts:373`, `dashboard` KPI `totalPayoutsSar` sums `approvedAmount` (which includes `REFUSED`? No, refused tickets leave `approvedAmount` null, so `0`), **but** `finance` (`line 1140`) and `export.csv` (`line 1275`) use `approvedAmount || requestedAmount || quotedAmount`, showing unapproved `requestedAmount` values in the financial ledger alongside paid amounts without clearly separating "Requested" vs "Approved/Paid" columns.
- In `public/rush_admin_operations_console.html:2435`, non-owner UI submits `{}` to `/damage/approve-quote`, which relies on `complaint.quotedAmount` in DB — however, when a customer uploads a quotation via `/damage/upload-doc` or `/damage/step1` in the customer UI (`public/rush_wash_customer_care.html:2179`), **the customer UI never sends `quotedAmount`**, so `complaint.quotedAmount` stays `null`/`0`! Non-owner (`CSM`, `FINANCE`, `ADMIN`) clicking "Approve Quote" in the UI then fails with `409 ("A positive quoted amount is required before approval")` because non-owners are blocked from sending `quotedAmount`!
