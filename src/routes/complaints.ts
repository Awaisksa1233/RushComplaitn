import { Router, Response } from "express";
import { z } from "zod";
import { PrismaClient, ComplaintType, StaffRole, MessageChannel, TicketStatus, PayoutStatus } from "@prisma/client";
import { AuthedRequest, requireCustomerJwt } from "../middleware/auth";
import { normalizePlate, normalizePhone } from "../utils/normalize";

export function createComplaintsRouter(prisma: PrismaClient) {
  const router = Router();

  // 1. Submit New Complaint
  router.post("/", requireCustomerJwt, async (req: AuthedRequest, res: Response) => {
    const schema = z.object({
      type: z.enum(["UNSATISFIED", "BILLING_REFUND", "DAMAGE", "OTHER"]),
      posRecordId: z.string().min(1),
      posRecordLabel: z.string().min(1),
      site: z.string().min(1),
      summary: z.string().min(3),
      callbackWindow: z.string().default("Anytime"),
      qualityTags: z.array(z.string()).default([]),
      vehicleZones: z.array(z.string()).default([]),
      billingReason: z.string().optional(),
      requestedAmount: z.number().nonnegative().optional(),
      cardLast4: z.string().regex(/^\d{4}$/, "Must be exactly 4 digits").optional(),
      bankSmsText: z.string().optional(),
      bankSmsUrl: z.string().optional(),
      mediaUrls: z.array(z.string()).default([]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const data = parsed.data;
    const customerId = req.customer!.customerId;

    // Unlisted POS order check
    if (data.posRecordId === "ORD-UNLISTED") {
      if (!data.cardLast4 || (!data.bankSmsUrl && !data.bankSmsText)) {
        return res.status(400).json({
          error: "Card last 4 digits and Bank SMS proof are required for unlisted orders.",
        });
      }
    } else {
      // Duplicate check for listed visit/order
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

    // Generate sequential ticket ID (C-1043, C-1044, ...)
    const count = await prisma.complaint.count();
    const ticketId = `C-${1043 + count}`;

    // Auto-routing assignment
    const assignedRole: StaffRole =
      data.type === ComplaintType.DAMAGE ? StaffRole.OPS_MANAGER : StaffRole.ADMIN;

    const complaint = await prisma.complaint.create({
      data: {
        id: ticketId,
        customerId,
        type: data.type as ComplaintType,
        assignedRole,
        site: data.site,
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
        bankSmsUrl: data.bankSmsUrl,
        mediaUrls: data.mediaUrls,
        messages: {
          create: {
            sender: "Customer",
            channel: MessageChannel.WEB_PORTAL,
            body: data.summary,
          },
        },
      },
      include: {
        messages: true,
      },
    });

    return res.status(201).json(complaint);
  });

  // 2. Track Complaint by Ticket ID or Plate + Phone
  router.post("/track", async (req, res) => {
    const parsed = z
      .object({
        query: z.string().min(2),
        phone: z.string().min(9),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid lookup fields" });
    }

    const rawQuery = parsed.data.query.trim().toUpperCase();
    const qPlate = normalizePlate(rawQuery);
    const phone = normalizePhone(parsed.data.phone);

    const tickets = await prisma.complaint.findMany({
      where: {
        customer: { phone },
        OR: [
          { id: rawQuery },
          { customer: { licensePlate: qPlate } },
        ],
      },
      include: {
        customer: {
          select: {
            name: true,
            licensePlate: true,
            vehicleModel: true,
            phone: true,
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!tickets.length) {
      return res.status(404).json({ error: "No matching complaint found for these credentials." });
    }

    return res.json({
      rushTaxDetails: {
        companyName: process.env.RUSH_TAX_COMPANY || "Rush Car Wash Operations Co.",
        vatNumber: process.env.RUSH_VAT_NUMBER || "310482917400003",
        crNumber: process.env.RUSH_CR_NUMBER || "1010684920",
        address: process.env.RUSH_TAX_ADDRESS || "Prince Muhammad Bin Salman Road, Al Kharj",
      },
      tickets,
    });
  });

  // 2.5 Damage Document Quick-Upload (Quotation / Invoice)
  router.post("/:id/damage/upload-doc", async (req, res) => {
    const schema = z.object({
      field: z.enum(["quotationUrl", "invoiceUrl"]),
      url: z.string().min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        [parsed.data.field]: parsed.data.url,
        ...(parsed.data.field === "quotationUrl" ? { payoutStatus: PayoutStatus.AWAITING_QUOTE_APPROVAL } : {}),
      },
    });

    return res.json({ success: true, ticket: updated });
  });

  // 3. Damage Step 1: Upload Quotation + Sign Waiver
  router.post("/:id/damage/step1", async (req, res) => {
    const parsed = z
      .object({
        quotationUrl: z.string().min(1),
        waiverSignature: z.string().optional().default("DIGITALLY_SIGNED_ON_PORTAL"),
        quotedAmount: z.number().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Quotation URL required" });
    }

    const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        quotationUrl: parsed.data.quotationUrl,
        waiverSigned: true,
        waiverSignature: parsed.data.waiverSignature || "DIGITALLY_SIGNED_ON_PORTAL",
        quotationApproved: false, // Strict: requires management review
        payoutStatus: PayoutStatus.AWAITING_QUOTE_APPROVAL,
        ...(parsed.data.quotedAmount !== undefined ? { quotedAmount: parsed.data.quotedAmount } : {}),
      },
    });

    return res.json({
      ticket: updated,
      notice:
        "Uploading a quotation does not constitute payout approval. Final payout is strictly based on verified tax invoice and management discretion.",
    });
  });

  // 4. Damage Step 2: Upload Tax Invoice + Saudi IBAN (Gated by quotationApproved === true)
  router.post("/:id/damage/step2", async (req, res) => {
    const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (!ticket.quotationApproved) {
      return res.status(403).json({
        error:
          "Management must review and approve your repair quotation before uploading the tax invoice and bank IBAN.",
      });
    }

    const parsed = z
      .object({
        invoiceUrl: z.string().min(1),
        bankName: z.string().min(2),
        accountHolder: z.string().min(2),
        iban: z.string().regex(/^SA\d{22}$/, "Must be a valid Saudi IBAN (SA + 22 digits)"),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const updated = await prisma.complaint.update({
      where: { id: ticket.id },
      data: {
        invoiceUrl: parsed.data.invoiceUrl,
        bankName: parsed.data.bankName,
        accountHolder: parsed.data.accountHolder,
        iban: parsed.data.iban,
        status: TicketStatus.PENDING_PAYOUT,
        messages: {
          create: {
            sender: "Customer",
            channel: MessageChannel.WEB_PORTAL,
            body: `Submitted Tax Invoice & Bank Details (${parsed.data.bankName} · ${parsed.data.iban}).`,
          },
        },
      },
      include: {
        messages: true,
      },
    });

    return res.json(updated);
  });

  // 5. Send WhatsApp Message (Synced to Ticket Timeline)
  router.post("/:id/whatsapp", async (req, res) => {
    const parsed = z.object({ body: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Message body required" });
    }

    const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const msg = await prisma.message.create({
      data: {
        complaintId: req.params.id,
        sender: "Customer",
        channel: MessageChannel.WHATSAPP,
        body: parsed.data.body,
      },
    });

    return res.status(201).json(msg);
  });

  // 6. WhatsApp Webhook (Inbound Simulation / Sync)
  router.post("/webhooks/whatsapp", async (req, res) => {
    const parsed = z
      .object({
        ticketId: z.string(),
        sender: z.string().default("Customer Care"),
        body: z.string(),
        externalId: z.string().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const ticket = await prisma.complaint.findUnique({ where: { id: parsed.data.ticketId } });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const msg = await prisma.message.create({
      data: {
        complaintId: parsed.data.ticketId,
        sender: parsed.data.sender,
        channel: MessageChannel.WHATSAPP,
        body: parsed.data.body,
        externalId: parsed.data.externalId,
      },
    });

    return res.status(201).json(msg);
  });

  // 7. CSAT Rating (Strictly on RESOLVED Tickets)
  router.post("/:id/csat", async (req, res) => {
    const parsed = z.object({ rating: z.number().int().min(1).max(5) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Rating must be an integer between 1 and 5" });
    }

    const ticket = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (ticket.status !== TicketStatus.RESOLVED) {
      return res.status(400).json({
        error: "CSAT can only be submitted on resolved tickets.",
      });
    }

    const updated = await prisma.complaint.update({
      where: { id: ticket.id },
      data: { csatRating: parsed.data.rating },
    });

    return res.json(updated);
  });

  return router;
}
