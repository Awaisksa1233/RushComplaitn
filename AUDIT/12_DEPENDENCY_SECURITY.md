# 12 — Dependencies & Supply Chain Security Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Scanner Executed:** `npm audit --json` via `scripts/audit_static_and_deps.py` against `package-lock.json` (`309` total resolved packages: `143` prod, `166` dev, `76` optional).

---

## 1. Direct Dependencies Inventory (`package.json`)

### Production Dependencies (13)
`@aws-sdk/client-s3@^3.758.0`, `@aws-sdk/s3-request-presigner@^3.758.0`, `@prisma/client@^5.22.0`, `bcryptjs@^3.0.3`, `cors@^2.8.5`, `dotenv@^16.4.7`, `express@^4.21.2`, `express-rate-limit@^8.7.5`, `helmet@^8.3.0`, `jsonwebtoken@^9.0.2`, `mongodb@^7.9.1`, `multer@^2.5.0`, `zod@^3.24.2`.
- **Unused Package Check:** `@aws-sdk/s3-request-presigner` is declared in `package.json:26` **but never imported anywhere in `src/`** (custom HMAC `/api/files/:key?exp=&sig=` is used instead).

### Development Dependencies (13)
`@types/bcryptjs`, `@types/cors`, `@types/express`, `@types/jsonwebtoken`, `@types/multer`, `@types/node`, `@types/supertest`, `prisma@^5.22.0`, `supertest@^7.0.0`, `tsx@^4.19.3`, `typescript@^5.7.3`, `vitest@^2.1.8`.

---

## 2. Known CVE & Advisory Findings (`npm audit`)

Total reported vulnerabilities: **7** (**2 Critical**, **2 High**, **3 Moderate**).

| Package | Scope | Severity | Installed Range | Advisory IDs | Description & Controlled Remediation |
|---|---|---|---|---|---|
| **`zod`** (`^3.24.2`) | **Runtime (Prod)** | **HIGH** | `<4.6.6` | `GHSA-mrhx-c7xc-m3w5` | Memory exhaustion DoS when validating oversized constrained collections. **Mitigation in code:** All array fields in routes have explicit `.max(10..20)` and Express JSON body limit is `1mb`. **Controlled Upgrade:** Upgrading to `zod@4.x` is a breaking major change; validate all `.safeParse()`, `.flatten()`, `.strict()`, and `.nativeEnum()` calls with full test suite before upgrading. |
| **`tinypool`** | Dev/Test (via `vitest`) | **CRITICAL** | `<=2.1.1` | `GHSA-5gmw-xhrv-c9v3`, `GHSA-85c8-ppgw-ccpr` | Prototype pollution to RCE in worker/run options. Not shipped in production runtime (`npm ci --omit=dev`). Upgrade `vitest` carefully in a controlled dev branch. |
| **`vitest`** (`^2.1.8`) | Dev/Test | **CRITICAL** | `<=4.1.10` | `GHSA-5xrq-8626-4rwp`, `GHSA-82fw-gwwq-j7x9` | Arbitrary file read / path traversal via UI server or `@vitest/mocker`. Dev-only; never run Vitest UI on untrusted networks. |
| **`@vitest/mocker`** | Dev/Test | **MODERATE** | `<=4.1.11` | `GHSA-82fw-gwwq-j7x9`, `GHSA-qxg6-89mg-rqv8` | Path traversal & manual mock injection in Vitest. Dev-only. |
| **`vite`** | Dev/Test (via `vitest`) | **HIGH** | `<=6.4.3` | `GHSA-587h-7wmj-h5pm`, `GHSA-4w7w-66w2-5vf9`, +6 advisories | `launch-editor` Windows path checks & dev server traversal. Dev-only. |
| **`esbuild`** | Dev/Test (via `vite`) | **MODERATE** | `<=0.24.2` | `GHSA-67mh-4wv8-2f99` | Dev server cross-origin read. Dev-only. |
| **`vite-node`** | Dev/Test (via `vitest`) | **MODERATE** | `<=2.2.0-beta.2` | Transitive via `vite` | Dev-only. |

---

## 3. Third-Party Browser CDN Supply Chain (`public/*.html`)

Both single-file HTML SPAs load runtime scripts directly from public CDNs **without Subresource Integrity (`integrity="sha384-..."`) hashes**:
- `https://cdn.tailwindcss.com/3.4.17` (Customer + Admin)
- `https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js` (Customer + Admin)
- `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js` (Admin)

**Risk:** Compromise of an external CDN or upstream package tag executes arbitrary JavaScript with full access to `sessionStorage.getItem("rush_staff_token")` and `appState.token`. Vendor these assets locally in `public/vendor/` or add `integrity` + `crossorigin="anonymous"`.
