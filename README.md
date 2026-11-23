# RUSH Car Wash — Customer Care & Complaints Portal
### رش واش — منصة خدمة العملاء وإدارة البلاغات ومطالبات التعويض

A dedicated, full-stack customer service and complaints settlement platform built for **RUSH Car Wash (`رش واش`)** (Al Kharj branch).

---

## 🌟 Features

### 1. Customer Care Portal (`public/rush_wash_customer_care.html`)
- **100% Bilingual Support**: Real-time switching between Arabic (`ar` / RTL) and English (`en` / LTR).
- **Plate & Mobile Verification**: SMS OTP verification linked with vehicle plate numbers.
- **Auto-Restoring Session**: Persists active tracking sessions in `localStorage` and query parameters (`?ticket=...&phone=...`) across page reloads.
- **Complaint Types**:
  - **Wash Quality (Unsatisfied)**: Automated rewash voucher QR generation upon approval.
  - **Billing & Refunds**: Transaction dispute tracking with Retrieval Reference Number (RRN).
  - **Damage Claims (2-Step Settlement)**:
    - **Step 1**: Official repair quotation upload + Interactive electronic liability waiver signing canvas.
    - **Step 2**: Verified company tax details box (`شركة عمليات رش واش` · VAT `310482917400003` · CR `1010684920`), tax invoice upload, IBAN & bank account submission, confirmed card summary, and payout settlement status.
  - **General Feedback & Inquiries**: Categorized feedback routing.
- **WhatsApp Synchronization**: Real-time message history and instant customer support chat reply.
- **CSAT Rating**: 5-star resolution satisfaction rating.

### 2. Admin Operations Console (`public/rush_admin_operations_console.html`)
- **Al Kharj Single-Branch Operations**: Consolidated claims management strictly for the Al Kharj branch.
- **Claims Triage & Investigation**: Status management (`Submitted`, `Investigating`, `Pending Payout`, `Resolved`, `Closed`).
- **Quotation & Settlement Workflow**: Management approval/rejection for repair quotations and finance verification of tax invoices and IBAN transfers.
- **Performance Optimized**: Sub-second data loading with parallelized queries, Prisma connection pooling, and in-memory TTL caching.
- **Secure Authentication**: JWT token-based authentication with role-based access control.

### 3. Architecture & Cloud Storage
- **Backend API**: Node.js & TypeScript with Express.
- **Database**: Supabase PostgreSQL managed via Prisma ORM (`prisma/schema.prisma`).
- **Object Storage**: Cloudflare R2 S3-compatible bucket for photos, videos, repair quotations, and tax invoices.
- **Real-Time Cache Busting**: Strict `no-cache, no-store, must-revalidate` HTTP headers ensuring customers and cashiers always view real-time settlement states.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
Copy the `.env.example` file to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

Key variables required:
- `DATABASE_URL`: Supabase PostgreSQL connection pooler URI (`?pgbouncer=true`).
- `DIRECT_URL`: Supabase direct PostgreSQL connection URI.
- `JWT_SECRET`: **required** (≥32 chars). Customer and staff tokens use independently derived keys. The server will not start without it.
- `FIELD_ENCRYPTION_KEY`: **required in production**. 32-byte key encrypting IBAN / account-holder at rest.
- `WHATSAPP_WEBHOOK_SECRET`: HMAC secret for the inbound WhatsApp webhook (webhook is disabled without it).
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`: Cloudflare R2 credentials.

### 3. Database Migration & Prisma Generation
```bash
npx prisma generate
```

### 4. Build TypeScript
```bash
npm run build
```

### 5. Run Locally
```bash
# Development mode with hot-reload
npm run dev

# Or start the compiled production server
npm start
```
The server will start on `http://localhost:4000` (or the configured `PORT`).
- Customer Portal: `http://localhost:4000/`
- Admin Operations Console: `http://localhost:4000/admin`

---

## 📂 Project Structure

```
Customer Portal/
├── .env.example                     # Sanitized configuration template
├── .gitignore                       # Git exclusions (secrets, node_modules, dist)
├── package.json                     # Dependencies & scripts
├── tsconfig.json                    # TypeScript compiler config
├── README.md                        # Documentation
├── rush_wash_customer_care.html     # Bilingual Public Customer Portal
├── rush_admin_operations_console.html # Al Kharj Admin Operations Console
├── prisma/
│   └── schema.prisma                # PostgreSQL models & enums
└── src/
    ├── server.ts                    # Express app entry & middleware
    ├── lib/
    │   ├── prisma.ts                # Prisma database client
    │   └── r2.ts                    # Cloudflare R2 storage client
    ├── middleware/
    │   └── auth.ts                  # Admin JWT verification
    └── routes/
        ├── admin.ts                 # Admin claims triage & approvals
        ├── complaints.ts            # Public complaint & tracking API
        └── upload.ts                # Cloudflare R2 streaming upload API
```

---

## 🔒 Security & Privacy

- Secret keys, database credentials, and production environment variables are never committed.
- Public customer queries require both ticket ID (or plate) and verified mobile number.
- Admin routes are gated with authenticated JWT tokens.

---

## 📄 License
Internal proprietary software for **RUSH Car Wash Operations Co. (شركة عمليات رش واش)**.


---

## 🔒 Security & Data Handling

- **Auth**: customer OTP is 6 digits (CSPRNG, HMAC-hashed, 5-minute TTL, cumulative lockout + rate limits). Every customer mutation (`/damage/*`, `/whatsapp`, `/csat`, uploads) needs a bearer token **and** ownership of that ticket. Staff use separate keys, 8 h tokens, bcrypt(12), login rate-limit, and mandatory strong passwords (no default password).
- **RBAC**: each admin action is role-gated and branch-scoped; payouts follow a state machine (quote → approve → invoice+IBAN → transfer → paid); the SAR approval cap is checked against the stored quotation amount; only the Business Owner can create/modify Admin/Owner accounts.
- **Files**: only `public/` is served. Uploads are type-allow-listed + magic-byte checked, stored under random keys, served `nosniff`/sandboxed/`no-store`.
- **Privacy / retention** (`src/services/retention.ts`, runs every 6 h): OTP rows purged after 24 h; bank details cleared 90 days after closure; resolved tickets anonymised after 24 months. Owner-only data-subject endpoints: `GET /api/admin/customers/:id/export`, `POST /api/admin/customers/:id/anonymise`. Tunable via `RETENTION_*`.
- **Destructive seed scripts** require `ALLOW_DESTRUCTIVE_SEED=yes` **and** `CONFIRM_DB_HOST=<host>` and refuse to run in production.
- Run `npm test` — `tests/security.test.ts` needs no database.
