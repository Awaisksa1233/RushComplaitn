import { PrismaClient, TicketStatus } from "@prisma/client";

export async function runSlaSweep(prisma: PrismaClient, now = new Date()): Promise<{ flagged: number }> {
  const cfg = await prisma.systemConfig.findUnique({ where: { id: "default" } });
  const maxSlaHours = cfg?.maxSlaHours ?? 48;
  const cutoff = new Date(now.getTime() - maxSlaHours * 3600 * 1000);

  const overdue = await prisma.complaint.findMany({
    where: {
      status: { not: TicketStatus.RESOLVED },
      slaBreachedNotified: false,
      createdAt: { lt: cutoff },
    },
    select: { id: true },
    take: 200,
  });

  let flagged = 0;
  for (const t of overdue) {
    await prisma.complaint.update({
      where: { id: t.id },
      data: {
        slaBreached: true,
        slaBreachedNotified: true,
        auditLogs: {
          create: {
            actorName: "SLA Monitor",
            action: "SLA_BREACH_AUTO",
            details: `Ticket exceeded ${maxSlaHours}h SLA threshold`,
          },
        },
      },
    });
    flagged++;
  }
  return { flagged };
}

export function startSlaSweeper(prisma: PrismaClient) {
  const run = () =>
    runSlaSweep(prisma)
      .then((r) => {
        if (r.flagged > 0) console.log("[sla-sweeper]", JSON.stringify(r));
      })
      .catch((e) => console.error("[sla-sweeper] failed:", e?.message));
  setTimeout(run, 45_000).unref();
  setInterval(run, 15 * 60_000).unref();
}
