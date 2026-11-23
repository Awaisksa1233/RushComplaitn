import dotenv from "dotenv";
dotenv.config();

import { PrismaClient, StaffRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Purging all demo data from Supabase PostgreSQL ===");

  // 1. Cascade delete complaints, messages, audit logs
  const deletedAudit = await prisma.auditLog.deleteMany();
  console.log(`- Deleted ${deletedAudit.count} audit logs.`);

  const deletedMsg = await prisma.message.deleteMany();
  console.log(`- Deleted ${deletedMsg.count} messages.`);

  const deletedComplaints = await prisma.complaint.deleteMany();
  console.log(`- Deleted ${deletedComplaints.count} complaints.`);

  const deletedOtps = await prisma.otpSession.deleteMany();
  console.log(`- Deleted ${deletedOtps.count} OTP sessions.`);

  const deletedWashes = await prisma.washVisit.deleteMany();
  console.log(`- Deleted ${deletedWashes.count} wash visits.`);

  const deletedOrders = await prisma.posOrder.deleteMany();
  console.log(`- Deleted ${deletedOrders.count} POS orders.`);

  const deletedCustomers = await prisma.customer.deleteMany();
  console.log(`- Deleted ${deletedCustomers.count} cached customers.`);

  // 2. Remove old mock staff users
  const deletedStaff = await prisma.staffUser.deleteMany();
  console.log(`- Deleted ${deletedStaff.count} old mock staff accounts.`);

  // 3. Upsert SystemConfig
  const config = await prisma.systemConfig.upsert({
    where: { id: "default" },
    update: {
      damageApprovalCapSar: 200.00,
      maxSlaHours: 48,
    },
    create: {
      id: "default",
      damageApprovalCapSar: 200.00,
      maxSlaHours: 48,
      vatNumber: "310482917400003",
      crNumber: "1010684920",
    },
  });
  console.log(`- SystemConfig ready: SAR ${config.damageApprovalCapSar} cap, ${config.maxSlaHours}h SLA`);

  // 4. Seed clean primary admin with hashed password
  const initialPassword = "RushCare@2026!";
  const passwordHash = bcrypt.hashSync(initialPassword, 10);

  const admin = await prisma.staffUser.create({
    data: {
      name: "RUSH Administrator",
      email: "admin@rush.com.sa",
      phone: "0500000000",
      passwordHash,
      role: StaffRole.BUSINESS_OWNER,
      branch: "All Branches",
      active: true,
    },
  });

  console.log(`\n=== Initial Clean Admin Created ===`);
  console.log(`Name: ${admin.name}`);
  console.log(`Email: ${admin.email}`);
  console.log(`Role: ${admin.role}`);
  console.log(`Branch: ${admin.branch}`);
  console.log(`Password: ${initialPassword}`);
  console.log(`Database is 100% clean and ready for scratch testing!`);
}

main()
  .catch((e) => {
    console.error("Error purging demo data:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
