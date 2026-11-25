# 08 — Frontend, UX & Browser Security Audit

**Audit Timestamp:** `2026-11-25 16:30:00 AST (Asia/Riyadh)`  
**Audited Files:**
- `public/rush_wash_customer_care.html` (2,350 lines, `147,470` bytes)
- `public/rush_admin_operations_console.html` (3,088 lines, `183,495` bytes)
- `src/server.ts` (Helmet CSP & static serving)

---

## 1. Browser Security & Header Audit

| Control | Evidence | Verdict | Finding |
|---|---|---|---|
| **Static Root Isolation** | `src/server.ts:121-122`, `tests/security.test.ts` | **PASS** | Only `public/` is served (`dotfiles: "deny"`, `index: false`). `.env`, `package.json`, `src/`, `prisma/` return `404`. |
| **Clickjacking Protection** | `frame-ancestors 'none'` (`src/server.ts:49`) | **PASS** | Prevents framing of Customer & Admin consoles. |
| **Content Security Policy (CSP)** | `src/server.ts:35-54` | **WARN (`P2`)** | Uses `'unsafe-inline'` in `script-src` and `script-src-attr` because both SPAs use inline `<script>` blocks and `onclick="..."` handlers. This weakens XSS defense-in-depth if any DOM sink is ever missed. |
| **External CDN Scripts & SRI** | `audit_static_and_deps.py` scan | **FAIL (`P2`)** | Customer portal loads 2 external scripts (`cdn.tailwindcss.com/3.4.17`, `unpkg.com/lucide@0.460.0`) and Admin loads 3 (+ `chart.js@4.4.1`) with **0 Subresource Integrity (`integrity=`) attributes** and uses Tailwind Play CDN (JIT runtime compiler) in production. |
| **XSS Escaping** | `esc()` (`& < > " '`), `safeUrl()` | **PASS** | Verified across all 23 `innerHTML` assignments in Customer Portal and 22 in Admin Console; all server/user strings are passed through `esc()` and URLs through `safeUrl()`. |
| **Demo Creds / Helpers** | `tests/security.test.ts:19-27` | **PASS** | Demo quick-fill helpers and hardcoded admin passwords were already removed. |
| **Browser Storage** | `localStorage`: `rush_portal_lang`; `sessionStorage`: `rush_track_query`, `rush_staff_token`, `rush_staff_user` | **PASS / WARN** | Staff JWT in `sessionStorage` (cleared on tab close & `handleLogout()`). Customer `trackToken` and `token` stay in JS memory (`appState`), **BUT `tickets[]` leaks across users in same tab (`P2-03`)**. |

---

## 2. UX, Accessibility & Functional Defect Findings

### Confirmed Frontend Bugs
1. **Shared-Browser Memory Leak (`P2-03`)**:
   - `public/rush_wash_customer_care.html:309`: `let tickets = [];` is never cleared in `resetFileFlow()` (`line 1558`) or `clearTrackSession()` (`line 1681`). On a shared kiosk/tablet, User A's tickets remain in memory and can be surfaced via `tickets.find(...)` / `tickets.filter(...)` fallback (`line 1660`).
2. **Broken Customer Quotation Amount Flow (`P1`)**:
   - `public/rush_wash_customer_care.html:2179`: `signWaiver()` submits `{ quotationUrl, waiverSignature }` **without `quotedAmount`**. Consequently, `complaint.quotedAmount` remains `null`, blocking `CSM`/`FINANCE`/`ADMIN` from approving quotations in the Admin Console (`rush_admin_operations_console.html:2435` sends `{}` for non-owners, triggering `409 A positive quoted amount is required`).
3. **Missing `"Other"` Filter & Chart Slice in Admin Console (`P2`)**:
   - `public/rush_admin_operations_console.html:321-326`: `<select id="filter-type">` lists only `All Types`, `Unsatisfied`, `Billing / Refund`, `Damage` — staff cannot filter by `Other`.
   - `public/rush_admin_operations_console.html:1047-1053`: `charts.types` doughnut chart omits `Other` tickets completely (`byType.other` from API is ignored).
4. **Missing Double-Click Protection on Financial/Admin Buttons (`P2`)**:
   - Customer Portal properly disables buttons with spinners (`setBtnLoading`).
   - Admin Console buttons `issueRewash()`, `saveBillingRrn()`, `approveQuotation()`, `handoffToCsm()`, `requestDamageQuote()`, `saveResolutionNote()`, `saveInspectionFields()`, `saveFinanceInvoiceDetails()`, and `submitStaffSignature()` **do not disable buttons during in-flight `fetch()`**, allowing accidental double-clicks.
5. **Accessibility & Keyboard Traps (`P3`)**:
   - Escape key listener (`rush_admin_operations_console.html:778-785`) handles 4 modals (`modal-add-staff`, `modal-mark-paid`, `modal-refuse`, `modal-staff-toggle`) **but omits `modal-staff-sign` and `modal-print-form`**, trapping keyboard-only users inside those modals.
   - `Passenger Side & Mirror` SVG element in `rush_wash_customer_care.html:1227` has a typo in class interpolation (`? 'true' : ''` instead of `? 'selected' : ''`), so pre-selected Passenger Side damage zones fail to highlight in red on re-render!
6. **Bilingual & Brand Standards (`PASS`)**:
   - Verified `has_rush_arabic_brand: true`, `has_rosh_typo: false` across both HTML SPAs (`رش واش` used consistently; zero instances of `روش`).
   - Verified 44px minimum touch targets (`min-h-[44px]`), `Asia/Riyadh` timezone formatting, RTL/LTR switching (`dir="rtl"` / `dir="ltr"`), and single-branch `RUSH Al Kharj` alignment.
