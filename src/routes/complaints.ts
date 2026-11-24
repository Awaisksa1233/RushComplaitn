import crypto from "crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient, ComplaintType, StaffRole, MessageChannel, TicketStatus, PayoutStatus, Prisma } from "@prisma/client";
import { AuthedRequest, requireCustomerJwt, ownsTicket, signCustomerToken } from "../middleware/auth";
import { normalizePlate, normalizePhone, isSaudiMobile, isSafeFileUrl } from "../utils/normalize";
import { encryptField, decryptField, maskIban, cleanFileUrl, signFileUrl } from "../utils/crypto";
import { ALLOWED_SITES, WHATSAPP_WEBHOOK_SECRET, CHATWOOT_WEBHOOK_SECRET } from "../config/env";
import { asyncHandler } from "../utils/asyncHandler";
import { trackLimiter, webhookLimiter } from "../middleware/security";
import { findCustomerInMongo, getWashesFromMongo, getOrdersFromMongo } from "../services/mongo";
import { syncComplaintToChatwoot, forwardCustomerMessageToChatwoot } from "../services/chatwoot";
import { uploadFile, sniffMatches } from "../services/storage";
import { invalidateClaimsCache } from "./admin";

const safeUrl = z.string().refine(isSafeFileUrl, "Invalid file reference");

/** Saudi IBAN: SA + 22 digits, ISO 7064 mod-97 check. */
export function isValidSaIban(iban: string): boolean {
  if (!/^SA\d{22}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** Customer-safe projection of a ticket. Never exposes INTERNAL messages, audit logs or full bank details. */
function ticketDto(t: any, full: boolean) {
  const base = {
    id: t.id,
    type: t.type,
    status: t.status,
    resolutionStatus: t.resolutionStatus,
    site: t.site,
    createdAt: t.createdAt,
    customer: t.customer
      ? { name: t.customer.name, licensePlate: t.customer.licensePlate, vehicleModel: t.customer.vehicleModel, phone: t.customer.phone }
      : undefined,
  };
  if (!full) return base;
  const holderPlain = decryptField(t.accountHolder);
  return {
    ...base,
    resolutionNote: t.resolutionNote,
    posRecordId: t.posRecordId,
    posRecordLabel: t.posRecordLabel,
    vehicleZones: t.vehicleZones,
    summary: t.summary,
    rewashCode: t.rewashCode,
    rrn: t.rrn,
    transferRef: t.transferRef,
    payoutStatus: t.payoutStatus,
    requestedAmount: t.requestedAmount != null ? Number(t.requestedAmount) : null,
    approvedAmount: t.approvedAmount != null ? Number(t.approvedAmount) : null,
    quotedAmount: t.quotedAmount != null ? Number(t.quotedAmount) : null,
    quotationUrl: signFileUrl(t.quotationUrl),
    waiverSigned: t.waiverSigned,
    quotationApproved: t.quotationApproved,
    invoiceUrl: signFileUrl(t.invoiceUrl),
    bankName: t.bankName,
    accountHolder: holderPlain ? "•••• " + String(holderPlain).slice(-3) : null,
    iban: t.iban ? maskIban(t.iban) : null,
    csatRating: t.csatRating,
    mediaUrls: (t.mediaUrls || []).map((u: string) => signFileUrl(u) || u),
  };
}

export function createComplaintsRouter(prisma: PrismaClient) {
  const router = Router();

  async function loadOwnedTicket(req: AuthedRequest, res: Response, requireType?: ComplaintType) {
    const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    // 404 for both missing and foreign tickets so ticket IDs cannot be enumerated
    if (!ticket || !ownsTicket(req, ticket) || (requireType && ticket.type !== requireType)) {
      res.status(404).json({ error: "Ticket not found" });
      return null;
    }
    return ticket;
  }

  async function recordBelongsToCustomer(req: AuthedRequest, type: string, recordId: string): Promise<boolean> {
    const customerId = req.customer!.customerId;
    if (type === "BILLING_REFUND") {
      if (await prisma.posOrder.findFirst({ where: { id: recordId, customerId }, select: { id: true } })) return true;
    } else if (await prisma.washVisit.findFirst({ where: { id: recordId, customerId }, select: { id: true } })) {
      return true;
    }
    const { licensePlate, phone } = req.customer!;
    const mc = await findCustomerInMongo(licensePlate, phone);
    if (!mc) return false;
    const recs = type === "BILLING_REFUND"
      ? await getOrdersFromMongo(licensePlate, mc.mongoCustomerId, 10)
      : await getWashesFromMongo(licensePlate, mc.mongoCustomerId, 7, 3);
    return recs.some((r: any) => r.id === recordId);
  }

  // 1. Submit New Complaint
  router.post("/", requireCustomerJwt, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const schema = z.object({
      type: z.enum(["UNSATISFIED", "BILLING_REFUND", "DAMAGE", "OTHER"]),
      posRecordId: z.string().min(1).max(60),
      posRecordLabel: z.string().min(1).max(200),
      site: z.string().min(1).max(100),
      summary: z.string().min(3).max(2000),
      callbackWindow: z.string().max(50).default("Anytime"),
      qualityTags: z.array(z.string().max(60)).max(20).default([]),
      vehicleZones: z.array(z.string().max(60)).max(20).default([]),
      billingReason: z.string().max(120).optional(),
      requestedAmount: z.number().nonnegative().max(100000).optional(),
      cardLast4: z.string().regex(/^\d{4}$/, "Must be exactly 4 digits").optional(),
      bankSmsText: z.string().max(2000).optional(),
      bankSmsUrl: safeUrl.optional(),
      mediaUrls: z.array(safeUrl).max(10).default([]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const data = parsed.data;
    const customerId = req.customer!.customerId;
    const site = ALLOWED_SITES.includes(data.site) ? data.site : ALLOWED_SITES[0];

    if (data.posRecordId === "ORD-UNLISTED") {
      if (data.type !== "BILLING_REFUND") {
        return res.status(400).json({ error: "Unlisted orders are only valid for billing disputes." });
      }
      if (!data.cardLast4 || (!data.bankSmsUrl && !data.bankSmsText)) {
        return res.status(400).json({
          error: "Card last 4 digits and Bank SMS proof are required for unlisted orders.",
        });
      }
      const recentUnlisted = await prisma.complaint.count({
        where: { customerId, posRecordId: "ORD-UNLISTED", createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } },
      });
      if (recentUnlisted >= 2) {
        return res.status(429).json({ error: "Daily limit for unlisted-order claims reached." });
      }
    } else if (data.posRecordId === "VISIT-GENERAL") {
      if (data.type !== "OTHER") {
        return res.status(400).json({ error: "General visit selection is only valid for Other inquiries." });
      }
      const recentGeneral = await prisma.complaint.count({
        where: { customerId, posRecordId: "VISIT-GENERAL", createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } },
      });
      if (recentGeneral >= 3) {
        return res.status(429).json({ error: "Daily limit for general inquiries reached." });
      }
    } else if (data.posRecordId === "VISIT-UNLISTED") {
      if (data.type === "BILLING_REFUND") {
        return res.status(400).json({ error: "Use ORD-UNLISTED for unlisted billing orders." });
      }
      const recentUnlistedVisit = await prisma.complaint.count({
        where: { customerId, posRecordId: "VISIT-UNLISTED", createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } },
      });
      if (recentUnlistedVisit >= 2) {
        return res.status(429).json({ error: "Daily limit for unlisted-visit claims reached." });
      }
    } else {
      if (!(await recordBelongsToCustomer(req, data.type, data.posRecordId))) {
        return res.status(400).json({ error: "The selected visit/order was not found on your account." });
      }
      const dup = await prisma.complaint.findFirst({
        where: { customerId, posRecordId: data.posRecordId },
      });
      if (dup) {
        return res.status(409).json({
          error: "A complaint has already been submitted for this visit.",
          ticketId: dup.id,
        });
      }
    }

    const assignedRole: StaffRole =
      data.type === ComplaintType.DAMAGE ? StaffRole.OPS_MANAGER : StaffRole.ADMIN;

    // Collision-safe sequential ticket IDs (retry on unique violation instead of trusting count())
    for (let attempt = 0; attempt < 8; attempt++) {
      const count = await prisma.complaint.count();
      const ticketId = `C-${1043 + count + attempt}`;
      try {
        const complaint = await prisma.complaint.create({
          data: {
            id: ticketId,
            customerId,
            type: data.type as ComplaintType,
            assignedRole,
            site,
            posRecordId: data.posRecordId,
            posRecordLabel: data.posRecordLabel,
            summary: data.summary,
            callbackWindow: data.callbackWindow,
            qualityTags: data.qualityTags,
            vehicleZones: data.vehicleZones,
            billingReason: data.billingReason,
            requestedAmount: data.requestedAmount,
            cardLast4: data.cardLast4,
            bankSmsText: data.bankSmsText,
            bankSmsUrl: cleanFileUrl(data.bankSmsUrl) ?? undefined,
            mediaUrls: data.mediaUrls.map((u) => cleanFileUrl(u) || u),
            messages: {
              create: { sender: "Customer", channel: MessageChannel.WEB_PORTAL, body: data.summary },
            },
          },
          include: { messages: true, customer: true },
        });

        invalidateClaimsCache();

        // Asynchronously sync ticket with Chatwoot & send customer confirmation WhatsApp
        syncComplaintToChatwoot(complaint).catch((err) => {
          console.warn("[Complaints] Chatwoot sync failed for #" + complaint.id, err);
        });

        // Issue a ticket-scoped token so the customer can follow up without a new OTP
        const trackToken = signCustomerToken(
          { customerId, phone: req.customer!.phone, licensePlate: req.customer!.licensePlate, scope: "track", ticketIds: [complaint.id] },
          "2h"
        );
        return res.status(201).json({ ...ticketDto(complaint, true), cardLast4: complaint.cardLast4, trackToken });
      } catch (e: any) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    return res.status(503).json({ error: "Could not allocate a ticket number, please retry." });
  }));

  // 2. Track Complaint
  //    Ticket-ID lookup (+ phone) -> full customer-safe view and a ticket-scoped token.
  //    Plate lookup (+ phone) -> status summary only (plate/phone are weak secrets).
  router.post("/track", trackLimiter, asyncHandler(async (req, res) => {
    const parsed = z
      .object({ query: z.string().min(2).max(30), phone: z.string().min(9).max(20) })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid lookup fields" });
    }

    const rawQuery = parsed.data.query.trim().toUpperCase();
    const qPlate = normalizePlate(rawQuery);
    const phone = normalizePhone(parsed.data.phone);
    const NOT_FOUND = { error: "No matching complaint found for these credentials." };
    if (!isSaudiMobile(phone)) return res.status(404).json(NOT_FOUND);

    const byId = /^C-\d+$/.test(rawQuery);
    const tickets = await prisma.complaint.findMany({
      where: {
        customer: { phone },
        ...(byId ? { id: rawQuery } : { customer: { phone, licensePlate: qPlate } }),
      },
      include: {
        customer: { select: { name: true, licensePlate: true, vehicleModel: true, phone: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (!tickets.length) {
      return res.status(404).json(NOT_FOUND);
    }

    const cfg = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    let trackToken: string | undefined;
    if (byId) {
      const t = tickets[0] as any;
      const cust = await prisma.customer.findUnique({ where: { id: t.customerId } });
      if (cust) {
        trackToken = signCustomerToken(
          { customerId: cust.id, phone: cust.phone, licensePlate: cust.licensePlate, scope: "track", ticketIds: tickets.map((x) => x.id) },
          "2h"
        );
      }
    }

    return res.json({
      rushTaxDetails: {
        companyName: cfg?.companyName || process.env.RUSH_TAX_COMPANY || "شركة رَش للتجارة المتقدمة",
        vatNumber: cfg?.vatNumber || process.env.RUSH_VAT_NUMBER || "311949083200003",
        crNumber: cfg?.crNumber || process.env.RUSH_CR_NUMBER || "1011154912",
        unifiedNationalNumber: cfg?.unifiedNationalNumber || process.env.RUSH_UNIFIED_NUMBER || "7037475576",
        whatsappNumber: cfg?.whatsappNumber || process.env.RUSH_WHATSAPP_NUMBER || "966503444958",
        address: process.env.RUSH_TAX_ADDRESS,
      },
      limited: !byId,
      trackToken,
      tickets: tickets.map((t) => ticketDto(t, byId)),
    });
  }));

  // 2.1 Direct 1-Click Ticket Access (via signed ?t= JWT sent in WhatsApp)
  router.get("/direct", requireCustomerJwt, asyncHandler(async (req: AuthedRequest, res) => {
    const c = req.customer!;
    const tickets = await prisma.complaint.findMany({
      where: {
        customerId: c.customerId,
        ...(c.scope === "track" && c.ticketIds?.length ? { id: { in: c.ticketIds } } : {}),
      },
      include: {
        customer: { select: { name: true, licensePlate: true, vehicleModel: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (!tickets.length) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const cfg = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    return res.json({
      rushTaxDetails: {
        companyName: cfg?.companyName || process.env.RUSH_TAX_COMPANY || "شركة رَش للتجارة المتقدمة",
        vatNumber: cfg?.vatNumber || process.env.RUSH_VAT_NUMBER || "311949083200003",
        crNumber: cfg?.crNumber || process.env.RUSH_CR_NUMBER || "1011154912",
        unifiedNationalNumber: cfg?.unifiedNationalNumber || process.env.RUSH_UNIFIED_NUMBER || "7037475576",
        whatsappNumber: cfg?.whatsappNumber || process.env.RUSH_WHATSAPP_NUMBER || "966503444958",
        address: process.env.RUSH_TAX_ADDRESS,
      },
      limited: false,
      tickets: tickets.map((t) => ticketDto(t, true)),
    });
  }));

  // 2.5 Damage Document Quick-Upload (Quotation / Invoice) — owner only, and only in the right phase
  router.post("/:id/damage/upload-doc", requireCustomerJwt, asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z.object({ field: z.enum(["quotationUrl", "invoiceUrl"]), url: safeUrl }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const ticket = await loadOwnedTicket(req, res, ComplaintType.DAMAGE);
    if (!ticket) return;
    if (ticket.status === TicketStatus.RESOLVED || ticket.payoutStatus === PayoutStatus.PAID) {
      return res.status(409).json({ error: "This ticket is closed." });
    }

    if (parsed.data.field === "quotationUrl") {
      if (ticket.quotationApproved) {
        return res.status(409).json({ error: "Quotation already approved; it can no longer be replaced." });
      }
    } else if (!ticket.quotationApproved) {
      return res.status(403).json({ error: "Invoice upload is unlocked only after the quotation is approved." });
    }

    const cleanDocUrl = cleanFileUrl(parsed.data.url) || parsed.data.url;
    const updated = await prisma.complaint.update({
      where: { id: ticket.id },
      data: {
        [parsed.data.field]: cleanDocUrl,
        ...(parsed.data.field === "quotationUrl" ? { payoutStatus: PayoutStatus.AWAITING_QUOTE_APPROVAL } : {}),
      },
      include: { customer: true, messages: true },
    });
    invalidateClaimsCache();
    return res.json({ success: true, ticket: ticketDto(updated, true) });
  }));

  // 3. Damage Step 1: Upload Quotation + Sign Waiver
  router.post("/:id/damage/step1", requireCustomerJwt, asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        quotationUrl: safeUrl,
        waiverSignature: z.string().max(300000).optional().default("DIGITALLY_SIGNED_ON_PORTAL"),
        quotedAmount: z.number().positive().max(100000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Valid quotation reference required" });

    const ticket = await loadOwnedTicket(req, res, ComplaintType.DAMAGE);
    if (!ticket) return;
    if (ticket.quotationApproved || ticket.status === TicketStatus.RESOLVED) {
      return res.status(409).json({ error: "Quotation can no longer be changed for this ticket." });
    }

    let storedSignature = parsed.data.waiverSignature;
    const dataUrlMatch = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(storedSignature);
    if (dataUrlMatch) {
      const mime = dataUrlMatch[1];
      const buf = Buffer.from(dataUrlMatch[2], "base64");
      if (buf.length > 0 && buf.length <= 2 * 1024 * 1024 && sniffMatches(buf, mime)) {
        storedSignature = await uploadFile(buf, mime, "signatures");
      } else {
        storedSignature = "DIGITALLY_SIGNED_ON_PORTAL";
      }
    }

    const updated = await prisma.complaint.update({
      where: { id: ticket.id },
      data: {
        quotationUrl: cleanFileUrl(parsed.data.quotationUrl) || parsed.data.quotationUrl,
        waiverSigned: true,
        waiverSignature: storedSignature,
        quotationApproved: false,
        payoutStatus: PayoutStatus.AWAITING_QUOTE_APPROVAL,
        ...(parsed.data.quotedAmount !== undefined ? { quotedAmount: parsed.data.quotedAmount } : {}),
      },
      include: { customer: true, messages: true },
    });

    invalidateClaimsCache();
    return res.json({
      ticket: ticketDto(updated, true),
      notice:
        "Uploading a quotation does not constitute payout approval. Final payout is strictly based on verified tax invoice and management discretion.",
    });
  }));

  // 4. Damage Step 2: Upload Tax Invoice + Saudi IBAN (Gated by quotationApproved === true)
  router.post("/:id/damage/step2", requireCustomerJwt, asyncHandler(async (req: AuthedRequest, res) => {
    const ticket = await loadOwnedTicket(req, res, ComplaintType.DAMAGE);
    if (!ticket) return;

    if (!ticket.quotationApproved) {
      return res.status(403).json({
        error:
          "Management must review and approve your repair quotation before uploading the tax invoice and bank IBAN.",
      });
    }
    // Bank details are write-once: once submitted they can only be changed by staff.
    if (ticket.iban || ticket.status === TicketStatus.PENDING_PAYOUT || ticket.status === TicketStatus.RESOLVED) {
      return res.status(409).json({ error: "Bank details were already submitted. Contact customer care to change them." });
    }

    const parsed = z
      .object({
        invoiceUrl: safeUrl,
        bankName: z.string().min(2).max(80),
        accountHolder: z.string().min(2).max(120),
        iban: z.string().transform((v) => v.replace(/\s+/g, "").toUpperCase())
          .refine(isValidSaIban, "Must be a valid Saudi IBAN (SA + 22 digits, valid checksum)"),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const updated = await prisma.complaint.update({
      where: { id: ticket.id },
      data: {
        invoiceUrl: cleanFileUrl(parsed.data.invoiceUrl) || parsed.data.invoiceUrl,
        bankName: parsed.data.bankName,
        accountHolder: encryptField(parsed.data.accountHolder),
        iban: encryptField(parsed.data.iban),
        status: TicketStatus.PENDING_PAYOUT,
        payoutStatus: PayoutStatus.PENDING_BANK_TRANSFER,
        messages: {
          create: {
            sender: "Customer",
            channel: MessageChannel.WEB_PORTAL,
            body: `Submitted Tax Invoice & Bank Details (${parsed.data.bankName} · ${maskIban(parsed.data.iban)}).`,
          },
        },
      },
      include: { messages: true, customer: true },
    });

    invalidateClaimsCache();
    return res.json(ticketDto(updated, true));
  }));

  // 5. Customer message (synced to ticket timeline)
  router.post("/:id/whatsapp", requireCustomerJwt, asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z.object({ body: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Message body required (max 2000 chars)" });

    const ticket = await loadOwnedTicket(req, res);
    if (!ticket) return;

    const msg = await prisma.message.create({
      data: { complaintId: ticket.id, sender: "Customer", channel: MessageChannel.WHATSAPP, body: parsed.data.body },
    });
    invalidateClaimsCache();

    // Forward customer reply into Chatwoot conversation
    forwardCustomerMessageToChatwoot({
      ticketId: ticket.id,
      phone: req.customer!.phone,
      text: parsed.data.body,
    }).catch((err) => {
      console.warn("[Complaints] Failed to forward customer message to Chatwoot:", err);
    });

    return res.status(201).json({ id: msg.id, sender: msg.sender, channel: msg.channel, body: msg.body, createdAt: msg.createdAt });
  }));

  // 6. Chatwoot Incoming Event Webhook
  router.post("/webhooks/chatwoot", webhookLimiter, asyncHandler(async (req: Request, res) => {
    if (!CHATWOOT_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "Webhook not configured" });
    }
    const raw: Buffer | undefined = (req as any).rawBody;
    const sigHeader = String(req.headers["x-chatwoot-signature"] || req.headers["x-hub-signature-256"] || "").replace(/^sha256=/, "");
    const queryToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
    const tokenHeader = String(
      req.headers["x-chatwoot-webhook-token"] ||
      req.headers["x-webhook-secret"] ||
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
      queryToken
    ).trim();
    const expectedHmac = raw ? crypto.createHmac("sha256", CHATWOOT_WEBHOOK_SECRET).update(raw).digest("hex") : "";
    const sigValid = Boolean(
      raw &&
      sigHeader.length === expectedHmac.length &&
      expectedHmac.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expectedHmac))
    );
    const tokenValid = Boolean(
      tokenHeader.length === CHATWOOT_WEBHOOK_SECRET.length &&
      CHATWOOT_WEBHOOK_SECRET.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(tokenHeader), Buffer.from(CHATWOOT_WEBHOOK_SECRET))
    );
    if (!sigValid && !tokenValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    try {
      const event = req.body;
      const msgType = event?.message_type;
      const isIncoming = msgType === "incoming" || msgType === 0;
      const isOutgoing = msgType === "outgoing" || msgType === 1;

      if (event?.event === "message_created" && (isIncoming || isOutgoing) && !event?.private) {
        const bodyText = typeof event?.content === "string" ? event.content.trim() : "";
        if (!bodyText) return res.status(200).json({ ok: true });

        const rawSenderPhone =
          event?.sender?.phone_number ||
          event?.conversation?.meta?.sender?.phone_number ||
          "";
        const normSenderPhone = normalizePhone(String(rawSenderPhone));
        const senderName = event?.sender?.name || (isIncoming ? "Customer" : "Customer Care");

        // 1. Resolve ticket by conversation custom_attributes.ticket_code
        let ticket = null;
        const attrTicketId = event?.conversation?.custom_attributes?.ticket_code;
        if (typeof attrTicketId === "string" && attrTicketId.trim()) {
          ticket = await prisma.complaint.findUnique({ where: { id: attrTicketId.trim().toUpperCase() } });
        }

        // 2. Fallback: extract explicit C-\d+ ticket ID from message text (verified against sender phone if available)
        if (!ticket) {
          const match = bodyText.match(/\b(C-\d+)\b/i);
          if (match) {
            const candidate = await prisma.complaint.findUnique({
              where: { id: match[1].toUpperCase() },
              include: { customer: { select: { phone: true } } },
            });
            if (candidate && (!isSaudiMobile(normSenderPhone) || candidate.customer?.phone === normSenderPhone)) {
              ticket = candidate;
            }
          }
        }

        // 3. Fallback: match latest open (or most recent) ticket for sender's phone
        if (!ticket && isSaudiMobile(normSenderPhone)) {
          ticket =
            (await prisma.complaint.findFirst({
              where: { customer: { phone: normSenderPhone }, status: { not: TicketStatus.RESOLVED } },
              orderBy: { createdAt: "desc" },
            })) ||
            (await prisma.complaint.findFirst({
              where: { customer: { phone: normSenderPhone } },
              orderBy: { createdAt: "desc" },
            }));
        }

        if (ticket) {
          const externalId = event?.id ? `cw_${event.id}` : undefined;
          if (externalId) {
            const seen = await prisma.message.findFirst({ where: { externalId } });
            if (seen) return res.status(200).json({ ok: true, duplicate: true });
          }
          if (isOutgoing) {
            const recentSame = await prisma.message.findFirst({
              where: {
                complaintId: ticket.id,
                body: bodyText,
                createdAt: { gt: new Date(Date.now() - 30 * 1000) },
              },
            });
            if (recentSame) return res.status(200).json({ ok: true, duplicate: true });
          }

          await prisma.message.create({
            data: {
              complaintId: ticket.id,
              sender: senderName,
              channel: MessageChannel.WHATSAPP,
              body: bodyText,
              externalId,
            },
          });
          invalidateClaimsCache();
          console.log(`[Chatwoot Webhook] Synced ${isIncoming ? "inbound customer" : "agent"} message to ticket #${ticket.id}`);
        }
      }
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.warn("[Chatwoot Webhook] Error processing event:", err?.message || err);
      return res.status(200).json({ ok: false });
    }
  }));

  // 6. WhatsApp Webhook — HMAC-SHA256 signed (header: x-hub-signature-256 = sha256=<hex of raw body>)
  router.post("/webhooks/whatsapp", webhookLimiter, asyncHandler(async (req: Request, res) => {
    if (!WHATSAPP_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "Webhook not configured" });
    }
    const raw: Buffer | undefined = (req as any).rawBody;
    const sig = String(req.headers["x-hub-signature-256"] || "").replace(/^sha256=/, "");
    const expected = raw ? crypto.createHmac("sha256", WHATSAPP_WEBHOOK_SECRET).update(raw).digest("hex") : "";
    if (!raw || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const parsed = z
      .object({
        ticketId: z.string().max(30),
        sender: z.string().max(80).default("Customer Care"),
        body: z.string().min(1).max(4000),
        externalId: z.string().max(120).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid webhook payload" });

    const ticket = await prisma.complaint.findUnique({ where: { id: parsed.data.ticketId } });
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    if (parsed.data.externalId) {
      const seen = await prisma.message.findFirst({ where: { externalId: parsed.data.externalId } });
      if (seen) return res.status(200).json({ id: seen.id, duplicate: true });
    }

    const msg = await prisma.message.create({
      data: {
        complaintId: ticket.id,
        sender: parsed.data.sender,
        channel: MessageChannel.WHATSAPP,
        body: parsed.data.body,
        externalId: parsed.data.externalId,
      },
    });
    invalidateClaimsCache();
    return res.status(201).json({ id: msg.id });
  }));

  // 7. CSAT Rating (resolved tickets only, once)
  router.post("/:id/csat", requireCustomerJwt, asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z.object({ rating: z.number().int().min(1).max(5) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Rating must be an integer between 1 and 5" });

    const ticket = await loadOwnedTicket(req, res);
    if (!ticket) return;

    if (ticket.status !== TicketStatus.RESOLVED) {
      return res.status(400).json({ error: "CSAT can only be submitted on resolved tickets." });
    }
    if (ticket.csatRating != null) {
      return res.status(409).json({ error: "Rating already submitted." });
    }

    const updated = await prisma.complaint.update({
      where: { id: ticket.id },
      data: { csatRating: parsed.data.rating },
      include: { customer: true, messages: true },
    });
    invalidateClaimsCache();
    return res.json(ticketDto(updated, true));
  }));

  return router;
}
