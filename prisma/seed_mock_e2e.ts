import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import {
  PrismaClient,
  ComplaintType,
  TicketStatus,
  ResolutionStatus,
  PayoutStatus,
  StaffRole,
  MessageChannel,
} from "@prisma/client";
import { encryptField } from "../src/utils/crypto";
import { assertSafeToRunDestructive } from "./guard";

const prisma = new PrismaClient();

const SAMPLE_QUOTE_URL = "/api/files/quotations/1700000000001-11111111111111111111111111111111.pdf";
const SAMPLE_INVOICE_URL = "/api/files/invoices/1700000000002-22222222222222222222222222222222.pdf";
const SAMPLE_MEDIA_URL = "/api/files/media/1700000000003-33333333333333333333333333333333.jpg";

function ensureSampleUploads() {
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const files: Array<{ rel: string; buf: Buffer }> = [
    {
      rel: "quotations/1700000000001-11111111111111111111111111111111.pdf",
      buf: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8"),
    },
    {
      rel: "invoices/1700000000002-22222222222222222222222222222222.pdf",
      buf: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8"),
    },
    {
      rel: "media/1700000000003-33333333333333333333333333333333.jpg",
      buf: Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
        0x00, 0xff, 0xd9,
      ]),
    },
  ];
  for (const f of files) {
    const dest = path.resolve(uploadsRoot, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.buf);
  }
}

async function main() {
  assertSafeToRunDestructive("seed_mock_e2e.ts");
  const e2ePassword = process.env.E2E_STAFF_PASSWORD || crypto.randomBytes(18).toString("base64url") + "aA1!";
  if (e2ePassword.length < 12) {
    throw new Error("E2E_STAFF_PASSWORD must be at least 12 characters");
  }
  ensureSampleUploads();

  // 1. Ensure SystemConfig exists
  await prisma.systemConfig.upsert({
    where: { id: "default" },
    update: {
      damageApprovalCapSar: 200.0,
      maxSlaHours: 48,
      companyName: "شركة رَش للتجارة المتقدمة",
      vatNumber: "311949083200003",
      crNumber: "1011154912",
      unifiedNationalNumber: "7037475576",
      whatsappNumber: "966503444958",
    },
    create: {
      id: "default",
      damageApprovalCapSar: 200.0,
      maxSlaHours: 48,
      companyName: "شركة رَش للتجارة المتقدمة",
      vatNumber: "311949083200003",
      crNumber: "1011154912",
      unifiedNationalNumber: "7037475576",
      whatsappNumber: "966503444958",
    },
  });

  // 2. Upsert Authorized Test Customer (Rule 14: 569809578 / 5962HSS / MG)
  const awais = await prisma.customer.upsert({
    where: { licensePlate_phone: { licensePlate: "5962HSS", phone: "569809578" } },
    update: { name: "Awais", vehicleModel: "MG" },
    create: {
      name: "Awais",
      phone: "569809578",
      licensePlate: "5962HSS",
      vehicleModel: "MG",
    },
  });

  // 3. Upsert Wash Visits (3 within 7 days, 1 older at 12 days) & Paid POS Orders
  const now = Date.now();
  const visits = [
    { id: "POS-E2E-W1", lane: "Tunnel Lane 1", packageName: "Nano Ceramic Wash", washedAt: new Date(now - 1 * 24 * 3600 * 1000) },
    { id: "POS-E2E-W2", lane: "Express Lane 1", packageName: "Fresh Wash", washedAt: new Date(now - 3 * 24 * 3600 * 1000) },
    { id: "POS-E2E-W3", lane: "Tunnel Lane 2", packageName: "Shiny Wash + Interior Clean", washedAt: new Date(now - 5 * 24 * 3600 * 1000) },
    { id: "POS-E2E-W4", lane: "Tunnel Lane 1", packageName: "Fresh Wash", washedAt: new Date(now - 12 * 24 * 3600 * 1000) },
  ];
  for (const v of visits) {
    await prisma.washVisit.upsert({
      where: { id: v.id },
      update: { customerId: awais.id, site: "RUSH Al Kharj", lane: v.lane, packageName: v.packageName, washedAt: v.washedAt },
      create: { id: v.id, customerId: awais.id, site: "RUSH Al Kharj", lane: v.lane, packageName: v.packageName, washedAt: v.washedAt },
    });
  }

  const orders = [
    { id: "ORD-E2E-O1", itemName: "Nano Ceramic Monthly Subscription", amountSar: 149.0, paymentMethod: "Mada (•••• 4192)", orderedAt: new Date(now - 2 * 24 * 3600 * 1000) },
    { id: "ORD-E2E-O2", itemName: "Shiny + Interior Clean", amountSar: 75.0, paymentMethod: "Apple Pay", orderedAt: new Date(now - 4 * 24 * 3600 * 1000) },
  ];
  for (const o of orders) {
    await prisma.posOrder.upsert({
      where: { id: o.id },
      update: { customerId: awais.id, site: "RUSH Al Kharj", itemName: o.itemName, amountSar: o.amountSar, paymentMethod: o.paymentMethod, orderedAt: o.orderedAt },
      create: { id: o.id, customerId: awais.id, site: "RUSH Al Kharj", itemName: o.itemName, amountSar: o.amountSar, paymentMethod: o.paymentMethod, orderedAt: o.orderedAt },
    });
  }

  // 4. Upsert E2E RBAC Staff Accounts (never alters existing admin@rush.com.sa)
  const passwordHash = await bcrypt.hash(e2ePassword, 12);
  const staffDefs = [
    { email: "e2e.owner@rush.com.sa", name: "Muhammad Awais", role: StaffRole.BUSINESS_OWNER, branch: "All Branches" },
    { email: "e2e.admin@rush.com.sa", name: "Sara Al-Qahtani", role: StaffRole.ADMIN, branch: "All Branches" },
    { email: "e2e.ops@rush.com.sa", name: "Faisal Al-Harbi", role: StaffRole.OPS_MANAGER, branch: "RUSH Al Kharj" },
    { email: "e2e.csm@rush.com.sa", name: "Omar Al-Dosari", role: StaffRole.CSM, branch: "All Branches" },
  ];
  for (const s of staffDefs) {
    await prisma.staffUser.upsert({
      where: { email: s.email },
      update: { name: s.name, role: s.role, branch: s.branch, active: true, passwordHash },
      create: { email: s.email, name: s.name, role: s.role, branch: s.branch, active: true, passwordHash },
    });
  }

  // 5. Upsert 6 Representative Mock Complaints (C-9001..C-9006) scoped to Awais
  const mockIds = ["C-9001", "C-9002", "C-9003", "C-9004", "C-9005", "C-9006"];
  await prisma.auditLog.deleteMany({ where: { complaintId: { in: mockIds } } });
  await prisma.message.deleteMany({ where: { complaintId: { in: mockIds } } });
  await prisma.complaint.deleteMany({ where: { id: { in: mockIds } } });

  await prisma.complaint.create({
    data: {
      id: "C-9001",
      customerId: awais.id,
      type: ComplaintType.UNSATISFIED,
      status: TicketStatus.SUBMITTED,
      resolutionStatus: ResolutionStatus.PENDING,
      payoutStatus: PayoutStatus.PENDING_REVIEW,
      assignedRole: StaffRole.ADMIN,
      assignedStaffName: "Sara Al-Qahtani",
      site: "RUSH Al Kharj",
      posRecordId: "POS-E2E-W2",
      posRecordLabel: "POS-E2E-W2 (Fresh Wash)",
      summary: "Soap residue left on driver side mirror and rear bumper.",
      qualityTags: ["Soap Residue", "Water Spots"],
      mediaUrls: [SAMPLE_MEDIA_URL],
      createdAt: new Date(now - 3 * 3600 * 1000),
      messages: {
        create: [{ sender: "Customer", channel: MessageChannel.WEB_PORTAL, body: "Soap residue left on driver side mirror and rear bumper." }],
      },
    },
  });

  await prisma.complaint.create({
    data: {
      id: "C-9002",
      customerId: awais.id,
      type: ComplaintType.BILLING_REFUND,
      status: TicketStatus.SUBMITTED,
      resolutionStatus: ResolutionStatus.PENDING,
      payoutStatus: PayoutStatus.PENDING_REVIEW,
      assignedRole: StaffRole.ADMIN,
      assignedStaffName: "Sara Al-Qahtani",
      site: "RUSH Al Kharj",
      posRecordId: "ORD-E2E-O2",
      posRecordLabel: "ORD-E2E-O2 (Shiny + Interior Clean)",
      summary: "[Double Charge · SAR 75] Duplicate Apple Pay deduction at kiosk.",
      billingReason: "Double Charge",
      requestedAmount: 75.0,
      cardLast4: "4192",
      createdAt: new Date(now - 5 * 3600 * 1000),
      messages: {
        create: [{ sender: "Customer", channel: MessageChannel.WEB_PORTAL, body: "Duplicate Apple Pay deduction at kiosk." }],
      },
    },
  });

  await prisma.complaint.create({
    data: {
      id: "C-9003",
      customerId: awais.id,
      type: ComplaintType.DAMAGE,
      status: TicketStatus.INVESTIGATING,
      resolutionStatus: ResolutionStatus.APPROVED,
      resolutionNote: "Approved for repair quotation review.",
      payoutStatus: PayoutStatus.AWAITING_QUOTE_APPROVAL,
      assignedRole: StaffRole.CSM,
      assignedStaffName: "Omar Al-Dosari",
      site: "RUSH Al Kharj",
      posRecordId: "POS-E2E-W3",
      posRecordLabel: "POS-E2E-W3 (Shiny Wash + Interior Clean)",
      summary: "Minor polish scuff on Rear Bumper trim.",
      vehicleZones: ["Rear Bumper"],
      quotedAmount: 180.0,
      quotationUrl: SAMPLE_QUOTE_URL,
      waiverSigned: true,
      waiverSignature: "DIGITALLY_SIGNED_ON_PORTAL",
      quotationApproved: false,
      mediaUrls: [SAMPLE_MEDIA_URL],
      createdAt: new Date(now - 10 * 3600 * 1000),
      messages: {
        create: [{ sender: "Customer", channel: MessageChannel.WEB_PORTAL, body: "Minor polish scuff on Rear Bumper trim." }],
      },
    },
  });

  await prisma.complaint.create({
    data: {
      id: "C-9004",
      customerId: awais.id,
      type: ComplaintType.DAMAGE,
      status: TicketStatus.INVESTIGATING,
      resolutionStatus: ResolutionStatus.APPROVED,
      resolutionNote: "High-value workshop quote uploaded (> SAR 200 cap).",
      payoutStatus: PayoutStatus.AWAITING_QUOTE_APPROVAL,
      assignedRole: StaffRole.CSM,
      assignedStaffName: "Omar Al-Dosari",
      site: "RUSH Al Kharj",
      posRecordId: "POS-E2E-W1",
      posRecordLabel: "POS-E2E-W1 (Nano Ceramic Wash)",
      summary: "Deep scratch across Passenger Side & Mirror casing.",
      vehicleZones: ["Passenger Side & Mirror"],
      quotedAmount: 650.0,
      quotationUrl: SAMPLE_QUOTE_URL,
      waiverSigned: true,
      waiverSignature: "DIGITALLY_SIGNED_ON_PORTAL",
      quotationApproved: false,
      mediaUrls: [SAMPLE_MEDIA_URL],
      createdAt: new Date(now - 12 * 3600 * 1000),
      messages: {
        create: [{ sender: "Customer", channel: MessageChannel.WEB_PORTAL, body: "Deep scratch across Passenger Side & Mirror casing." }],
      },
    },
  });

  await prisma.complaint.create({
    data: {
      id: "C-9005",
      customerId: awais.id,
      type: ComplaintType.DAMAGE,
      status: TicketStatus.PENDING_PAYOUT,
      resolutionStatus: ResolutionStatus.APPROVED,
      resolutionNote: "Quotation approved; awaiting finance IBAN transfer.",
      payoutStatus: PayoutStatus.PENDING_BANK_TRANSFER,
      assignedRole: StaffRole.ADMIN,
      assignedStaffName: "Sara Al-Qahtani",
      site: "RUSH Al Kharj",
      posRecordId: "POS-E2E-W4",
      posRecordLabel: "POS-E2E-W4 (Fresh Wash)",
      summary: "Front Bumper lower lip crack verified on tunnel camera.",
      vehicleZones: ["Front Bumper"],
      quotedAmount: 320.0,
      approvedAmount: 320.0,
      quotationUrl: SAMPLE_QUOTE_URL,
      waiverSigned: true,
      waiverSignature: "DIGITALLY_SIGNED_ON_PORTAL",
      quotationApproved: true,
      invoiceUrl: SAMPLE_INVOICE_URL,
      bankName: "Al Rajhi Bank",
      accountHolder: encryptField("Awais"),
      iban: encryptField("SA0380000000608010167519"),
      createdAt: new Date(now - 24 * 3600 * 1000),
      messages: {
        create: [
          { sender: "Customer", channel: MessageChannel.WEB_PORTAL, body: "Front Bumper lower lip crack verified on tunnel camera." },
          { sender: "Sara Al-Qahtani", channel: MessageChannel.WHATSAPP, body: "Your repair quotation of SAR 320 has been approved!" },
        ],
      },
    },
  });

  await prisma.complaint.create({
    data: {
      id: "C-9006",
      customerId: awais.id,
      type: ComplaintType.DAMAGE,
      status: TicketStatus.SUBMITTED,
      resolutionStatus: ResolutionStatus.PENDING,
      payoutStatus: PayoutStatus.PENDING_REVIEW,
      assignedRole: StaffRole.OPS_MANAGER,
      assignedStaffName: "Faisal Al-Harbi",
      site: "RUSH Al Kharj",
      posRecordId: "VISIT-UNLISTED",
      posRecordLabel: "Earlier / Unlisted Wash",
      summary: "Overdue SLA escalation check: Hood swirl marks reported >48h ago.",
      vehicleZones: ["Hood"],
      createdAt: new Date(now - 60 * 3600 * 1000),
      messages: {
        create: [{ sender: "Customer", channel: MessageChannel.WEB_PORTAL, body: "Overdue SLA escalation check: Hood swirl marks reported >48h ago." }],
      },
    },
  });

  console.log("Non-destructive E2E mock seed completed successfully.");
  console.log("Customer: Awais | Plate: 5962HSS | Phone: 0569809578 | Vehicle: MG | Branch: RUSH Al Kharj");
  console.log("Tickets: C-9001..C-9006 | Staff: e2e.owner / e2e.admin / e2e.ops / e2e.csm @rush.com.sa");
}

main()
  .catch((e) => {
    console.error("E2E seed error:", e?.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
