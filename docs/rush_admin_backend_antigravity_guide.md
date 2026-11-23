# RUSH رش Car Wash — Admin, RBAC & Finance Backend Guide for Antigravity

Use this guide in **Antigravity** to extend your backend with full **Admin, RBAC, 48-Hour SLA Escalation, SAR 200 Configurable Approval Cap, Multi-Branch Scoping, Finance Disbursement, and Audit Logging** for `rush_admin_console.html`.

---

## 1. Copy-Paste Antigravity Master Prompt (Admin & Operations)

```text
Extend the existing RUSH Car Wash Node.js + TypeScript + Express + Prisma (PostgreSQL) backend to power the Admin & Operations Console (`rush_admin_console.html`).

### Core Admin, RBAC & Business Rules
1. **Staff Authentication & RBAC Middleware (`POST /api/admin/auth/login`, `requireStaffRole`)**
   - Authenticate `StaffUser` records by email/phone + password (bcrypt) or staff OTP and issue a `staff_session` JWT containing `{ staffId, name, role, branch, active }`.
   - Reject paused users (`active === false`) with `403`.
   - Roles: `BUSINESS_OWNER`, `ADMIN`, `OPS_MANAGER`, `CSM`.
   - **Branch Scoping:** `OPS_MANAGER` can only read/mutate tickets where `ticket.branch === staff.branch`. `BUSINESS_OWNER`, `ADMIN`, and `CSM` have access across all branches.
   - Always return and record staff **names** (e.g., `Muhammad Awais`, `Sara Al-Qahtani`, `Faisal Al-Harbi`, `Omar Al-Dosari`) in assignments, messages, workload metrics, and audit logs.

2. **Configurable System Policy (`GET /api/admin/config`, `PATCH /api/admin/config`)**
   - Store a singleton `SystemConfig` row in PostgreSQL:
     - `damageApprovalCapSar` (default `200.00`)
     - `maxSlaHours` (default `48`)
     - `vatNumber` (default `"310482917400003"`)
     - `crNumber` (default `"1010684920"`)
   - Only `BUSINESS_OWNER` can update `SystemConfig` via `PATCH /api/admin/config`.

3. **Executive Dashboard & 48-Hour SLA Escalations (`GET /api/admin/dashboard`)**
   - Respect branch scoping for `OPS_MANAGER` and optional `?branch=` filter for multi-branch roles.
   - Return KPIs: `openCount`, `slaCompliancePct`, `breachedCount` (`status !== 'RESOLVED'` and age > `maxSlaHours`), `ownerApprovalsNeeded` (`type === 'DAMAGE'`, `quotedAmount > damageApprovalCapSar`, `!quotationApproved`), `totalPayoutsSar`, and `avgCsat`.
   - Return `escalations[]` (tickets breaching 48h SLA, Damage quotes exceeding the configurable SAR cap, or `PENDING_BANK_TRANSFER` items).
   - Return chart aggregations: `byType`, `byBranch` (Open vs. Resolved), and `workloadByStaffName`.

4. **Claims Queue, Handoffs & Resolution Actions (`/api/admin/claims`)**
   - `GET /api/admin/claims`: Filter by `branch`, `status`, `type`, `myQueue=true`, `overdueOnly=true` (> `maxSlaHours`), and search (`id`, `plate`, `phone`, `customerName`).
   - `POST /api/admin/claims/:id/handoff-csm`: Allowed for `OPS_MANAGER` (own branch) and `BUSINESS_OWNER`. Moves Damage claim Stage 1 -> Stage 2 (`assignedRole: "CSM"`, assigns branch/default CSM `StaffUser`, logs `AuditLog`).
   - `POST /api/admin/claims/:id/nudge`: Logs an overdue SLA escalation reminder in `Message` (`channel: "INTERNAL"`) and `AuditLog`, and optionally triggers an internal WhatsApp/email alert to the assigned staff member.
   - `POST /api/admin/claims/:id/unsatisfied/approve`: Allowed for `ADMIN` or `BUSINESS_OWNER`. Generates unique `RW-xxxx` `rewashCode`, marks `RESOLVED`, sends WhatsApp message to customer.
   - `POST /api/admin/claims/:id/billing/approve`: Allowed for `ADMIN` or `BUSINESS_OWNER`. Requires `rrn`, updates `approvedAmount`, sets `payoutStatus: "PAID_RRN"`, marks `RESOLVED`, sends WhatsApp message.
   - `POST /api/admin/claims/:id/refuse`: Requires `resolutionNote`. Sets `resolutionStatus: "REFUSED"`, `status: "RESOLVED"`, `payoutStatus: "DECLINED"`.
   - `POST /api/admin/claims/:id/damage/approve-quote`: **Enforce SAR Cap:** If `quotedAmount > SystemConfig.damageApprovalCapSar`, reject with `403` unless `req.staff.role === "BUSINESS_OWNER"`. Sets `quotationApproved: true`, `payoutStatus: "AWAITING_INVOICE_IBAN"`, unlocks customer Step 2.

5. **Finance & Bank Transfer Disbursement (`/api/admin/finance`)**
   - `GET /api/admin/finance`: Lists all claims with payout/refund/rewash status, IBAN, bank name, account holder, RRN, and `transferRef`.
   - `POST /api/admin/finance/:id/mark-paid`: Allowed for `BUSINESS_OWNER`, `ADMIN`, or `CSM` (when `<= cap`). Requires `transferRef` (e.g., `TRF-994012`). Sets `payoutStatus: "PAID"`, `status: "RESOLVED"`, records `AuditLog`, and notifies customer on WhatsApp.
   - `GET /api/admin/finance/export.csv`: Streams RFC-4180 CSV with staff names, SLA hours, SAR amounts, IBAN/RRN/Rewash references.

6. **Staff Directory Management (`/api/admin/staff`)**
   - `GET /api/admin/staff`, `POST /api/admin/staff`, `PATCH /api/admin/staff/:id` (update role, branch, or toggle `active` pause/resume). Restricted to `BUSINESS_OWNER` and `ADMIN`.

7. **48-Hour SLA Background Sweeper**
   - Add a cron/interval worker (every 15 minutes) that checks open tickets with `ageHours > SystemConfig.maxSlaHours` and `slaBreachedNotified === false`, flags `slaBreached: true`, writes an `AuditLog` entry, and notifies `BUSINESS_OWNER`.
```

---

## 2. Prisma Schema Additions (`prisma/schema.prisma`)

Append these models and fields alongside the customer schema in `rush_backend_antigravity_guide.md`:

```prisma
enum PayoutStatus {
  PENDING_REVIEW
  AWAITING_QUOTE_APPROVAL
  AWAITING_INVOICE_IBAN
  PENDING_BANK_TRANSFER
  PAID
  PAID_RRN
  REWASH_ISSUED
  DECLINED
}

model SystemConfig {
  id                   String   @id @default("default")
  damageApprovalCapSar Decimal  @default(200.00) @db.Decimal(10, 2)
  maxSlaHours          Int      @default(48)
  vatNumber            String   @default("310482917400003")
  crNumber             String   @default("1010684920")
  updatedAt            DateTime @updatedAt
}

model StaffUser {
  id           String      @id @default(cuid())
  name         String
  email        String      @unique
  phone        String?
  passwordHash String
  role         StaffRole
  branch       String      @default("All Branches") // Specific branch for OPS_MANAGER
  active       Boolean     @default(true)
  auditLogs    AuditLog[]
  createdAt    DateTime    @default(now())
}

model AuditLog {
  id          String    @id @default(cuid())
  complaintId String
  complaint   Complaint @relation(fields: [complaintId], references: [id], onDelete: Cascade)
  staffId     String?
  staff       StaffUser? @relation(fields: [staffId], references: [id])
  actorName   String
  action      String    // e.g. "HANDOFF_CSM", "APPROVE_QUOTE", "MARK_PAID", "SLA_NUDGE"
  details     String?
  createdAt   DateTime  @default(now())

  @@index([complaintId, createdAt])
}
```

Add these fields to your existing `Complaint` model:

```prisma
  assignedStaffName   String?
  quotedAmount        Decimal?     @db.Decimal(10, 2)
  payoutStatus        PayoutStatus @default(PENDING_REVIEW)
  transferRef         String?
  slaBreached         Boolean      @default(false)
  slaBreachedNotified Boolean      @default(false)
  auditLogs           AuditLog[]
```

---

## 3. Express + TypeScript Admin Routes (`src/routes/admin.ts`)

```ts
import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { PrismaClient, StaffRole, TicketStatus, PayoutStatus } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();
const STAFF_JWT_SECRET = process.env.STAFF_JWT_SECRET || "replace-staff-secret";

interface StaffReq extends Request {
  staff?: { staffId: string; name: string; role: StaffRole; branch: string };
}

async function requireStaff(req: StaffReq, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing staff token" });
  try {
    const payload = jwt.verify(token, STAFF_JWT_SECRET) as StaffReq["staff"];
    const user = await prisma.staffUser.findUnique({ where: { id: payload!.staffId } });
    if (!user || !user.active) return res.status(403).json({ error: "Account paused or inactive" });
    req.staff = { staffId: user.id, name: user.name, role: user.role, branch: user.branch };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired staff session" });
  }
}

function branchScopeWhere(staff: StaffReq["staff"], queryBranch?: string) {
  if (staff!.role === "OPS_MANAGER") return { site: staff!.branch };
  if (queryBranch && queryBranch !== "all") return { site: queryBranch };
  return {};
}

// 1. Get & Update Configurable System Policy (SAR 200 Cap & 48h SLA)
router.get("/config", requireStaff, async (_req, res) => {
  const cfg = await prisma.systemConfig.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
  return res.json(cfg);
});

router.patch("/config", requireStaff, async (req: StaffReq, res) => {
  if (req.staff!.role !== "BUSINESS_OWNER") {
    return res.status(403).json({ error: "Only Business Owner can update approval caps and SLA rules" });
  }
  const parsed = z.object({
    damageApprovalCapSar: z.number().nonnegative().optional(),
    maxSlaHours: z.number().int().min(4).max(168).optional(),
    vatNumber: z.string().min(5).optional(),
    crNumber: z.string().min(4).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const cfg = await prisma.systemConfig.update({ where: { id: "default" }, data: parsed.data });
  return res.json(cfg);
});

// 2. Executive Dashboard (KPIs, >48h SLA Breaches, >200 SAR Cap Escalations, Charts)
router.get("/dashboard", requireStaff, async (req: StaffReq, res) => {
  const cfg = await prisma.systemConfig.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  const whereScope = branchScopeWhere(req.staff, String(req.query.branch || "all"));
  const claims = await prisma.complaint.findMany({ where: whereScope, include: { customer: true } });

  const slaCutoffMs = cfg.maxSlaHours * 60 * 60 * 1000;
  const now = Date.now();

  const open = claims.filter((c) => c.status !== "RESOLVED");
  const breached = open.filter((c) => now - c.createdAt.getTime() > slaCutoffMs);
  const needOwner = open.filter(
    (c) => c.type === "DAMAGE" && Number(c.quotedAmount || 0) > Number(cfg.damageApprovalCapSar) && !c.quotationApproved
  );
  const rated = claims.filter((c) => c.csatRating != null);

  return res.json({
    config: cfg,
    kpis: {
      openCount: open.length,
      slaCompliancePct: claims.length ? Math.round(((claims.length - breached.length) / claims.length) * 100) : 100,
      breachedCount: breached.length,
      ownerApprovalsNeeded: needOwner.length,
      totalPayoutsSar: claims.reduce((s, c) => s + Number(c.approvedAmount || 0), 0),
      avgCsat: rated.length ? Number((rated.reduce((s, c) => s + (c.csatRating || 0), 0) / rated.length).toFixed(1)) : null,
    },
    escalations: claims.filter(
      (c) =>
        (c.status !== "RESOLVED" && now - c.createdAt.getTime() > slaCutoffMs) ||
        (c.type === "DAMAGE" && Number(c.quotedAmount || 0) > Number(cfg.damageApprovalCapSar) && !c.quotationApproved) ||
        c.payoutStatus === "PENDING_BANK_TRANSFER"
    ),
  });
});

// 3. Hand Off Damage Claim from Ops Manager -> CSM
router.post("/claims/:id/handoff-csm", requireStaff, async (req: StaffReq, res) => {
  if (!["OPS_MANAGER", "BUSINESS_OWNER"].includes(req.staff!.role)) {
    return res.status(403).json({ error: "Only Ops Manager or Business Owner can hand off Damage claims" });
  }
  const csm = await prisma.staffUser.findFirst({ where: { role: "CSM", active: true } });
  const updated = await prisma.complaint.update({
    where: { id: req.params.id },
    data: {
      assignedRole: "CSM",
      assignedStaffName: csm?.name || "CSM",
      status: TicketStatus.INVESTIGATING,
      auditLogs: { create: { staffId: req.staff!.staffId, actorName: req.staff!.name, action: "HANDOFF_CSM", details: `Handed off to ${csm?.name || "CSM"}` } },
    },
  });
  return res.json(updated);
});

// 4. Approve Damage Quotation & Unlock Customer Step 2 (Enforces SAR 200 Cap)
router.post("/claims/:id/damage/approve-quote", requireStaff, async (req: StaffReq, res) => {
  const cfg = await prisma.systemConfig.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const cap = Number(cfg.damageApprovalCapSar);
  const quoted = Number(ticket.quotedAmount || 0);
  if (quoted > cap && req.staff!.role !== "BUSINESS_OWNER") {
    return res.status(403).json({
      error: `Quoted amount (SAR ${quoted}) exceeds the SAR ${cap} cap and requires Business Owner approval.`,
    });
  }

  const updated = await prisma.complaint.update({
    where: { id: ticket.id },
    data: {
      quotationApproved: true,
      payoutStatus: PayoutStatus.AWAITING_INVOICE_IBAN,
      approvedAmount: ticket.quotedAmount,
      auditLogs: { create: { staffId: req.staff!.staffId, actorName: req.staff!.name, action: "APPROVE_QUOTE", details: `Approved SAR ${quoted} quotation` } },
    },
  });
  return res.json(updated);
});

// 5. Nudge Assigned Staff on >48h Overdue Ticket
router.post("/claims/:id/nudge", requireStaff, async (req: StaffReq, res) => {
  const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const updated = await prisma.complaint.update({
    where: { id: ticket.id },
    data: {
      slaBreached: true,
      auditLogs: { create: { staffId: req.staff!.staffId, actorName: req.staff!.name, action: "SLA_NUDGE", details: `Overdue reminder sent to ${ticket.assignedStaffName || ticket.assignedRole}` } },
    },
  });
  return res.json(updated);
});

// 6. Finance: Mark Damage IBAN Payout Paid with Transfer Ref #
router.post("/finance/:id/mark-paid", requireStaff, async (req: StaffReq, res) => {
  const parsed = z.object({ transferRef: z.string().min(3) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Transfer reference number required" });

  const updated = await prisma.complaint.update({
    where: { id: req.params.id },
    data: {
      transferRef: parsed.data.transferRef,
      payoutStatus: PayoutStatus.PAID,
      status: TicketStatus.RESOLVED,
      auditLogs: { create: { staffId: req.staff!.staffId, actorName: req.staff!.name, action: "MARK_PAID", details: `Transfer Ref: ${parsed.data.transferRef}` } },
    },
  });
  return res.json(updated);
});

export default router;
```
