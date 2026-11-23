# RUSH رش Car Wash — Backend Prompt & Starter Code for Antigravity

Copy the **Master Prompt** below directly into **Antigravity** to scaffold the full backend, or drop the **Prisma Schema** and **Express + TypeScript Starter Code** straight into your workspace.

---

## 1. Copy-Paste Antigravity Master Prompt

```text
Build a production-ready Node.js + TypeScript + Express + Prisma (PostgreSQL) backend for the RUSH Car Wash Customer Care Portal (`rush_customer_portal.html`).

### Core Business Rules & Security
1. **Plate + Phone Verification & OTP (`POST /api/auth/request-otp`, `POST /api/auth/verify-otp`)**
   - Normalize Saudi license plates (uppercase, strip spaces/hyphens) and `+966` mobile numbers (last 9 digits).
   - Require an exact match between `licensePlate` and `phone` in the `Customer` / POS database before sending a 4-digit OTP (5-minute TTL, max 5 attempts, rate-limited).
   - On OTP verification, issue a signed short-lived JWT (`customer_session`, 30-minute TTL).

2. **Dynamic Visit / Order History & Duplicate Guard (`GET /api/customer/history`)**
   - Protected by `customer_session` JWT.
   - Accepts `?type=Unsatisfied|Billing / Refund|Damage`.
   - For `Unsatisfied` and `Damage`: return up to the **last 3 washes within the past 7 days**.
   - For `Billing / Refund`: return recent POS orders plus allow the client to submit `ORD-UNLISTED`.
   - Flag any wash or order that already has an open or resolved complaint with `alreadyReportedTicketId` so the UI blocks duplicates and links to Track Complaint.

3. **Complaint Submission (`POST /api/complaints`)**
   - Exact complaint types: `Unsatisfied`, `Billing / Refund`, `Damage`.
   - Generate sequential short ticket IDs (`C-1043`, `C-1044`, ...).
   - Reject duplicate submissions on the same `posRecordId` (except `ORD-UNLISTED`).
   - For `Unsatisfied`: accept `qualityTags[]`, `description`, `callbackWindow`, and media uploads (no preferred resolution field).
   - For `Billing / Refund`: accept `billingReason`, `requestedRefundAmount`, and if `posRecordId === "ORD-UNLISTED"`, require `cardLast4` (4 digits) and `bankSmsUrl` or `bankSmsText`.
   - For `Damage`: accept `vehicleZones[]` (2D car map), `description`, `callbackWindow`, and media uploads (no estimate field).
   - **Future-ready Auto-Routing fields** (stored in DB for upcoming Admin/RBAC panel):
     - `Unsatisfied` & `Billing / Refund` -> `assignedRole: "ADMIN"`
     - `Damage` -> `assignedRole: "OPS_MANAGER"` (later handed off to `"CSM"`).
   - No camera or NVR integration.

4. **Customer Complaint Tracking (`POST /api/complaints/track`)**
   - Lookup by `(ticketId OR licensePlate) + phone`.
   - If looked up by `licensePlate`, return all matching tickets for that customer.
   - Return full 4-stage status (`Submitted`, `Investigating`, `Pending Payout`, `Resolved`), `resolutionStatus` (`Pending`, `Approved`, `Refused`), `resolutionNote`, `rewashCode`, `rrn`, `damageFlow`, `csatRating`, and `messages[]`.

5. **Three Dedicated Customer Resolution Flows**
   - **Unsatisfied**: If `Approved`, expose `rewashCode` (e.g., `RW-xxxx`) for QR redemption; if `Refused`, expose `resolutionNote`.
   - **Billing / Refund**: If `Approved`, expose `rrn` (Retrieval Reference Number) and `approvedAmount`; if `Refused`, expose `resolutionNote`.
   - **Damage**:
     - If `Refused`, expose `resolutionNote`.
     - If `Approved`, enforce a strict **2-step server-side gate**:
       - `POST /api/complaints/:id/damage/step1`: Customer uploads Repair Quotation (`quotationUrl`) + signs Customer Liability Waiver (`waiverSignatureDataUrl`). **Uploading a quotation MUST NOT set `quotationApproved = true`.** Status remains pending management review, and final payout is strictly based on verified tax invoice & management discretion.
       - `POST /api/complaints/:id/damage/step2`: Reject with `403` unless `quotationApproved === true`. Accepts Tax Invoice (`invoiceUrl`), `bankName`, `accountHolder`, and Saudi `iban` (`SA` + 22 digits validation). Expose Rush Tax Details (`companyName`, `vatNumber`, `crNumber`, `address`) from environment config.

6. **WhatsApp Sync & CSAT**
   - `POST /api/complaints/:id/whatsapp`: Sends message via WhatsApp Cloud API (with local mock fallback in dev) and persists it in `Message` table (`channel: "WHATSAPP"`).
   - `POST /api/webhooks/whatsapp`: Receives inbound/outbound WhatsApp replies and appends them to the matching ticket's `Message` history.
   - `POST /api/complaints/:id/csat`: Allows 1–5 star rating only when `status === "RESOLVED"`.

7. **Deliverables**
   - Create `prisma/schema.prisma`, `src/server.ts`, `src/routes/`, `src/middleware/auth.ts`, `src/services/otp.ts`, `src/services/whatsapp.ts`, `src/services/storage.ts`, `.env.example`, and a seed script (`prisma/seed.ts`) with realistic Saudi demo records matching `rush_customer_portal.html`.
   - Add Zod validation on every request body and Vitest/Supertest integration tests covering OTP mismatch, 7-day wash window, duplicate guard, unlisted order Card Last 4 + Bank SMS, and Damage Step 2 server-side lock.
```

---

## 2. Database Schema (`prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ComplaintType {
  UNSATISFIED
  BILLING_REFUND
  DAMAGE
}

enum TicketStatus {
  SUBMITTED
  INVESTIGATING
  PENDING_PAYOUT
  RESOLVED
}

enum ResolutionStatus {
  PENDING
  APPROVED
  REFUSED
}

enum StaffRole {
  BUSINESS_OWNER
  ADMIN
  OPS_MANAGER
  CSM
}

enum MessageChannel {
  WEB_PORTAL
  WHATSAPP
  SMS
  EMAIL
}

model Customer {
  id           String      @id @default(cuid())
  name         String
  phone        String      // Stored normalized (9 digits, e.g. 553914420)
  email        String?
  licensePlate String      // Stored normalized (e.g. KSA8821)
  vehicleModel String
  washes       WashVisit[]
  orders       PosOrder[]
  complaints   Complaint[]
  createdAt    DateTime    @default(now())

  @@unique([licensePlate, phone])
  @@index([phone])
}

model WashVisit {
  id          String   @id // e.g. POS-94102
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  site        String
  lane        String
  packageName String
  washedAt    DateTime

  @@index([customerId, washedAt])
}

model PosOrder {
  id            String   @id // e.g. ORD-88241
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  site          String
  itemName      String
  amountSar     Decimal  @db.Decimal(10, 2)
  paymentMethod String
  orderedAt     DateTime

  @@index([customerId, orderedAt])
}

model OtpSession {
  id           String   @id @default(cuid())
  phone        String
  licensePlate String
  codeHash     String
  attempts     Int      @default(0)
  expiresAt    DateTime
  verified     Boolean  @default(false)
  createdAt    DateTime @default(now())

  @@index([phone, licensePlate])
}

model Complaint {
  id               String           @id // e.g. C-1043
  customerId       String
  customer         Customer         @relation(fields: [customerId], references: [id])
  type             ComplaintType
  status           TicketStatus     @default(SUBMITTED)
  resolutionStatus ResolutionStatus @default(PENDING)
  resolutionNote   String?
  assignedRole     StaffRole
  site             String
  posRecordId      String           // WashVisit.id, PosOrder.id, or "ORD-UNLISTED"
  posRecordLabel   String
  summary          String
  callbackWindow   String           @default("Anytime")

  // Type-specific fields
  qualityTags      String[]         @default([])
  vehicleZones     String[]         @default([])
  billingReason    String?
  requestedAmount  Decimal?         @db.Decimal(10, 2)
  approvedAmount   Decimal?         @db.Decimal(10, 2)
  cardLast4        String?
  bankSmsText      String?
  bankSmsUrl       String?

  // Resolution outputs
  rewashCode       String?          @unique
  rrn              String?

  // Damage 2-step settlement (uploading quotation does NOT approve payout)
  quotationUrl      String?
  waiverSigned      Boolean         @default(false)
  waiverSignature   String?
  quotationApproved Boolean         @default(false)
  invoiceUrl        String?
  bankName          String?
  accountHolder     String?
  iban              String?

  // Post-resolution feedback
  csatRating       Int?
  mediaUrls        String[]         @default([])
  messages         Message[]
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  @@index([customerId])
  @@index([posRecordId])
}

model Message {
  id          String         @id @default(cuid())
  complaintId String
  complaint   Complaint      @relation(fields: [complaintId], references: [id], onDelete: Cascade)
  sender      String
  channel     MessageChannel
  body        String
  externalId  String?        // WhatsApp Cloud API message ID
  createdAt   DateTime       @default(now())

  @@index([complaintId, createdAt])
}
```

---

## 3. Express + TypeScript Starter API (`src/server.ts`)

```ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { PrismaClient, ComplaintType, StaffRole } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const normalizePlate = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizePhone = (p: string) => p.replace(/\D/g, "").slice(-9);
const hashOtp = (otp: string) => crypto.createHash("sha256").update(otp).digest("hex");

interface AuthedRequest extends Request {
  customer?: { customerId: string; phone: string; licensePlate: string };
}

function requireCustomerJwt(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing session token" });
  try {
    req.customer = jwt.verify(token, JWT_SECRET) as AuthedRequest["customer"];
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired OTP session" });
  }
}

// 1. Request OTP (Strict Plate + Phone match)
app.post("/api/auth/request-otp", async (req, res) => {
  const parsed = z.object({ licensePlate: z.string().min(2), phone: z.string().min(9) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid plate or phone" });

  const plate = normalizePlate(parsed.data.licensePlate);
  const phone = normalizePhone(parsed.data.phone);

  const customer = await prisma.customer.findUnique({
    where: { licensePlate_phone: { licensePlate: plate, phone } },
  });
  if (!customer) {
    return res.status(404).json({ error: "License plate and mobile number do not match our records." });
  }

  const code = String(1000 + Math.floor(Math.random() * 9000));
  await prisma.otpSession.create({
    data: {
      phone,
      licensePlate: plate,
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  // TODO: Send `code` via SMS/WhatsApp provider (Unifonic / Taqnyat / Twilio)
  return res.json({
    sent: true,
    ...(process.env.NODE_ENV !== "production" ? { devOtp: code } : {}),
  });
});

// 2. Verify OTP -> Issue Customer JWT
app.post("/api/auth/verify-otp", async (req, res) => {
  const parsed = z.object({ licensePlate: z.string(), phone: z.string(), code: z.string().length(4) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const plate = normalizePlate(parsed.data.licensePlate);
  const phone = normalizePhone(parsed.data.phone);

  const session = await prisma.otpSession.findFirst({
    where: { phone, licensePlate: plate, verified: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!session || session.attempts >= 5) {
    return res.status(400).json({ error: "OTP expired or max attempts exceeded" });
  }
  if (session.codeHash !== hashOtp(parsed.data.code)) {
    await prisma.otpSession.update({ where: { id: session.id }, data: { attempts: { increment: 1 } } });
    return res.status(401).json({ error: "Invalid OTP code" });
  }

  await prisma.otpSession.update({ where: { id: session.id }, data: { verified: true } });
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { licensePlate_phone: { licensePlate: plate, phone } },
  });

  const token = jwt.sign(
    { customerId: customer.id, phone: customer.phone, licensePlate: customer.licensePlate },
    JWT_SECRET,
    { expiresIn: "30m" }
  );

  return res.json({ token, customer: { name: customer.name, vehicleModel: customer.vehicleModel, licensePlate: customer.licensePlate } });
});

// 3. Get Dynamic History (Last 3 Washes in 7 Days OR Recent Orders + Duplicate Guard)
app.get("/api/customer/history", requireCustomerJwt, async (req: AuthedRequest, res) => {
  const type = String(req.query.type || "UNSATISFIED");
  const customerId = req.customer!.customerId;

  const existing = await prisma.complaint.findMany({
    where: { customerId },
    select: { id: true, posRecordId: true },
  });
  const dupMap = new Map(existing.map((c) => [c.posRecordId, c.id]));

  if (type === "BILLING_REFUND") {
    const orders = await prisma.posOrder.findMany({
      where: { customerId },
      orderBy: { orderedAt: "desc" },
      take: 10,
    });
    return res.json({
      kind: "orders",
      allowUnlisted: true,
      records: orders.map((o) => ({ ...o, alreadyReportedTicketId: dupMap.get(o.id) || null })),
    });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const washes = await prisma.washVisit.findMany({
    where: { customerId, washedAt: { gte: sevenDaysAgo } },
    orderBy: { washedAt: "desc" },
    take: 3,
  });
  return res.json({
    kind: "washes",
    records: washes.map((w) => ({ ...w, alreadyReportedTicketId: dupMap.get(w.id) || null })),
  });
});

// 4. Create Complaint (Duplicate Guard + Auto-Routing)
app.post("/api/complaints", requireCustomerJwt, async (req: AuthedRequest, res) => {
  const schema = z.object({
    type: z.enum(["UNSATISFIED", "BILLING_REFUND", "DAMAGE"]),
    posRecordId: z.string().min(1),
    posRecordLabel: z.string().min(1),
    site: z.string().min(1),
    summary: z.string().min(3),
    callbackWindow: z.string().default("Anytime"),
    qualityTags: z.array(z.string()).default([]),
    vehicleZones: z.array(z.string()).default([]),
    billingReason: z.string().optional(),
    requestedAmount: z.number().nonnegative().optional(),
    cardLast4: z.string().regex(/^\d{4}$/).optional(),
    bankSmsText: z.string().optional(),
    bankSmsUrl: z.string().optional(),
    mediaUrls: z.array(z.string()).default([]),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const customerId = req.customer!.customerId;

  if (data.posRecordId === "ORD-UNLISTED" && (!data.cardLast4 || (!data.bankSmsUrl && !data.bankSmsText))) {
    return res.status(400).json({ error: "Card last 4 digits and Bank SMS proof are required for unlisted orders." });
  }

  if (data.posRecordId !== "ORD-UNLISTED") {
    const dup = await prisma.complaint.findFirst({ where: { customerId, posRecordId: data.posRecordId } });
    if (dup) return res.status(409).json({ error: "Already reported", ticketId: dup.id });
  }

  const count = await prisma.complaint.count();
  const ticketId = `C-${1043 + count}`;
  const assignedRole: StaffRole = data.type === ComplaintType.DAMAGE ? StaffRole.OPS_MANAGER : StaffRole.ADMIN;

  const complaint = await prisma.complaint.create({
    data: {
      id: ticketId,
      customerId,
      type: data.type,
      assignedRole,
      site: data.site,
      posRecordId: data.posRecordId,
      posRecordLabel: data.posRecordLabel,
      summary: data.summary,
      callbackWindow: data.callbackWindow,
      qualityTags: data.qualityTags,
      vehicleZones: data.vehicleZones,
      billingReason: data.billingReason,
      requestedAmount: data.requestedAmount,
      cardLast4: data.cardLast4,
      bankSmsText: data.bankSmsText,
      bankSmsUrl: data.bankSmsUrl,
      mediaUrls: data.mediaUrls,
      messages: { create: { sender: "Customer", channel: "WEB_PORTAL", body: data.summary } },
    },
    include: { messages: true },
  });

  return res.status(201).json(complaint);
});

// 5. Track Complaint (by Ticket ID OR License Plate + Phone)
app.post("/api/complaints/track", async (req, res) => {
  const parsed = z.object({ query: z.string().min(2), phone: z.string().min(9) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid lookup fields" });

  const q = parsed.data.query.trim().toUpperCase();
  const qPlate = normalizePlate(q);
  const phone = normalizePhone(parsed.data.phone);

  const tickets = await prisma.complaint.findMany({
    where: {
      customer: { phone },
      OR: [{ id: q }, { customer: { licensePlate: qPlate } }],
    },
    include: {
      customer: { select: { name: true, licensePlate: true, vehicleModel: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!tickets.length) return res.status(404).json({ error: "No matching complaint found" });

  return res.json({
    rushTaxDetails: {
      companyName: process.env.RUSH_TAX_COMPANY || "Rush Car Wash Operations Co.",
      vatNumber: process.env.RUSH_VAT_NUMBER || "310482917400003",
      crNumber: process.env.RUSH_CR_NUMBER || "1010684920",
      address: process.env.RUSH_TAX_ADDRESS || "Prince Muhammad Bin Salman Rd, Al Kharj",
    },
    tickets,
  });
});

// 6. Damage Step 1: Upload Quotation + Sign Waiver (Does NOT auto-approve)
app.post("/api/complaints/:id/damage/step1", async (req, res) => {
  const parsed = z.object({ quotationUrl: z.string().min(1), waiverSignature: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Quotation and waiver signature required" });

  const updated = await prisma.complaint.update({
    where: { id: req.params.id },
    data: {
      quotationUrl: parsed.data.quotationUrl,
      waiverSigned: true,
      waiverSignature: parsed.data.waiverSignature,
      quotationApproved: false, // Explicitly requires management approval
    },
  });
  return res.json({
    ticket: updated,
    notice: "Uploading a quotation does not constitute payout approval. Final payout is based on verified tax invoice and management discretion.",
  });
});

// 7. Damage Step 2: Upload Tax Invoice + IBAN (Locked until quotationApproved === true)
app.post("/api/complaints/:id/damage/step2", async (req, res) => {
  const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  if (!ticket.quotationApproved) {
    return res.status(403).json({ error: "Management must review and approve your quotation before uploading the tax invoice and IBAN." });
  }

  const parsed = z.object({
    invoiceUrl: z.string().min(1),
    bankName: z.string().min(2),
    accountHolder: z.string().min(2),
    iban: z.string().regex(/^SA\d{22}$/, "Must be a valid Saudi IBAN (SA + 22 digits)"),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updated = await prisma.complaint.update({
    where: { id: ticket.id },
    data: {
      invoiceUrl: parsed.data.invoiceUrl,
      bankName: parsed.data.bankName,
      accountHolder: parsed.data.accountHolder,
      iban: parsed.data.iban,
      messages: {
        create: {
          sender: "Customer",
          channel: "WEB_PORTAL",
          body: `Submitted Tax Invoice & Bank Details (${parsed.data.bankName} · ${parsed.data.iban}).`,
        },
      },
    },
  });
  return res.json(updated);
});

// 8. Send WhatsApp Message (Synced to History)
app.post("/api/complaints/:id/whatsapp", async (req, res) => {
  const parsed = z.object({ body: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message body required" });

  // TODO: Forward to WhatsApp Cloud API using WHATSAPP_TOKEN & WHATSAPP_PHONE_ID
  const msg = await prisma.message.create({
    data: { complaintId: req.params.id, sender: "Customer", channel: "WHATSAPP", body: parsed.data.body },
  });
  return res.status(201).json(msg);
});

// 9. Post-Resolution CSAT Rating
app.post("/api/complaints/:id/csat", async (req, res) => {
  const parsed = z.object({ rating: z.number().int().min(1).max(5) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Rating must be 1–5" });

  const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
  if (!ticket || ticket.status !== "RESOLVED") {
    return res.status(400).json({ error: "CSAT can only be submitted on resolved tickets" });
  }

  const updated = await prisma.complaint.update({
    where: { id: ticket.id },
    data: { csatRating: parsed.data.rating },
  });
  return res.json(updated);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`RUSH Customer Care API running on :${PORT}`));
```

---

## 4. Environment Variables (`.env.example`)

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/rush_care"
JWT_SECRET="replace-with-strong-256-bit-secret"
NODE_ENV="development"

# Rush Tax Details (displayed in Damage Step 2)
RUSH_TAX_COMPANY="Rush Car Wash Operations Co."
RUSH_VAT_NUMBER="310482917400003"
RUSH_CR_NUMBER="1010684920"
RUSH_TAX_ADDRESS="Prince Muhammad Bin Salman Road, Al Kharj"

# SMS OTP Provider (e.g. Unifonic / Taqnyat / Twilio)
SMS_PROVIDER_API_KEY=""
SMS_SENDER_ID="RUSH"

# WhatsApp Business Cloud API
WHATSAPP_TOKEN=""
WHATSAPP_PHONE_NUMBER_ID=""
WHATSAPP_WEBHOOK_VERIFY_TOKEN=""
```
