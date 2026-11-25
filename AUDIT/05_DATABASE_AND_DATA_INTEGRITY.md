# 05 — Database & Data Integrity Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Database Engine:** Supabase PostgreSQL (via Prisma `5.22.0`, `DATABASE_URL` PgBouncer `:6543`, `DIRECT_URL` `:5432`) + Read-only Local MongoDB (`127.0.0.1:27017/rushwash`).  
**Safety Note:** Zero live Supabase queries or destructive commands were executed during this audit.

---

## 1. Schema Integrity Audit (`prisma/schema.prisma`)

### 1.1 Existing Constraints & Indexes (Verified)
- Primary keys on all 9 models (`SystemConfig.id`, `StaffUser.id`, `AuditLog.id`, `Customer.id`, `WashVisit.id`, `PosOrder.id`, `OtpSession.id`, `Complaint.id`, `Message.id`).
- Unique constraints: `StaffUser.email`, `Customer(licensePlate, phone)`, `Complaint.rewashCode`.
- Foreign keys: `AuditLog -> Complaint (Cascade)` & `StaffUser`, `WashVisit -> Customer`, `PosOrder -> Customer`, `Complaint -> Customer`, `Message -> Complaint (Cascade)`.
- Indexes: `AuditLog(complaintId, createdAt)`, `Customer(phone)`, `WashVisit(customerId, washedAt)`, `PosOrder(customerId, orderedAt)`, `OtpSession(phone, licensePlate)`, `Complaint(customerId)`, `Complaint(posRecordId)`, `Message(complaintId, createdAt)`.

### 1.2 Missing Constraints & Schema Gaps (Confirmed)
| Severity | Finding | Location | Impact |
|---|---|---|---|
| **P1** | **No DB-level duplicate protection on listed complaints** | `prisma/schema.prisma:152-227` | `Complaint(customerId, posRecordId)` is non-unique (special IDs `ORD-UNLISTED`, `VISIT-GENERAL`, `VISIT-UNLISTED` allow multiple rows, so only a partial unique index `WHERE "posRecordId" NOT IN (...)` works). Without it, concurrent submissions create duplicate tickets (proven in Test `7.2`). |
| **P1** | **`Complaint.rrn` lacks `@unique` constraint** | `prisma/schema.prisma:180` | App checks `findFirst({ where: { rrn } })` (`src/routes/admin.ts:784`) without a DB unique index; concurrent approvals can attach the same RRN to two tickets. |
| **P2** | **`Message.externalId` lacks `@unique` / index** | `prisma/schema.prisma:236` | Webhook idempotency relies on `findFirst({ where: { externalId } })` causing full-table scans on `Message` and race conditions on simultaneous webhook retries. |
| **P2** | **Missing composite operational indexes** | `prisma/schema.prisma` | Missing indexes on `Complaint(status, createdAt)` (used by `slaSweeper.ts` every 15m and `/dashboard`), `Complaint(site, createdAt)` (`OPS_MANAGER` branch filter), `Complaint(payoutStatus, updatedAt)` (`/finance` & `retention.ts`), and `OtpSession(createdAt)` (6h retention purge). |
| **P2** | **`AuditLog.complaintId` is non-nullable** | `prisma/schema.prisma:86-87` | Prevents persisting non-ticket administrative audit events (`STAFF_CREATE`, `CONFIG_UPDATE`, `EXPORT_FINANCE_CSV`, `CUSTOMER_ANONYMISE`) into PostgreSQL. |
| **P2** | **`Complaint.site` & `StaffUser.branch` are plain `String`** | `prisma/schema.prisma:77, 162` | No FK or enum check enforcing canonical branch `"RUSH Al Kharj"`. |

---

## 2. Transaction Integrity & Concurrency Findings

- **Zero `prisma.$transaction()` usage** in `src/` (verified across all 18 TypeScript files).
- **TOCTOU Race Conditions (Proven in Test `7.2`)**:
  1. `POST /api/complaints` (`src/routes/complaints.ts:179-222`): Check-then-insert allows concurrent requests to bypass the duplicate-visit guard (`201` + `201`).
  2. `POST /api/admin/finance/:id/mark-paid` (`src/routes/admin.ts:1219-1255`): Check-then-update without `WHERE payoutStatus = 'PENDING_BANK_TRANSFER'` allows concurrent clicks/requests to both return `200`, record duplicate `MARK_PAID` audit logs, and send duplicate WhatsApp notifications.
  3. Same pattern affects `POST /claims/:id/billing/approve`, `POST /claims/:id/unsatisfied/approve`, `POST /claims/:id/damage/approve-quote`, and `POST /complaints/:id/damage/step2` (note: `verify-otp` *does* properly use atomic conditional `updateMany`, `src/routes/auth.ts:175-184`).
  4. `runRetention()` (`src/services/retention.ts:21-81`) deletes R2/disk files *before* updating DB rows without a transaction; if DB update fails mid-run, files are permanently lost while DB still holds dead URLs.

---

## 3. Migration Safety

- **Status: FAIL (`P1`)**
- `package.json:11` uses `prisma db push` with **zero versioned migration files** (`prisma/migrations/` directory does not exist).
- There are no tested rollback SQL scripts, no migration history validation in CI, and `prisma/enable_rls.sql` must be executed out-of-band via `tsx prisma/apply_rls.ts`.
- **Release-Blocking Seed Hazard (`P0-03`)**: `prisma/setup_e2e_clean.ts:12-14` runs `deleteMany({})` on `auditLog`, `message`, and `complaint` without `assertSafeToRunDestructive()`.

---

## 4. Backup & Recovery Verification

- **Status: `BLOCKED`**
- Supabase provides managed PostgreSQL backups, **however**:
  1. Backup schedule, retention window, encryption-at-rest verification, and IAM backup access controls are outside this repository and unverified.
  2. **No restoration test** has been documented or verified against a staging database.
  3. Local fallback uploads (`uploads/` directory) have **no backup mechanism** if Cloudflare R2 fails and writes fall back to local disk (`src/services/storage.ts:79-87`).
