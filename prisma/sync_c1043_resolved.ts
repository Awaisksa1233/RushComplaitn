import { PrismaClient, TicketStatus, ResolutionStatus, PayoutStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Updating C-1043 status to RESOLVED...");
  const updated = await prisma.complaint.update({
    where: { id: "C-1043" },
    data: {
      status: TicketStatus.RESOLVED,
      resolutionStatus: ResolutionStatus.APPROVED,
      payoutStatus: PayoutStatus.PAID,
      transferRef: "sdfg",
      resolutionNote: "Bank transfer executed. Ref: sdfg. Logged by RUSH Administrator.",
    },
  });

  console.log("Updated C-1043:", {
    id: updated.id,
    status: updated.status,
    resolutionStatus: updated.resolutionStatus,
    payoutStatus: updated.payoutStatus,
    transferRef: updated.transferRef,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
