import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { PrismaClient, StaffRole } from "@prisma/client";
import { assertSafeToRunDestructive } from "./guard";

const prisma = new PrismaClient();

async function main() {
  assertSafeToRunDestructive("setup_e2e_clean.ts");
  const e2ePassword = process.env.E2E_STAFF_PASSWORD || crypto.randomBytes(18).toString("base64url") + "aA1!";
  if (e2ePassword.length < 12) {
    throw new Error("E2E_STAFF_PASSWORD must be at least 12 characters");
  }
  // 1. Delete ALL existing tickets (AuditLog -> Message -> Complaint)
  const delAudit = await prisma.auditLog.deleteMany({});
  const delMsg = await prisma.message.deleteMany({});
  const delComp = await prisma.complaint.deleteMany({});
  console.log(`Deleted tickets: ${delComp.count} complaints, ${delMsg.count} messages, ${delAudit.count} audit logs.`);

  // 2. Ensure SystemConfig exists
  await prisma.systemConfig.upsert({
    where: { id: "default" },
    update: {},
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

  // 3. Upsert Authorized Test Customer (Rule 14: 569809578 / 5962HSS / MG)
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

  // 4. Upsert 10 WashVisits for Awais (spanning 1-14 days)
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const washes = [
    { id: "POS-E2E-W01", lane: "Tunnel Lane 1", packageName: "Nano Ceramic Wash", daysAgo: 1 },
    { id: "POS-E2E-W02", lane: "Express Lane 1", packageName: "Fresh Wash", daysAgo: 2 },
    { id: "POS-E2E-W03", lane: "Tunnel Lane 2", packageName: "Shiny Wash + Interior Clean", daysAgo: 3 },
    { id: "POS-E2E-W04", lane: "Tunnel Lane 1", packageName: "Shiny Wash", daysAgo: 4 },
    { id: "POS-E2E-W05", lane: "Express Lane 2", packageName: "Fresh Wash", daysAgo: 5 },
    { id: "POS-E2E-W06", lane: "Tunnel Lane 2", packageName: "Nano Ceramic Wash", daysAgo: 6 },
    { id: "POS-E2E-W07", lane: "Tunnel Lane 1", packageName: "Interior Cleaning", daysAgo: 8 },
    { id: "POS-E2E-W08", lane: "Express Lane 1", packageName: "Shiny Wash + Interior Clean", daysAgo: 10 },
    { id: "POS-E2E-W09", lane: "Tunnel Lane 2", packageName: "Fresh Wash", daysAgo: 12 },
    { id: "POS-E2E-W10", lane: "Tunnel Lane 1", packageName: "Nano Ceramic Wash", daysAgo: 14 },
  ];

  for (const w of washes) {
    const washedAt = new Date(now - w.daysAgo * dayMs);
    await prisma.washVisit.upsert({
      where: { id: w.id },
      update: { customerId: awais.id, site: "RUSH Al Kharj", lane: w.lane, packageName: w.packageName, washedAt },
      create: { id: w.id, customerId: awais.id, site: "RUSH Al Kharj", lane: w.lane, packageName: w.packageName, washedAt },
    });
  }

  // 5. Upsert 10 PosOrders for Awais (spanning 1-20 days)
  const orders = [
    { id: "ORD-E2E-O01", itemName: "Nano Ceramic Monthly Subscription", amountSar: 149.0, paymentMethod: "Mada (•••• 4192)", daysAgo: 1 },
    { id: "ORD-E2E-O02", itemName: "Shiny + Interior Clean", amountSar: 75.0, paymentMethod: "Apple Pay", daysAgo: 2 },
    { id: "ORD-E2E-O03", itemName: "Fresh Monthly Subscription", amountSar: 79.0, paymentMethod: "Mada (•••• 4192)", daysAgo: 4 },
    { id: "ORD-E2E-O04", itemName: "One-Time Nano Ceramic Wash", amountSar: 55.0, paymentMethod: "Visa (•••• 8821)", daysAgo: 6 },
    { id: "ORD-E2E-O05", itemName: "Interior Cleaning Add-on", amountSar: 35.0, paymentMethod: "Apple Pay", daysAgo: 8 },
    { id: "ORD-E2E-O06", itemName: "Shiny Monthly Subscription", amountSar: 109.0, paymentMethod: "Mada (•••• 4192)", daysAgo: 10 },
    { id: "ORD-E2E-O07", itemName: "One-Time Fresh Wash", amountSar: 30.0, paymentMethod: "Cash", daysAgo: 12 },
    { id: "ORD-E2E-O08", itemName: "One-Time Shiny Wash", amountSar: 45.0, paymentMethod: "Apple Pay", daysAgo: 15 },
    { id: "ORD-E2E-O09", itemName: "Nano Ceramic Monthly Subscription", amountSar: 149.0, paymentMethod: "Visa (•••• 8821)", daysAgo: 18 },
    { id: "ORD-E2E-O10", itemName: "Shiny + Interior Clean", amountSar: 75.0, paymentMethod: "Mada (•••• 4192)", daysAgo: 20 },
  ];

  for (const o of orders) {
    const orderedAt = new Date(now - o.daysAgo * dayMs);
    await prisma.posOrder.upsert({
      where: { id: o.id },
      update: { customerId: awais.id, site: "RUSH Al Kharj", itemName: o.itemName, amountSar: o.amountSar, paymentMethod: o.paymentMethod, orderedAt },
      create: { id: o.id, customerId: awais.id, site: "RUSH Al Kharj", itemName: o.itemName, amountSar: o.amountSar, paymentMethod: o.paymentMethod, orderedAt },
    });
  }

  // 6. Upsert E2E RBAC Staff Accounts (does not alter existing admin@rush.com.sa)
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

  const [ticketCount, washCount, orderCount, staffCount] = await Promise.all([
    prisma.complaint.count(),
    prisma.washVisit.count({ where: { customerId: awais.id } }),
    prisma.posOrder.count({ where: { customerId: awais.id } }),
    prisma.staffUser.count({ where: { email: { startsWith: "e2e." } } }),
  ]);

  console.log(`Verification: complaints=${ticketCount}, awais_washes=${washCount}, awais_orders=${orderCount}, e2e_staff=${staffCount}`);
}

main()
  .catch((e) => {
    console.error("E2E clean setup error:", e?.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
