import { PrismaClient, PayoutStatus, TicketStatus } from "@prisma/client";
import { RETENTION } from "../config/env";
import { deleteFiles } from "./storage";

const DAY = 24 * 3600 * 1000;

export interface RetentionResult {
  otpDeleted: number;
  bankDetailsCleared: number;
  ticketsAnonymised: number;
  customersAnonymised: number;
}

/**
 * Data-retention policy (configurable via RETENTION_* env vars):
 *  - OTP sessions: deleted after RETENTION_OTP_HOURS (default 24h)
 *  - Bank details (IBAN/holder/bank/invoice ref): cleared RETENTION_BANK_DAYS (default 90) after payout/closure
 *  - Resolved tickets older than RETENTION_TICKET_DAYS (default 730): personal content scrubbed,
 *    customer record anonymised. Audit rows are kept but contain no raw bank data.
 */
export async function runRetention(prisma: PrismaClient, now = new Date()): Promise<RetentionResult> {
  const otp = await prisma.otpSession.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - RETENTION.otpHours * 3600 * 1000) } },
  });

  const bankWhere = {
    iban: { not: null },
    updatedAt: { lt: new Date(now.getTime() - RETENTION.bankDetailsDaysAfterPaid * DAY) },
    OR: [{ payoutStatus: PayoutStatus.PAID }, { payoutStatus: PayoutStatus.DECLINED }, { status: TicketStatus.RESOLVED }],
  };
  const bankDocs = await prisma.complaint.findMany({
    where: bankWhere,
    select: { invoiceUrl: true, quotationUrl: true, bankSmsUrl: true },
  });
  if (bankDocs.length) {
    await deleteFiles(bankDocs.flatMap((d) => [d.invoiceUrl, d.quotationUrl, d.bankSmsUrl]));
  }
  const bank = await prisma.complaint.updateMany({
    where: bankWhere,
    data: { iban: null, accountHolder: null, bankName: null, invoiceUrl: null, quotationUrl: null, bankSmsText: null, bankSmsUrl: null, cardLast4: null, waiverSignature: null },
  });

  const cutoff = new Date(now.getTime() - RETENTION.anonymiseTicketsAfterDays * DAY);
  const old = await prisma.complaint.findMany({
    where: { status: TicketStatus.RESOLVED, updatedAt: { lt: cutoff } },
    select: { id: true, customerId: true, mediaUrls: true, invoiceUrl: true, quotationUrl: true, bankSmsUrl: true },
  });
  let tickets = 0;
  if (old.length) {
    await deleteFiles(old.flatMap((o) => [...(o.mediaUrls || []), o.invoiceUrl, o.quotationUrl, o.bankSmsUrl]));
    const ids = old.map((o) => o.id);
    const r = await prisma.complaint.updateMany({
      where: { id: { in: ids } },
      data: {
        summary: "[removed per retention policy]",
        mediaUrls: [],
        resolutionNote: null,
        iban: null,
        accountHolder: null,
        bankName: null,
        invoiceUrl: null,
        quotationUrl: null,
        bankSmsText: null,
        bankSmsUrl: null,
        cardLast4: null,
        waiverSignature: null,
      },
    });
    await prisma.message.deleteMany({ where: { complaintId: { in: ids } } });
    tickets = r.count;
  }
  let customers = 0;
  for (const cid of Array.from(new Set(old.map((o) => o.customerId)))) {
    const live = await prisma.complaint.count({ where: { customerId: cid, OR: [{ status: { not: TicketStatus.RESOLVED } }, { updatedAt: { gte: cutoff } }] } });
    if (!live) {
      await anonymiseCustomer(prisma, cid);
      customers++;
    }
  }
  return { otpDeleted: otp.count, bankDetailsCleared: bank.count, ticketsAnonymised: tickets, customersAnonymised: customers };
}

/** PDPL erasure: scrub identifying fields but keep the row so financial/audit references stay intact. */
export async function anonymiseCustomer(prisma: PrismaClient, customerId: string) {
  const c = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!c) return false;
  await prisma.customer.update({
    where: { id: customerId },
    data: { name: "Anonymised", email: null, phone: `0${customerId.slice(-8)}`, licensePlate: `ANON-${customerId.slice(-8)}`, vehicleModel: "—" },
  });
  await prisma.otpSession.deleteMany({ where: { phone: c.phone } });
  return true;
}

export async function exportCustomerData(prisma: PrismaClient, customerId: string) {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { washes: true, orders: true, complaints: { include: { messages: { where: { channel: { not: "INTERNAL" } } } } } },
  });
  if (!c) return null;
  // Bank fields are deliberately excluded from exports; they're write-only secrets.
  return {
    ...c,
    complaints: c.complaints.map(({ iban, accountHolder, bankName, waiverSignature, ...rest }) => ({ ...rest, bankDetailsOnFile: Boolean(iban) })),
  };
}

export function startRetentionScheduler(prisma: PrismaClient) {
  const run = () =>
    runRetention(prisma)
      .then((r) => console.log("[retention]", JSON.stringify(r)))
      .catch((e) => console.error("[retention] failed:", e?.message));
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 3600 * 1000).unref();
}
