import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const complaints = await prisma.complaint.findMany({
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { name: true, phone: true, licensePlate: true } } },
  });
  console.log(`Total complaints: ${complaints.length}`);
  for (const c of complaints) {
    console.log(
      `${c.id} | type=${c.type} | status=${c.status} | site=${c.site} | role=${c.assignedRole} | plate=${c.customer?.licensePlate} | quote=${Boolean(c.quotationUrl)} | waiver=${c.waiverSigned} | created=${c.createdAt.toISOString()}`
    );
  }

  const staff = await prisma.staffUser.findMany({
    select: { email: true, role: true, branch: true, active: true },
  });
  console.log(`\nStaff users (${staff.length}):`);
  for (const s of staff) {
    console.log(`${s.email} | role=${s.role} | branch=${s.branch} | active=${s.active}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
