import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  PrismaClient,
  StaffRole,
  TicketStatus,
  ResolutionStatus,
  PayoutStatus,
  MessageChannel,
} from "@prisma/client";

export interface StaffPayload {
  staffId: string;
  name: string;
  role: StaffRole;
  branch: string;
  email: string;
}

export interface StaffRequest extends Request {
  staff?: StaffPayload;
}

const STAFF_JWT_SECRET = process.env.JWT_SECRET || "rush_care_portal_jwt_sec_38210384729103847291";

export function createAdminRouter(prisma: PrismaClient): Router {
  const router = Router();

  // In-memory caching to eliminate redundant cross-continental Tokyo DB queries
  interface CachedStaff {
    staff: StaffPayload;
    expiresAt: number;
  }
  const staffCache = new Map<string, CachedStaff>();

  let cachedConfig: any = null;
  let cachedConfigExpiresAt = 0;

  let cachedClaims: { data: any; key: string; expiresAt: number } | null = null;

  function invalidateClaimsCache() {
    cachedClaims = null;
  }

  // Invalidate claims cache on any mutating request
  router.use((req, _res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      invalidateClaimsCache();
    }
    next();
  });

  async function getSystemConfig() {
    if (cachedConfig && cachedConfigExpiresAt > Date.now()) {
      return cachedConfig;
    }
    let config = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    if (!config) {
      config = await prisma.systemConfig.create({
        data: {
          id: "default",
          damageApprovalCapSar: 200.0,
          maxSlaHours: 48,
        },
      });
    }
    cachedConfig = config;
    cachedConfigExpiresAt = Date.now() + 60 * 1000;
    return config;
  }

  // Middleware: Require Authenticated Staff
  async function requireStaff(req: StaffRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid staff authorization header" });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    try {
      const decoded = jwt.verify(token, STAFF_JWT_SECRET) as StaffPayload;

      const cached = staffCache.get(decoded.staffId);
      if (cached && cached.expiresAt > Date.now()) {
        req.staff = cached.staff;
        return next();
      }

      const user = await prisma.staffUser.findUnique({ where: { id: decoded.staffId } });
      if (!user) {
        return res.status(401).json({ error: "Staff user not found" });
      }
      if (!user.active) {
        return res.status(403).json({ error: "Staff account is currently paused or inactive" });
      }

      const staffPayload: StaffPayload = {
        staffId: user.id,
        name: user.name,
        role: user.role,
        branch: user.branch,
        email: user.email,
      };
      staffCache.set(user.id, { staff: staffPayload, expiresAt: Date.now() + 60 * 1000 });
      req.staff = staffPayload;
      next();
    } catch (err: any) {
      return res.status(401).json({ error: "Invalid or expired staff token" });
    }
  }

  // Helper: Branch scoping
  function branchScopeWhere(staff: StaffPayload, queryBranch?: string) {
    if (staff.role === StaffRole.OPS_MANAGER) {
      return { site: staff.branch };
    }
    if (queryBranch && queryBranch !== "all") {
      return { site: queryBranch };
    }
    return {};
  }

  // ==========================================
  // 1. Staff Authentication
  // ==========================================

  // Staff login with email & password
  router.post("/auth/login", async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const { email, password } = parsed.data;
    const user = await prisma.staffUser.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (!user.active) {
      return res.status(403).json({ error: "Staff account is currently paused or inactive" });
    }

    const match = bcrypt.compareSync(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const payload: StaffPayload = {
      staffId: user.id,
      name: user.name,
      role: user.role,
      branch: user.branch,
      email: user.email,
    };

    const token = jwt.sign(payload, STAFF_JWT_SECRET, { expiresIn: "12h" });
    return res.json({ token, user: payload });
  });

  // Get current logged-in staff info
  router.get("/auth/me", requireStaff, (req: StaffRequest, res) => {
    return res.json({ staff: req.staff });
  });

  // ==========================================
  // 2. System Policy Configuration
  // ==========================================

  router.get("/config", requireStaff, async (_req, res) => {
    const config = await getSystemConfig();
    return res.json(config);
  });

  router.patch("/config", requireStaff, async (req: StaffRequest, res) => {
    if (req.staff!.role !== StaffRole.BUSINESS_OWNER) {
      return res.status(403).json({ error: "Only Business Owner can update policy caps and SLA settings" });
    }

    const schema = z.object({
      damageApprovalCapSar: z.number().nonnegative().optional(),
      maxSlaHours: z.number().int().min(4).max(168).optional(),
      vatNumber: z.string().min(5).optional(),
      crNumber: z.string().min(4).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const updated = await prisma.systemConfig.update({
      where: { id: "default" },
      data: parsed.data,
    });
    cachedConfig = updated;
    cachedConfigExpiresAt = Date.now() + 60 * 1000;
    return res.json(updated);
  });

  // ==========================================
  // 3. Executive Dashboard & SLA Escalations
  // ==========================================

  router.get("/dashboard", requireStaff, async (req: StaffRequest, res) => {
    const config = await getSystemConfig();

    const branch = String(req.query.branch || "all");
    const whereScope = branchScopeWhere(req.staff!, branch);

    const complaints = await prisma.complaint.findMany({
      where: whereScope,
      include: {
        customer: true,
        auditLogs: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const now = Date.now();
    const maxSlaMs = config.maxSlaHours * 60 * 60 * 1000;
    const capSar = Number(config.damageApprovalCapSar);

    const open = complaints.filter((c) => c.status !== TicketStatus.RESOLVED);
    const breached = open.filter((c) => now - c.createdAt.getTime() > maxSlaMs);
    const ownerApprovalsNeeded = open.filter(
      (c) =>
        c.type === "DAMAGE" &&
        Number(c.quotedAmount || 0) > capSar &&
        !c.quotationApproved
    );
    const rated = complaints.filter((c) => c.csatRating != null);
    const avgCsat = rated.length
      ? Number((rated.reduce((sum, c) => sum + (c.csatRating || 0), 0) / rated.length).toFixed(1))
      : 5.0;

    const totalPayoutsSar = complaints.reduce(
      (sum, c) => sum + Number(c.approvedAmount || 0),
      0
    );

    // Escalations list
    const escalations = complaints
      .filter((c) => {
        const isBreached = c.status !== TicketStatus.RESOLVED && now - c.createdAt.getTime() > maxSlaMs;
        const needsOwner = c.type === "DAMAGE" && Number(c.quotedAmount || 0) > capSar && !c.quotationApproved;
        const pendingTransfer = c.payoutStatus === PayoutStatus.PENDING_BANK_TRANSFER;
        return isBreached || needsOwner || pendingTransfer;
      })
      .map((c) => {
        const ageHours = Math.round((now - c.createdAt.getTime()) / (1000 * 60 * 60));
        return {
          id: c.id,
          branch: c.site,
          type: c.type,
          customerName: c.customer.name,
          phone: c.customer.phone,
          plate: c.customer.licensePlate,
          assignedRole: c.assignedRole,
          assignedStaffName: c.assignedStaffName || "Unassigned",
          ageHours,
          isSlaBreached: ageHours > config.maxSlaHours,
          requiresOwnerApproval: c.type === "DAMAGE" && Number(c.quotedAmount || 0) > capSar,
          payoutStatus: c.payoutStatus,
          quotedSar: Number(c.quotedAmount || 0),
          approvedSar: Number(c.approvedAmount || 0),
        };
      });

    // Chart aggregations
    const byType = {
      unsatisfied: complaints.filter((c) => c.type === "UNSATISFIED").length,
      billing: complaints.filter((c) => c.type === "BILLING_REFUND").length,
      damage: complaints.filter((c) => c.type === "DAMAGE").length,
      other: complaints.filter((c) => c.type === "OTHER").length,
    };

    const branches = ["RUSH Al Kharj"];
    const byBranch = branches.map((b) => ({
      branch: b,
      open: complaints.filter((c) => c.site === b && c.status !== TicketStatus.RESOLVED).length,
      resolved: complaints.filter((c) => c.site === b && c.status === TicketStatus.RESOLVED).length,
    }));

    const byResolution = {
      approved: complaints.filter((c) => c.resolutionStatus === "APPROVED").length,
      refused: complaints.filter((c) => c.resolutionStatus === "REFUSED").length,
      pending: complaints.filter((c) => c.resolutionStatus === "PENDING" || !c.resolutionStatus).length,
    };

    return res.json({
      config,
      kpis: {
        openCount: open.length,
        slaCompliancePct: complaints.length
          ? Math.round(((complaints.length - breached.length) / complaints.length) * 100)
          : 100,
        breachedCount: breached.length,
        ownerApprovalsNeeded: ownerApprovalsNeeded.length,
        totalPayoutsSar,
        avgCsat,
      },
      escalations,
      charts: {
        byType,
        byBranch,
        byResolution,
      },
    });
  });

  // ==========================================
  // 4. Claims Queue & Filtering
  // ==========================================

  router.get("/claims", requireStaff, async (req: StaffRequest, res) => {
    const config = await getSystemConfig();

    const { status, type, branch, overdueOnly, myQueue, search } = req.query;
    const where: any = branchScopeWhere(req.staff!, String(branch || "all"));

    if (status && status !== "all") {
      where.status = status as TicketStatus;
    }
    if (type && type !== "all") {
      where.type = type as any;
    }

    if (myQueue === "true") {
      where.assignedRole = req.staff!.role;
    }

    if (search) {
      const q = String(search).trim();
      where.OR = [
        { id: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { phone: { contains: q } } },
        { customer: { licensePlate: { contains: q, mode: "insensitive" } } },
      ];
    }

    const cacheKey = JSON.stringify({ where, overdueOnly: Boolean(overdueOnly), role: req.staff!.role, branch: req.staff!.branch });
    if (cachedClaims && cachedClaims.key === cacheKey && cachedClaims.expiresAt > Date.now()) {
      return res.json(cachedClaims.data);
    }

    let complaints = await prisma.complaint.findMany({
      where,
      include: {
        customer: true,
        messages: { orderBy: { createdAt: "asc" } },
        auditLogs: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    const now = Date.now();
    const maxSlaMs = config.maxSlaHours * 60 * 60 * 1000;

    // Map into frontend structure
    let mapped = complaints.map((c) => {
      const ageHours = Math.round((now - c.createdAt.getTime()) / (1000 * 60 * 60));
      return {
        id: c.id,
        createdAt: c.createdAt,
        type: c.type,
        status: c.status,
        resolutionStatus: c.resolutionStatus,
        branch: c.site,
        assignedRole: c.assignedRole,
        assignedStaffName: c.assignedStaffName || "Unassigned",
        ageHours,
        isSlaBreached: c.status !== TicketStatus.RESOLVED && ageHours > config.maxSlaHours,
        customer: {
          name: c.customer.name,
          phone: c.customer.phone,
          plate: c.customer.licensePlate,
          vehicle: c.customer.vehicleModel,
        },
        receipt: `${c.posRecordId} (${c.posRecordLabel})`,
        summary: c.summary,
        qualityTags: c.qualityTags,
        vehicleZones: c.vehicleZones,
        requestedAmount: c.requestedAmount ? Number(c.requestedAmount) : null,
        approvedAmount: c.approvedAmount ? Number(c.approvedAmount) : null,
        quotedAmount: c.quotedAmount ? Number(c.quotedAmount) : null,
        quotationUrl: c.quotationUrl,
        quotationApproved: c.quotationApproved,
        waiverSigned: c.waiverSigned,
        waiverSignature: c.waiverSignature,
        invoiceUrl: c.invoiceUrl,
        bankName: c.bankName,
        accountHolder: c.accountHolder,
        iban: c.iban,
        payoutStatus: c.payoutStatus,
        rewashCode: c.rewashCode,
        rrn: c.rrn,
        transferRef: c.transferRef,
        resolutionNote: c.resolutionNote,
        csatRating: c.csatRating,
        mediaUrls: c.mediaUrls,
        messages: c.messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          channel: m.channel,
          text: m.body,
          time: m.createdAt,
        })),
        auditLogs: c.auditLogs.map((a) => ({
          id: a.id,
          actor: a.actorName,
          action: a.action,
          details: a.details,
          time: a.createdAt,
        })),
      };
    });

    if (overdueOnly === "true") {
      mapped = mapped.filter((c) => c.isSlaBreached);
    }

    cachedClaims = {
      data: mapped,
      key: cacheKey,
      expiresAt: Date.now() + 10 * 1000,
    };

    return res.json(mapped);
  });

  // Get single claim details
  router.get("/claims/:id", requireStaff, async (req: StaffRequest, res) => {
    const complaint = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        messages: { orderBy: { createdAt: "asc" } },
        auditLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!complaint) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    return res.json(complaint);
  });

  // ==========================================
  // 5. Claims Action Endpoints
  // ==========================================

  // Handoff Damage claim from Ops Manager -> CSM
  router.post("/claims/:id/handoff-csm", requireStaff, async (req: StaffRequest, res) => {
    if (!([StaffRole.OPS_MANAGER, StaffRole.BUSINESS_OWNER, StaffRole.ADMIN] as StaffRole[]).includes(req.staff!.role)) {
      return res.status(403).json({ error: "Only Ops Manager, Admin, or Owner can hand off Damage claims" });
    }

    const csm = await prisma.staffUser.findFirst({ where: { role: StaffRole.CSM, active: true } });
    const csmName = csm?.name || "Omar Al-Dosari";

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        assignedRole: StaffRole.CSM,
        assignedStaffName: csmName,
        status: TicketStatus.INVESTIGATING,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "HANDOFF_CSM",
            details: `Damage claim handed off from ${req.staff!.name} to CSM (${csmName}). Customer can upload quotation.`,
          },
        },
        messages: {
          create: {
            sender: req.staff!.name,
            channel: MessageChannel.INTERNAL,
            body: `Damage claim handed off to CSM (${csmName}) for formal repair quotation review.`,
          },
        },
      },
    });

    return res.json({ success: true, complaint: updated });
  });

  // Overdue SLA Nudge
  router.post("/claims/:id/nudge", requireStaff, async (req: StaffRequest, res) => {
    const complaint = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!complaint) return res.status(404).json({ error: "Ticket not found" });

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        slaBreached: true,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "SLA_NUDGE",
            details: `48-hour SLA escalation reminder sent by ${req.staff!.name} to ${complaint.assignedStaffName || complaint.assignedRole}.`,
          },
        },
        messages: {
          create: {
            sender: req.staff!.name,
            channel: MessageChannel.INTERNAL,
            body: `[SLA Escalation Alert] Ticket ${complaint.id} is overdue. Action required immediately.`,
          },
        },
      },
    });

    return res.json({ success: true, complaint: updated });
  });

  // Approve Unsatisfied -> Issue Rewash Pass
  router.post("/claims/:id/unsatisfied/approve", requireStaff, async (req: StaffRequest, res) => {
    if (!([StaffRole.ADMIN, StaffRole.BUSINESS_OWNER, StaffRole.CSM] as StaffRole[]).includes(req.staff!.role)) {
      return res.status(403).json({ error: "Permission denied to issue rewash pass" });
    }

    const rewashCode = `RW-${Math.floor(1000 + Math.random() * 9000)}`;

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        status: TicketStatus.RESOLVED,
        resolutionStatus: ResolutionStatus.APPROVED,
        resolutionNote: `Complimentary Rewash pass ${rewashCode} approved by ${req.staff!.name}.`,
        rewashCode,
        payoutStatus: PayoutStatus.REWASH_ISSUED,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "APPROVE_REWASH",
            details: `Approved complimentary rewash pass ${rewashCode}`,
          },
        },
        messages: {
          create: {
            sender: req.staff!.name,
            channel: MessageChannel.WHATSAPP,
            body: `Your complimentary Rewash pass ${rewashCode} is approved! Present it at RUSH Car Wash Al Kharj within 7 days.`,
          },
        },
      },
    });

    return res.json({ success: true, rewashCode, complaint: updated });
  });

  // Approve Billing Refund
  router.post("/claims/:id/billing/approve", requireStaff, async (req: StaffRequest, res) => {
    if (!([StaffRole.ADMIN, StaffRole.BUSINESS_OWNER] as StaffRole[]).includes(req.staff!.role)) {
      return res.status(403).json({ error: "Only Admin or Business Owner can approve card billing refunds" });
    }

    const schema = z.object({
      rrn: z.string().min(4),
      amount: z.number().positive(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid RRN and refund amount are required" });
    }

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        status: TicketStatus.RESOLVED,
        resolutionStatus: ResolutionStatus.APPROVED,
        approvedAmount: parsed.data.amount,
        rrn: parsed.data.rrn,
        payoutStatus: PayoutStatus.PAID_RRN,
        resolutionNote: `Card reversal processed via Mada/Visa. RRN: ${parsed.data.rrn}. Approved by ${req.staff!.name}.`,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "APPROVE_BILLING_REFUND",
            details: `Refund of SAR ${parsed.data.amount} processed with RRN ${parsed.data.rrn}.`,
          },
        },
        messages: {
          create: {
            sender: req.staff!.name,
            channel: MessageChannel.WHATSAPP,
            body: `Your refund of SAR ${parsed.data.amount} has been processed back to your card (RRN: ${parsed.data.rrn}). Expected in 2-5 business days.`,
          },
        },
      },
    });

    return res.json({ success: true, complaint: updated });
  });

  // Request Repair Quotation & Waiver from Customer
  router.post("/claims/:id/damage/request-quote", requireStaff, async (req: StaffRequest, res) => {
    const schema = z.object({
      resolutionNote: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    const note = parsed.success && parsed.data.resolutionNote
      ? parsed.data.resolutionNote
      : "Your damage claim has been approved for repair review. Please upload an official repair quotation and sign the liability waiver in your tracker.";

    const complaint = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!complaint) return res.status(404).json({ error: "Ticket not found" });

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        resolutionStatus: ResolutionStatus.APPROVED,
        status: TicketStatus.INVESTIGATING,
        payoutStatus: PayoutStatus.AWAITING_QUOTE_APPROVAL,
        resolutionNote: note,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "REQUEST_DAMAGE_QUOTE",
            details: `Approved damage claim for repair quotation. Customer notified to upload quotation & sign waiver. Note: ${note}`,
          },
        },
        messages: {
          create: {
            sender: req.staff!.name,
            channel: MessageChannel.WHATSAPP,
            body: `Hi, your damage claim ${complaint.id} has been approved for repair review. Please open your tracker to upload the official repair quotation and sign the waiver: https://crm.rush.com.sa/`,
          },
        },
      },
    });

    return res.json({ success: true, complaint: updated });
  });

  // Approve Damage Quotation (Enforces SAR 200 Cap)
  router.post("/claims/:id/damage/approve-quote", requireStaff, async (req: StaffRequest, res) => {
    const config = await getSystemConfig();

    const complaint = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!complaint) return res.status(404).json({ error: "Ticket not found" });

    const cap = Number(config.damageApprovalCapSar);
    const quoted = Number(req.body.quotedAmount !== undefined ? req.body.quotedAmount : (complaint.quotedAmount || 0));

    // Strict Cap Check: If quoted > cap, only BUSINESS_OWNER can approve
    if (quoted > cap && req.staff!.role !== StaffRole.BUSINESS_OWNER) {
      return res.status(403).json({
        error: `Repair quotation (SAR ${quoted}) exceeds the configurable approval cap of SAR ${cap}. Only Business Owner (${req.staff!.name}) can approve this quotation.`,
      });
    }

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        quotationApproved: true,
        payoutStatus: PayoutStatus.AWAITING_INVOICE_IBAN,
        ...(req.body.quotedAmount !== undefined ? { quotedAmount: quoted } : {}),
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "APPROVE_DAMAGE_QUOTE",
            details: `Repair quotation of SAR ${quoted} approved by ${req.staff!.name} (${req.staff!.role}). Unlocked Step 2 for customer invoice & IBAN.`,
          },
        },
        messages: {
          create: {
            sender: req.staff!.name,
            channel: MessageChannel.WHATSAPP,
            body: `Your repair quotation of SAR ${quoted} has been approved! Please upload your official repair invoice and IBAN to receive payout.`,
          },
        },
      },
    });

    return res.json({ success: true, complaint: updated });
  });

  // Refuse Complaint
  router.post("/claims/:id/refuse", requireStaff, async (req: StaffRequest, res) => {
    const schema = z.object({
      resolutionNote: z.string().min(5),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Detailed resolution note is required when refusing a claim" });
    }

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        status: TicketStatus.RESOLVED,
        resolutionStatus: ResolutionStatus.REFUSED,
        payoutStatus: PayoutStatus.DECLINED,
        resolutionNote: parsed.data.resolutionNote,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "REFUSE_CLAIM",
            details: `Claim declined by ${req.staff!.name}. Reason: ${parsed.data.resolutionNote}`,
          },
        },
        messages: {
          create: {
            sender: req.staff!.name,
            channel: MessageChannel.WHATSAPP,
            body: `Update on ticket ${req.params.id}: After review, we are unable to approve this claim. Reason: ${parsed.data.resolutionNote}`,
          },
        },
      },
    });

    return res.json({ success: true, complaint: updated });
  });

  // Patch Claim Fields (real-time persistence from Admin Console)
  router.patch("/claims/:id", requireStaff, async (req: StaffRequest, res) => {
    const schema = z.object({
      resolutionStatus: z.nativeEnum(ResolutionStatus).optional(),
      resolutionNote: z.string().nullable().optional(),
      status: z.nativeEnum(TicketStatus).optional(),
      payoutStatus: z.nativeEnum(PayoutStatus).optional(),
      assignedRole: z.nativeEnum(StaffRole).optional(),
      assignedStaffName: z.string().optional(),
      vehicleZones: z.array(z.string()).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const complaint = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!complaint) return res.status(404).json({ error: "Ticket not found" });

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: parsed.data,
    });

    return res.json({ success: true, complaint: updated });
  });

  // Post Internal or Customer Message
  router.post("/claims/:id/messages", requireStaff, async (req: StaffRequest, res) => {
    const schema = z.object({
      body: z.string().min(1),
      channel: z.nativeEnum(MessageChannel).default(MessageChannel.INTERNAL),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid message text is required" });
    }

    const message = await prisma.message.create({
      data: {
        complaintId: req.params.id,
        sender: req.staff!.name,
        channel: parsed.data.channel,
        body: parsed.data.body,
      },
    });

    return res.json(message);
  });

  // ==========================================
  // 6. Finance & Bank Transfer Disbursement
  // ==========================================

  router.get("/finance", requireStaff, async (req: StaffRequest, res) => {
    const complaints = await prisma.complaint.findMany({
      where: {
        OR: [
          { payoutStatus: { not: PayoutStatus.PENDING_REVIEW } },
          { approvedAmount: { not: null } },
          { rewashCode: { not: null } },
        ],
      },
      include: { customer: true },
      orderBy: { updatedAt: "desc" },
    });

    const financeList = complaints.map((c) => ({
      id: c.id,
      customer: {
        name: c.customer.name,
        phone: c.customer.phone,
        plate: c.customer.licensePlate,
      },
      branch: c.site,
      type: c.type,
      amountSar: Number(c.approvedAmount || c.requestedAmount || c.quotedAmount || 0),
      payoutStatus: c.payoutStatus,
      iban: c.iban || "—",
      bankName: c.bankName || "—",
      accountHolder: c.accountHolder || "—",
      rrn: c.rrn || "—",
      rewashCode: c.rewashCode || "—",
      transferRef: c.transferRef || "—",
      updatedAt: c.updatedAt,
    }));

    return res.json(financeList);
  });

  // Mark Bank Transfer Paid
  router.post("/finance/:id/mark-paid", requireStaff, async (req: StaffRequest, res) => {
    const schema = z.object({
      transferRef: z.string().min(3),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Transfer reference (e.g. TRF-994012) is required" });
    }

    const complaint = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!complaint) return res.status(404).json({ error: "Ticket not found" });

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        status: TicketStatus.RESOLVED,
        resolutionStatus: ResolutionStatus.APPROVED,
        payoutStatus: PayoutStatus.PAID,
        transferRef: parsed.data.transferRef,
        resolutionNote: `Bank transfer executed. Ref: ${parsed.data.transferRef}. Logged by ${req.staff!.name}.`,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "MARK_PAID",
            details: `Bank transfer marked paid. Ref: ${parsed.data.transferRef} by ${req.staff!.name}.`,
          },
        },
        messages: {
          create: {
            sender: req.staff!.name,
            channel: MessageChannel.WHATSAPP,
            body: `Your payment has been sent to your bank account! Transfer Ref: ${parsed.data.transferRef}. Thank you for choosing RUSH Car Wash.`,
          },
        },
      },
    });

    return res.json({ success: true, complaint: updated });
  });

  // Export Finance CSV (RFC-4180)
  router.get("/finance/export.csv", requireStaff, async (_req, res) => {
    const complaints = await prisma.complaint.findMany({
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=rush_finance_export_${Date.now()}.csv`);

    const rows = [
      ["Ticket ID", "Branch", "Type", "Status", "Payout Status", "Customer", "Phone", "Plate", "Amount (SAR)", "IBAN", "Bank", "Transfer Ref / RRN", "Rewash Code", "Staff In Charge", "Date"].join(",")
    ];

    for (const c of complaints) {
      const amt = Number(c.approvedAmount || c.requestedAmount || c.quotedAmount || 0);
      const ref = c.transferRef || c.rrn || "";
      rows.push([
        c.id,
        `"${c.site}"`,
        c.type,
        c.status,
        c.payoutStatus,
        `"${c.customer.name}"`,
        c.customer.phone,
        `"${c.customer.licensePlate}"`,
        amt.toFixed(2),
        `"${c.iban || ''}"`,
        `"${c.bankName || ''}"`,
        `"${ref}"`,
        `"${c.rewashCode || ''}"`,
        `"${c.assignedStaffName || ''}"`,
        `"${c.createdAt.toISOString()}"`
      ].join(","));
    }

    return res.send(rows.join("\r\n"));
  });

  // ==========================================
  // 7. Staff Directory & RBAC Controls
  // ==========================================

  router.get("/staff", requireStaff, async (_req, res) => {
    const staff = await prisma.staffUser.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branch: true,
        active: true,
        createdAt: true,
      },
    });
    return res.json(staff);
  });

  router.post("/staff", requireStaff, async (req: StaffRequest, res) => {
    if (!([StaffRole.BUSINESS_OWNER, StaffRole.ADMIN] as StaffRole[]).includes(req.staff!.role)) {
      return res.status(403).json({ error: "Only Owner or Admin can add staff users" });
    }

    const schema = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional(),
      role: z.nativeEnum(StaffRole),
      branch: z.string().default("RUSH Al Kharj"),
      password: z.string().min(6).default("RushCare@2026!"),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { password, ...staffData } = parsed.data;

    const existing = await prisma.staffUser.findUnique({
      where: { email: staffData.email },
    });
    if (existing) {
      return res.status(400).json({ error: "Staff user with this email already exists" });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const created = await prisma.staffUser.create({
      data: {
        ...staffData,
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branch: true,
        active: true,
        createdAt: true,
      },
    });
    return res.json(created);
  });

  router.patch("/staff/:id", requireStaff, async (req: StaffRequest, res) => {
    if (!([StaffRole.BUSINESS_OWNER, StaffRole.ADMIN] as StaffRole[]).includes(req.staff!.role)) {
      return res.status(403).json({ error: "Only Owner or Admin can update staff users" });
    }

    const schema = z.object({
      role: z.nativeEnum(StaffRole).optional(),
      branch: z.string().optional(),
      active: z.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const updated = await prisma.staffUser.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    return res.json(updated);
  });

  return router;
}
