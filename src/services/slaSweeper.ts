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

  if (!overdue.length) return { flagged: 0 };

  const ids = overdue.map((t) => t.id);
  const updated = await prisma.complaint.updateMany({
    where: { id: { in: ids }, slaBreachedNotified: false },
    data: { slaBreached: true, slaBreachedNotified: true },
  });
  if (updated.count > 0) {
    await Promise.all(
      ids.map((id) =>
        prisma.auditLog.create({
          data: {
            complaintId: id,
            actorName: "SLA Monitor",
            action: "SLA_BREACH_AUTO",
            details: `Ticket exceeded ${maxSlaHours}h SLA threshold`,
          },
        })
      )
    );
  }
  return { flagged: updated.count };
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
