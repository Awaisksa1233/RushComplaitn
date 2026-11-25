# 13 — Automated Testing & Regression Results

**Audit Timestamp (Post-Phase 16 Verification):** `2026-11-25 16:48:32 AST (Asia/Riyadh)`  
**Test Runner:** `vitest@2.1.9` + `supertest@7.0.0` (`vitest.config.ts` excludes `**/backups/**`, `**/node_modules/**`, `**/dist/**`)  
**Execution Environment:** Offline isolated in-memory (`NODE_ENV=test`, `ENABLE_LOCAL_MONGO=false`, `DISABLE_OUTBOUND_MESSAGING=true`, `InMemoryPrismaClient` harness backed by real `createApp(memPrisma)`, zero external DB/network calls).

---

## 1. Executed Test Suite Results (Post-Remediation)

Command executed after all Phase 16 fixes:
```powershell
npm run build && npx vitest run tests/security.test.ts tests/enterprise_audit.test.ts
```

| Check / Test File | Tests Executed | Passed | Failed | Skipped | Duration | Scope |
|---|---:|---:|---:|---:|---:|---|
| `npm run build` (`tsc`) | — | PASS | 0 | 0 | — | Full TypeScript build exited with code `0` (`dist/` emitted cleanly) |
| `tests/security.test.ts` | 14 | 14 | 0 | 0 | `579 ms` | Static serving, CSP, auth gates, forged JWTs, webhook gates, file proxy auth/traversal, IBAN mod-97, AES-256-GCM crypto |
| `tests/enterprise_audit.test.ts` | 13 | 13 | 0 | 0 | `6,252 ms` | Cross-user isolation (`Awais` + User B/C), branch scoping, 5-role RBAC, `REM-001`–`REM-018` regression guards, financial ceilings, concurrency locks, signatures, SLA/retention, 50-req latency benchmark |
| **Total Vitest Executed** | **27** | **27** | **0** | **0** | **8.41 s** | **100% isolated offline pass** |

### Key Verified Regression Cases (`tests/enterprise_audit.test.ts`)
- **`2.1` Ownership & Non-Sequential IDs:** Cross-customer access on `/api/customer/history` and `/api/complaints/:id/*` blocked (`404`); listed ticket IDs use CSPRNG 8-digit `C-xxxxxxxx` format.
- **`2.2` `[REM-001]` Unauthenticated `/track` Protection:** `POST /api/complaints/track` returns `limited: true` without `trackToken` or private messages/IBAN/waiver fields unless a verified `CUSTOMER_JWT` is presented.
- **`2.3` `[REM-002]` File Proxy & Upload Auth:** Cross-customer download on `/api/files/:key` blocked (`403`/`404`); deactivated staff JWTs blocked (`401`/`403`) on `/api/files/:key` and `/api/upload` via `verifyActiveStaffJwt`.
- **`3.2` `[REM-005 & REM-014]` RBAC & Persistent Audit Logs:** `FINANCE` blocked (`403`) on `POST /claims/:id/messages`; non-ticket security events (`CONFIG_UPDATE`, `RBAC_DENIED`, `EXPORT_FINANCE_CSV`) persisted to DB `AuditLog` with nullable `complaintId`.
- **`4.2` `[REM-010 & REM-011]` Phone & Chatwoot Hardening:** Foreign `+44` phone prefixes rejected instead of suffix-colliding with Saudi `5xxxxxxxx`; Chatwoot `?token=` query auth rejected; phone-less `C-\d+` body-regex hijack blocked.
- **`6.1` `[REM-004]` Digital Signatures & PDPL Erasure:** Uploaded digital signature keys (`signatures/*`) serve `200` with authorized token and delete cleanly (`404` post-erasure) on `/anonymise`.
- **`6.2` `[REM-003, 008, 012, 013, 017]` Workflow, Pagination & Static Guards:** Verified pagination (`X-Total-Count` on `/claims`), bounded `/dashboard` query, `E2E_DEMO_MODE` prod block, `assertSafeToRunDestructive()` in E2E seed scripts, and frontend isolation/lock controls.
- **`7.1` & `7.2` `[REM-006 & REM-007]` Financial Caps & Concurrency (TOCTOU):** `ORD-UNLISTED` refunds capped at `damageApprovalCapSar` for non-owners; `mark-paid` capped at `min(quotedAmount, invoiceTotalSar)`; concurrent duplicate complaint and concurrent `mark-paid` requests serialized/blocked cleanly.
- **`9.1` In-Process Concurrency Benchmark (`n = 50`):** `totalMs=141.9`, `p50=122.2ms`, `p95=128.5ms`, `max=139.4ms`, `heapDeltaKB=-7377.0`.

---

## 2. Integration Test Suites Not Executed Offline (`BLOCKED` per Rule 1)

Per strict Rule 1 (no unapproved connection to `.env`'s live Supabase database), `tests/portal.test.ts` and `tests/admin.test.ts` were **NOT executed** against live PostgreSQL. During Phase 16 (`REM-016`), both suites were updated to:
1. Enforce a safety guard skipping execution unless targeting a localhost database or explicitly opted in via `ALLOW_LIVE_DB_TESTS=true`.
2. Fix `tests/portal.test.ts` missing `mediaUrls` on `DAMAGE` claim creation.
3. Fix `tests/admin.test.ts` `/api/admin/auth/login` path, expected `200` status code on staff creation, and Rule 14 authorized test phone `569809578`.

---

## 3. Clean Workspace Verification
- `uploads/` directory verified empty (`0` leftover test files) after the final Vitest run.
