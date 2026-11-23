import { PrismaClient, ResolutionStatus, TicketStatus, PayoutStatus, MessageChannel } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Updating C-1043 in Supabase...");
  const c = await prisma.complaint.findUnique({ where: { id: "C-1043" } });
  if (!c) {
    console.log("Ticket C-1043 not found");
    return;
  }

  const updated = await prisma.complaint.update({
    where: { id: "C-1043" },
    data: {
      resolutionStatus: ResolutionStatus.APPROVED,
      status: TicketStatus.INVESTIGATING,
      payoutStatus: PayoutStatus.AWAITING_QUOTE_APPROVAL,
      resolutionNote: "Your damage claim has been approved for repair review. Please upload an official repair quotation and sign the liability waiver in your tracker below.",
      messages: {
        create: {
          sender: "RUSH Care",
          channel: MessageChannel.WHATSAPP,
          body: "Hi Awais, your damage claim C-1043 has been approved for repair review. Please open your tracker to upload the official repair quotation and sign the waiver: https://crm.rush.com.sa/",
        },
      },
      auditLogs: {
        create: {
          action: "REQUEST_DAMAGE_QUOTE",
          actorName: "RUSH Administrator",
          details: "Approved damage claim for repair quotation review and notified customer.",
        },
      },
    },
  });

  console.log("Updated C-1043:", {
    id: updated.id,
    resolutionStatus: updated.resolutionStatus,
    status: updated.status,
    payoutStatus: updated.payoutStatus,
    resolutionNote: updated.resolutionNote,
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
