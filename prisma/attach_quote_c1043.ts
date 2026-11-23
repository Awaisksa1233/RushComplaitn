import { PrismaClient, PayoutStatus, MessageChannel } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Attaching uploaded quotation to C-1043 in Supabase...");
  const c = await prisma.complaint.findUnique({ where: { id: "C-1043" } });
  if (!c) {
    console.log("Ticket C-1043 not found");
    return;
  }

  const updated = await prisma.complaint.update({
    where: { id: "C-1043" },
    data: {
      quotationUrl: "/api/files/media/1795429399419-sickLeaves.pdf",
      waiverSigned: true,
      waiverSignature: "DIGITALLY_SIGNED_ON_PORTAL",
      payoutStatus: PayoutStatus.AWAITING_QUOTE_APPROVAL,
      messages: {
        create: {
          sender: "Customer",
          channel: MessageChannel.WEB_PORTAL,
          body: "Uploaded repair quotation (sickLeaves.pdf) and signed customer liability waiver.",
        },
      },
      auditLogs: {
        create: {
          action: "UPLOAD_DAMAGE_QUOTE",
          actorName: "Customer (Awais)",
          details: "Uploaded repair quotation: /api/files/media/1795429399419-sickLeaves.pdf and signed waiver.",
        },
      },
    },
  });

  console.log("Successfully updated C-1043:", {
    id: updated.id,
    quotationUrl: updated.quotationUrl,
    waiverSigned: updated.waiverSigned,
    payoutStatus: updated.payoutStatus,
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
