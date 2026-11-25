# 09 — Performance & Scalability Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Scope:** API latency, database query patterns, connection pooling, memory consumption, frontend payload size, caching, and background job efficiency.

---

## 1. Controlled Benchmark Results (In-Memory Express)

Executed in `tests/enterprise_audit.test.ts` (`Test 9.1`, `NODE_ENV=test`, 50 concurrent Supertest GET requests split across `/api/admin/claims` and `/api/admin/dashboard` with in-memory Prisma):
- **Total Burst Duration (`n = 50`):** `86.3 ms`
- **Median Latency (`p50`):** `72.9 ms`
- **95th Percentile Latency (`p95`):** `85.3 ms`
- **Maximum Latency (`max`):** `85.8 ms`
- **Heap Delta:** `+9,609.7 KB` (`~9.4 MB` transient allocation for 50 requests)
- **Status Codes:** `50/50` HTTP `200`

> **Benchmark Boundary Caveat:** This benchmark measures Express + Zod + serialization + in-memory cache overhead only. Live cross-continental Supabase/PgBouncer network latency (e.g., Tokyo/AWS pooler round-trips referenced in `src/routes/admin.ts:83`) was **not** tested (`BLOCKED` per Rule 1).

---

## 2. Scalability & Query Bottlenecks Identified

| ID | Bottleneck | File / Line | Risk Under Production Growth |
|---|---|---|---|
| **PERF-01 (`P2-04`)** | **Unbounded `findMany` + Full Relations on `/dashboard` and `/claims`** | `src/routes/admin.ts:347-354, 487-495` | `GET /api/admin/dashboard` and `GET /api/admin/claims` execute `prisma.complaint.findMany` with **no `take`/pagination** and eagerly `include: { customer, messages, auditLogs }` for **every ticket in history**, then compute KPIs and `signFileUrl()` in Node memory. At 5,000+ tickets with 10+ messages/ticket, responses will exceed multiple MBs and cause memory spikes/timeouts. |
| **PERF-02 (`P2`)** | **Unbounded `GET /api/admin/finance` (`take: 1000`) & `/export.csv` (`take: 10000`)** | `src/routes/admin.ts:1121-1132, 1261-1284` | `/export.csv` buffers all 10,000 rows + decrypts every `accountHolder` & `iban` synchronously in Node memory via `rows.join("\r\n")` instead of streaming. |
| **PERF-03 (`P2`)** | **Frontend Tailwind Play CDN Runtime Compiler** | `public/rush_wash_customer_care.html:8`, `public/rush_admin_operations_console.html:7` | Both SPAs load `cdn.tailwindcss.com/3.4.17` (~400 KB uncached JS) to parse CSS at runtime in mobile browsers instead of shipping compiled CSS, degrading mobile FCP/LCP and failing if CDN is blocked. |
| **PERF-04 (`P2`)** | **Missing Composite Indexes (`prisma/schema.prisma`)** | `prisma/schema.prisma:152-240` | Missing indexes on `Complaint(status, createdAt)`, `Complaint(site, createdAt)`, `Message(externalId)`, and `OtpSession(createdAt)` will cause sequential scans as tables grow. |
| **PERF-05 (`P2`)** | **Sequential Update Loop in `slaSweeper.ts`** | `src/services/slaSweeper.ts:19-35` | Loops over up to 200 overdue tickets issuing individual sequential `prisma.complaint.update` round-trips instead of batched `updateMany` + `auditLog.createMany`. |
| **PERF-06 (`P2`)** | **Single-Instance In-Memory State** | `src/middleware/security.ts`, `src/routes/admin.ts:74, 89` | `express-rate-limit` uses default `MemoryStore`, `claimsCache` (max 50 keys, 10s TTL) and `staffCache` (15s TTL) are process-local. Scaling beyond 1 Node instance fragments rate limits and caches. |
| **PERF-07 (`P2`)** | **MongoDB Regex Fallback Without Index Guarantee** | `src/services/mongo.ts:62-63, 84` | Case-insensitive anchored regex (`^...$` / `...$`) on `rushwash_customers` and `rushwash_vehicles` may scan collections if local Mongo lacks matching indexes. |
| **PERF-08 (`P3`)** | **Duplicate `/claims` Fetch vs. Unused `/dashboard` Endpoint** | `public/rush_admin_operations_console.html:1861-1867` | Admin UI fetches the entire `/api/admin/claims` list on login and computes dashboard charts client-side (`renderDashboard()`), never calling `GET /api/admin/dashboard`. |

---

## 3. Infrastructure Targets (Baseline Recommendation)
- **Target API Latency (Single Instance + PgBouncer):** `< 300 ms` p95 for `/api/auth/*` and `/api/customer/history`; `< 500 ms` p95 for paginated `/api/admin/claims?limit=50`.
- **Target Database Pool:** Configure `connection_limit` explicitly on `DATABASE_URL` when using Supabase PgBouncer transaction mode (`?pgbouncer=true&connection_limit=10`) to prevent pool exhaustion across concurrent requests and background jobs.
