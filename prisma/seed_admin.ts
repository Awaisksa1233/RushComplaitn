import dotenv from "dotenv";
dotenv.config();

import { PrismaClient, StaffRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Admin SystemConfig & StaffUsers into Supabase...");

  // 1. SystemConfig
  const config = await prisma.systemConfig.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      damageApprovalCapSar: 200.00,
      maxSlaHours: 48,
      vatNumber: "310482917400003",
      crNumber: "1010684920",
    },
  });
  console.log("SystemConfig ready:", config);

  // 2. Staff Directory
  const staff = [
    {
      name: "Muhammad Awais",
      email: "awais@rush.com.sa",
      phone: "0500000001",
      role: StaffRole.BUSINESS_OWNER,
      branch: "All Branches",
    },
    {
      name: "Sara Al-Qahtani",
      email: "sara@rush.com.sa",
      phone: "0500000002",
      role: StaffRole.ADMIN,
      branch: "All Branches",
    },
    {
      name: "Faisal Al-Harbi",
      email: "faisal@rush.com.sa",
      phone: "0500000003",
      role: StaffRole.OPS_MANAGER,
      branch: "RUSH Al Kharj",
    },
    {
      name: "Omar Al-Dosari",
      email: "omar@rush.com.sa",
      phone: "0500000004",
      role: StaffRole.CSM,
      branch: "All Branches",
    },
  ];

  for (const s of staff) {
    const user = await prisma.staffUser.upsert({
      where: { email: s.email },
      update: {
        name: s.name,
        role: s.role,
        branch: s.branch,
        active: true,
      },
      create: {
        name: s.name,
        email: s.email,
        phone: s.phone,
        role: s.role,
        branch: s.branch,
        active: true,
      },
    });
    console.log(`Staff ready: ${user.name} (${user.role} - ${user.branch})`);
  }

  // 3. Update existing complaints with staff name if missing
  const complaints = await prisma.complaint.findMany();
  for (const c of complaints) {
    let staffName = c.assignedStaffName;
    if (!staffName) {
      if (c.assignedRole === "OPS_MANAGER") staffName = "Faisal Al-Harbi";
      else if (c.assignedRole === "CSM") staffName = "Omar Al-Dosari";
      else if (c.assignedRole === "ADMIN") staffName = "Sara Al-Qahtani";
      else staffName = "Muhammad Awais";

      await prisma.complaint.update({
        where: { id: c.id },
        data: { assignedStaffName: staffName },
      });
    }
  }

  console.log("Admin seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("Error seeding admin data:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
