import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { STAFF_JWT_SECRET } from "../config/env";
import { buildDirectTicketUrl } from "../middleware/auth";
import { staffLoginLimiter, ibanRevealLimiter } from "../middleware/security";
import { deleteFiles, uploadFile, sniffMatches } from "../services/storage";
import { findPaidOrderCeilingInMongo } from "../services/mongo";
import { sendStaffWhatsAppViaChatwoot } from "../services/chatwoot";
import { asyncHandler } from "../utils/asyncHandler";
import { encryptField, decryptField, maskIban, randomCode, signFileUrl } from "../utils/crypto";
import { anonymiseCustomer, exportCustomerData } from "../services/retention";
import {
  PrismaClient,
  StaffRole,
  TicketStatus,
  ResolutionStatus,
  PayoutStatus,
  MessageChannel,
  Prisma,
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

const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);
const STAFF_ISSUER = "rush-care";
const STAFF_AUDIENCE = "rush-staff";
const PASSWORD_POLICY = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p), "Use upper, lower, digit and symbol");
const PRIVILEGED: StaffRole[] = [StaffRole.BUSINESS_OWNER, StaffRole.ADMIN];
const STAFF_PUBLIC = { id: true, name: true, email: true, phone: true, role: true, branch: true, active: true, createdAt: true } as const;

function csvCell(v: unknown): string {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // neutralise spreadsheet formula injection
  return `"${t.replace(/"/g, '""')}"`;
}
function auditLog(prisma: PrismaClient, staff: StaffPayload | undefined, action: string, detail: string, complaintId?: string) {
  console.warn(`[AUDIT] ${new Date().toISOString()} staff=${staff?.staffId || "anon"} role=${staff?.role || "NONE"} action=${action} ${detail}`);
  prisma.auditLog
    .create({
      data: {
        complaintId: complaintId ?? null,
        staffId: staff?.staffId ?? null,
        actorName: staff?.name || "System",
        action,
        details: detail,
      },
    })
    .catch(() => {});
}

export function pwdFp(hash: string | null | undefined): string {
  return crypto.createHmac("sha256", STAFF_JWT_SECRET).update(hash || "").digest("hex").slice(0, 16);
}

interface CachedStaff {
  staff: StaffPayload;
  pwdFp: string;
  expiresAt: number;
}
const staffCache = new Map<string, CachedStaff>();

export async function verifyActiveStaffJwt(
  prisma: PrismaClient,
  token: string
): Promise<{ staff: StaffPayload } | { status: 401 | 403; error: string }> {
  try {
    const decoded = jwt.verify(token, STAFF_JWT_SECRET, {
      algorithms: ["HS256"],
      audience: STAFF_AUDIENCE,
      issuer: STAFF_ISSUER,
    }) as StaffPayload & { pwdFp?: string };

    const cached = staffCache.get(decoded.staffId);
    if (cached && cached.expiresAt > Date.now()) {
      if (!decoded.pwdFp || decoded.pwdFp !== cached.pwdFp) {
        return { status: 401, error: "Invalid or expired staff token" };
      }
      return { staff: cached.staff };
    }

    const user = await prisma.staffUser.findUnique({ where: { id: decoded.staffId } });
    if (!user) {
      return { status: 401, error: "Staff user not found" };
    }
    if (!user.active) {
      return { status: 403, error: "Staff account is currently paused or inactive" };
    }
    const currentFp = pwdFp(user.passwordHash);
    if (!decoded.pwdFp || decoded.pwdFp !== currentFp) {
      return { status: 401, error: "Invalid or expired staff token" };
    }

    const staffPayload: StaffPayload = {
      staffId: user.id,
      name: user.name,
      role: user.role,
      branch: user.branch,
      email: user.email,
    };
    staffCache.set(user.id, { staff: staffPayload, pwdFp: currentFp, expiresAt: Date.now() + 15 * 1000 });
    return { staff: staffPayload };
  } catch {
    return { status: 401, error: "Invalid or expired staff token" };
  }
}

function formatRiyadhCsv(d: Date): string {
  return (
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d) + " AST"
  );
}

const claimsCache = new Map<string, { data: any; expiresAt: number }>();

export function invalidateClaimsCache() {
  claimsCache.clear();
}

export function createAdminRouter(prisma: PrismaClient): Router {
  const router = Router();

  let cachedConfig: any = null;
  let cachedConfigExpiresAt = 0;

  // Invalidate claims cache on any mutating request
  router.use((req, _res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      invalidateClaimsCache();
    }
    next();
  });

  async function notifyCustomerWhatsApp(ticketId: string, customerId: string, text: string) {
    try {
      const cust = await prisma.customer.findUnique({ where: { id: customerId }, select: { phone: true } });
      if (cust?.phone) {
        await sendStaffWhatsAppViaChatwoot({ ticketId, phone: cust.phone, text });
      }
    } catch (err: any) {
      console.warn(`[Admin] Chatwoot WhatsApp notify failed for #${ticketId}:`, err?.message || err);
    }
  }

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
    const result = await verifyActiveStaffJwt(prisma, token);
    if ("error" in result) {
      return res.status(result.status).json({ error: result.error });
    }
    req.staff = result.staff;
    next();
  }

  // Helper: Branch scoping (Ops Manager always scoped; Finance scoped if assigned to a specific branch)
  function isBranchScopedStaff(staff: StaffPayload): boolean {
    return (
      staff.role === StaffRole.OPS_MANAGER ||
      (staff.role === StaffRole.FINANCE && staff.branch !== "All Branches")
    );
  }

  function branchScopeWhere(staff: StaffPayload, queryBranch?: string) {
    if (isBranchScopedStaff(staff)) {
      return { site: staff.branch };
    }
    if (queryBranch && queryBranch !== "all") {
      return { site: queryBranch };
    }
    return {};
  }

  function requireRoles(...roles: StaffRole[]) {
    return (req: StaffRequest, res: Response, next: NextFunction) => {
      if (!req.staff || !roles.includes(req.staff.role)) {
        auditLog(prisma, req.staff, "RBAC_DENIED", `path=${req.path} method=${req.method}`);
        return res.status(403).json({ error: "Your role is not permitted to perform this action" });
      }
      next();
    };
  }

  /** Load a claim, enforcing branch scope (404 for out-of-scope so IDs can't be probed). */
  async function loadClaim(req: StaffRequest, res: Response) {
    const claim = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!claim || (isBranchScopedStaff(req.staff!) && claim.site !== req.staff!.branch)) {
      res.status(404).json({ error: "Ticket not found" });
      return null;
    }
    return claim;
  }

  const isClosed = (c: { status: TicketStatus; payoutStatus: PayoutStatus }) =>
    c.status === TicketStatus.RESOLVED || c.payoutStatus === PayoutStatus.PAID || c.payoutStatus === PayoutStatus.PAID_RRN;

  // ==========================================
  // 1. Staff Authentication
  // ==========================================

  // Staff login with email & password
  router.post("/auth/login", staffLoginLimiter, asyncHandler(async (req, res) => {
    const schema = z.object({
      email: z.string().email().max(200),
      password: z.string().min(1).max(128),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const { password } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();
    const user = await prisma.staffUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

    // Always run a bcrypt compare so response time doesn't reveal whether the account exists
    const match = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !user.passwordHash || !match || !user.active) {
      auditLog(prisma, undefined, "AUTH_LOGIN_FAILED", `email=${email} reason=${!user ? "unknown" : !user.active ? "inactive" : "bad_password"}`);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const payload: StaffPayload = {
      staffId: user.id,
      name: user.name,
      role: user.role,
      branch: user.branch,
      email: user.email,
    };

    const token = jwt.sign(
      { ...payload, pwdFp: pwdFp(user.passwordHash) },
      STAFF_JWT_SECRET,
      { expiresIn: "8h", audience: STAFF_AUDIENCE, issuer: STAFF_ISSUER }
    );
    return res.json({ token, user: { ...payload, signatureUrl: signFileUrl(user.signatureUrl) } });
  }));

  async function uploadSignatureDataUrl(dataUrl: string): Promise<string | null> {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return null;
    const mime = m[1];
    const buf = Buffer.from(m[2], "base64");
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024 || !sniffMatches(buf, mime)) return null;
    return uploadFile(buf, mime, "signatures");
  }

  router.get("/me/signature", requireStaff, asyncHandler(async (req: StaffRequest, res) => {
    const user = await prisma.staffUser.findUnique({ where: { id: req.staff!.staffId }, select: { signatureUrl: true } });
    return res.json({ signatureUrl: signFileUrl(user?.signatureUrl) });
  }));

  router.post("/me/signature", requireStaff, asyncHandler(async (req: StaffRequest, res) => {
    const parsed = z.object({ signatureDataUrl: z.string().max(300000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Valid signature image is required" });
    const key = await uploadSignatureDataUrl(parsed.data.signatureDataUrl);
    if (!key) return res.status(400).json({ error: "Invalid signature image format" });
    await prisma.staffUser.update({ where: { id: req.staff!.staffId }, data: { signatureUrl: key } });
    return res.json({ signatureUrl: signFileUrl(key) });
  }));

  router.post("/auth/change-password", staffLoginLimiter, requireStaff, asyncHandler(async (req: StaffRequest, res) => {
    const parsed = z.object({ currentPassword: z.string().max(128), newPassword: PASSWORD_POLICY }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const user = await prisma.staffUser.findUnique({ where: { id: req.staff!.staffId } });
    if (!user?.passwordHash || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    await prisma.staffUser.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) } });
    staffCache.delete(user.id);
    return res.json({ success: true });
  }));

  // Get current logged-in staff info
  router.get("/auth/me", requireStaff, (req: StaffRequest, res) => {
    return res.json({ staff: req.staff });
  });

  // ==========================================
  // 2. System Policy Configuration
  // ==========================================

  router.get("/config", requireStaff, asyncHandler(async (_req, res) => {
    const config = await getSystemConfig();
    return res.json(config);
  }));

  router.patch("/config", requireStaff, asyncHandler(async (req: StaffRequest, res) => {
    if (req.staff!.role !== StaffRole.BUSINESS_OWNER) {
      return res.status(403).json({ error: "Only Business Owner can update policy caps and SLA settings" });
    }

    const schema = z.object({
      damageApprovalCapSar: z.number().nonnegative().max(1000000).optional(),
      maxSlaHours: z.number().int().min(4).max(168).optional(),
      companyName: z.string().min(2).max(150).optional(),
      vatNumber: z.string().regex(/^3\d{14}$/, "VAT must be 15 digits starting with 3").optional(),
      crNumber: z.string().regex(/^\d{10}$/, "CR must be 10 digits").optional(),
      unifiedNationalNumber: z.string().regex(/^\d{10}$/, "Unified National Number must be 10 digits").optional(),
      whatsappNumber: z.string().regex(/^\d{9,15}$/, "WhatsApp number must be 9-15 digits").optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const updated = await prisma.systemConfig.update({
      where: { id: "default" },
      data: parsed.data,
    });
    auditLog(prisma, req.staff, "CONFIG_UPDATE", JSON.stringify(parsed.data));
    cachedConfig = updated;
    cachedConfigExpiresAt = Date.now() + 60 * 1000;
    return res.json(updated);
  }));

  // ==========================================
  // 3. Executive Dashboard & SLA Escalations
  // ==========================================

  router.get("/dashboard", requireStaff, asyncHandler(async (req: StaffRequest, res) => {
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
      take: 2000,
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
  }));

  // ==========================================
  // 4. Claims Queue & Filtering
  // ==========================================

  router.get("/claims", requireStaff, asyncHandler(async (req: StaffRequest, res) => {
    const config = await getSystemConfig();

    const { status, type, branch, overdueOnly, myQueue, search } = req.query;
    const rawLimit = Number(req.query.limit ?? 200);
    const rawOffset = Number(req.query.offset ?? 0);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.trunc(rawLimit)), 500) : 200;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;
    const where: any = branchScopeWhere(req.staff!, String(branch || "all"));

    if (status && status !== "all") {
      if (!(status as string in TicketStatus)) return res.status(400).json({ error: "Invalid status filter" });
      where.status = status as TicketStatus;
    }
    if (type && type !== "all") {
      if (!["UNSATISFIED", "BILLING_REFUND", "DAMAGE", "OTHER"].includes(String(type))) return res.status(400).json({ error: "Invalid type filter" });
      where.type = type as any;
    }

    if (myQueue === "true") {
      where.assignedRole = req.staff!.role;
    }

    if (search) {
      const q = String(search).trim().slice(0, 60);
      where.OR = [
        { id: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { phone: { contains: q } } },
        { customer: { licensePlate: { contains: q, mode: "insensitive" } } },
      ];
    }

    const cacheKey = JSON.stringify({ where, overdueOnly: overdueOnly === "true", role: req.staff!.role, branch: req.staff!.branch, limit, offset });
    const cachedHit = claimsCache.get(cacheKey);
    if (cachedHit && cachedHit.expiresAt > Date.now()) {
      res.setHeader("X-Total-Count", String(cachedHit.data.total));
      return res.json(cachedHit.data.items);
    }

    let complaints = await prisma.complaint.findMany({
      where,
      include: {
        customer: true,
        messages: { orderBy: { createdAt: "asc" } },
        auditLogs: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
      ...(overdueOnly === "true" ? { take: 2000 } : {}),
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
        quotationUrl: signFileUrl(c.quotationUrl),
        quotationApproved: c.quotationApproved,
        waiverSigned: c.waiverSigned,
        waiverSignatureUrl: c.waiverSignature?.startsWith("/api/files/")
          ? signFileUrl(c.waiverSignature)
          : c.waiverSignature?.startsWith("data:image/")
            ? c.waiverSignature
            : null,
        invoiceUrl: signFileUrl(c.invoiceUrl),
        bankName: c.bankName,
        accountHolder: c.accountHolder ? "•••• " + String(decryptField(c.accountHolder) || "").slice(-3) : null,
        iban: c.iban ? maskIban(c.iban) : null,
        techSignatureUrl: signFileUrl(c.techSignatureUrl),
        techSignedBy: c.techSignedBy || null,
        opsSignatureUrl: signFileUrl(c.opsSignatureUrl),
        opsSignedBy: c.opsSignedBy || null,
        financeSignatureUrl: signFileUrl(c.financeSignatureUrl),
        financeSignedBy: c.financeSignedBy || null,
        payoutStatus: c.payoutStatus,
        rewashCode: c.rewashCode,
        rrn: c.rrn,
        transferRef: c.transferRef,
        resolutionNote: c.resolutionNote,
        csatRating: c.csatRating,
        mediaUrls: (c.mediaUrls || []).map((u) => signFileUrl(u) || u),
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
    const totalCount = mapped.length;
    const paged = mapped.slice(offset, offset + limit);

    if (claimsCache.size >= 50) {
      const oldestKey = claimsCache.keys().next().value;
      if (oldestKey) claimsCache.delete(oldestKey);
    }
    claimsCache.set(cacheKey, {
      data: { total: totalCount, items: paged },
      expiresAt: Date.now() + 10 * 1000,
    });

    res.setHeader("X-Total-Count", String(totalCount));
    return res.json(paged);
  }));

  // Get single claim details
  router.get("/claims/:id", requireStaff, asyncHandler(async (req: StaffRequest, res) => {
    const complaint = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        messages: { orderBy: { createdAt: "asc" } },
        auditLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!complaint || (isBranchScopedStaff(req.staff!) && complaint.site !== req.staff!.branch)) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const { iban, accountHolder, waiverSignature, ...rest } = complaint;
    const holderPlain = decryptField(accountHolder);
    return res.json({
      ...rest,
      quotationUrl: signFileUrl(rest.quotationUrl),
      waiverSignatureUrl: waiverSignature?.startsWith("/api/files/")
        ? signFileUrl(waiverSignature)
        : waiverSignature?.startsWith("data:image/")
          ? waiverSignature
          : null,
      invoiceUrl: signFileUrl(rest.invoiceUrl),
      bankSmsUrl: signFileUrl(rest.bankSmsUrl),
      techSignatureUrl: signFileUrl(rest.techSignatureUrl),
      opsSignatureUrl: signFileUrl(rest.opsSignatureUrl),
      financeSignatureUrl: signFileUrl(rest.financeSignatureUrl),
      mediaUrls: (rest.mediaUrls || []).map((u) => signFileUrl(u) || u),
      iban: iban ? maskIban(iban) : null,
      accountHolder: holderPlain ? "•••• " + holderPlain.slice(-3) : null,
    });
  }));

  // ==========================================
  // 5. Claims Action Endpoints (role-gated, branch-scoped, state-machine enforced)
  // ==========================================

  // Handoff Damage claim from Ops Manager -> CSM
  router.post("/claims/:id/handoff-csm", requireStaff, requireRoles(StaffRole.OPS_MANAGER, StaffRole.BUSINESS_OWNER, StaffRole.ADMIN), asyncHandler(async (req: StaffRequest, res) => {
    const claim = await loadClaim(req, res);
    if (!claim) return;
    if (claim.type !== "DAMAGE" || isClosed(claim)) return res.status(409).json({ error: "Only open Damage claims can be handed off" });

    const csm = await prisma.staffUser.findFirst({ where: { role: StaffRole.CSM, active: true } });
    if (!csm) return res.status(409).json({ error: "No active CSM available to receive the handoff" });
    const csmName = csm.name;

    const updated = await prisma.complaint.update({
      where: { id: claim.id },
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
  }));

  // Overdue SLA Nudge (only when the ticket genuinely is overdue)
  router.post("/claims/:id/nudge", requireStaff, asyncHandler(async (req: StaffRequest, res) => {
    const complaint = await loadClaim(req, res);
    if (!complaint) return;
    const config = await getSystemConfig();
    const overdue = !isClosed(complaint) && Date.now() - complaint.createdAt.getTime() > config.maxSlaHours * 3600 * 1000;
    if (!overdue) return res.status(409).json({ error: "Ticket is not past its SLA" });

    const updated = await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        slaBreached: true,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "SLA_NUDGE",
            details: `${config.maxSlaHours}-hour SLA escalation reminder sent by ${req.staff!.name} to ${complaint.assignedStaffName || complaint.assignedRole}.`,
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
  }));

  // Approve Unsatisfied -> Issue Rewash Pass
  router.post("/claims/:id/unsatisfied/approve", requireStaff, requireRoles(StaffRole.ADMIN, StaffRole.BUSINESS_OWNER, StaffRole.CSM), asyncHandler(async (req: StaffRequest, res) => {
    const claim = await loadClaim(req, res);
    if (!claim) return;
    if (claim.type !== "UNSATISFIED" || isClosed(claim)) {
      return res.status(409).json({ error: "Rewash passes can only be issued on open wash-quality tickets" });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const rewashCode = `RW-${randomCode(8)}`; // ~40 bits, unguessable, collision-retried
      try {
        const claimed = await prisma.complaint.updateMany({
          where: {
            id: claim.id,
            status: { not: TicketStatus.RESOLVED },
            payoutStatus: { notIn: [PayoutStatus.PAID, PayoutStatus.PAID_RRN] },
          },
          data: {
            status: TicketStatus.RESOLVED,
            resolutionStatus: ResolutionStatus.APPROVED,
            resolutionNote: `Complimentary Rewash pass ${rewashCode} approved by ${req.staff!.name}.`,
            rewashCode,
            payoutStatus: PayoutStatus.REWASH_ISSUED,
          },
        });
        if (claimed.count !== 1) {
          return res.status(409).json({ error: "Rewash passes can only be issued on open wash-quality tickets" });
        }
        await prisma.auditLog.create({
          data: {
            complaintId: claim.id,
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "APPROVE_REWASH",
            details: `Approved complimentary rewash pass ${rewashCode}`,
          },
        });
        await prisma.message.create({
          data: {
            complaintId: claim.id,
            sender: req.staff!.name,
            channel: MessageChannel.WHATSAPP,
            body: `Your complimentary Rewash pass ${rewashCode} is approved! Present it at RUSH Car Wash Al Kharj within 7 days.`,
          },
        });
        const updated = await prisma.complaint.findUnique({ where: { id: claim.id } });
        void notifyCustomerWhatsApp(
          claim.id,
          claim.customerId,
          `Your complimentary Rewash pass ${rewashCode} is approved! Present it at RUSH Car Wash Al Kharj within 7 days.`
        );
        return res.json({ success: true, rewashCode, complaint: updated });
      } catch (e: any) {
        if (e?.code === "P2002") continue;
        throw e;
      }
    }
    return res.status(503).json({ error: "Could not generate a unique rewash code, retry" });
  }));

  // Approve Billing Refund
  router.post("/claims/:id/billing/approve", requireStaff, requireRoles(StaffRole.ADMIN, StaffRole.BUSINESS_OWNER), asyncHandler(async (req: StaffRequest, res) => {
    const schema = z.object({
      rrn: z.string().regex(/^[A-Za-z0-9]{4,30}$/, "RRN must be 4-30 alphanumeric characters"),
      amount: z.number().positive().max(100000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid RRN and refund amount are required" });
    }

    const claim = await loadClaim(req, res);
    if (!claim) return;
    if (claim.type !== "BILLING_REFUND" || isClosed(claim)) {
      return res.status(409).json({ error: "Refund can only be approved on an open billing ticket" });
    }

    // Refund may never exceed what was paid (POS order in PostgreSQL or MongoDB) or requested amount for ORD-UNLISTED
    const customer = await prisma.customer.findUnique({ where: { id: claim.customerId }, select: { licensePlate: true } });
    const order = await prisma.posOrder.findUnique({ where: { id: claim.posRecordId } });
    const mongoCeiling =
      !order && claim.posRecordId !== "ORD-UNLISTED" && customer
        ? await findPaidOrderCeilingInMongo(customer.licensePlate, claim.posRecordId)
        : null;
    const ceiling =
      claim.posRecordId === "ORD-UNLISTED"
        ? claim.requestedAmount != null
          ? Number(claim.requestedAmount)
          : null
        : order
          ? Number(order.amountSar)
          : mongoCeiling;
    if (ceiling == null || parsed.data.amount > ceiling) {
      return res.status(400).json({
        error: ceiling == null
          ? "No verified order amount or requested amount on file; cannot approve a refund"
          : `Refund (SAR ${parsed.data.amount}) exceeds the verified ceiling of SAR ${ceiling}`,
      });
    }
    if (claim.posRecordId === "ORD-UNLISTED") {
      const config = await getSystemConfig();
      const cap = Number(config.damageApprovalCapSar);
      if (parsed.data.amount > cap && req.staff!.role !== StaffRole.BUSINESS_OWNER) {
        return res.status(403).json({
          error: `Unlisted order refund (SAR ${parsed.data.amount}) exceeds the approval cap of SAR ${cap}. Only the Business Owner can approve this refund.`,
        });
      }
    }
    const dupRrn = await prisma.complaint.findFirst({ where: { rrn: parsed.data.rrn, id: { not: claim.id } } });
    if (dupRrn) return res.status(409).json({ error: "This RRN is already attached to another ticket" });

    const waText = `Your refund of SAR ${parsed.data.amount} has been processed back to your card (RRN: ${parsed.data.rrn}). Expected in 2-5 business days.`;
    try {
      const claimed = await prisma.complaint.updateMany({
        where: {
          id: claim.id,
          status: { not: TicketStatus.RESOLVED },
          payoutStatus: { notIn: [PayoutStatus.PAID, PayoutStatus.PAID_RRN] },
        },
        data: {
          status: TicketStatus.RESOLVED,
          resolutionStatus: ResolutionStatus.APPROVED,
          approvedAmount: parsed.data.amount,
          rrn: parsed.data.rrn,
          payoutStatus: PayoutStatus.PAID_RRN,
          resolutionNote: `Card reversal processed via Mada/Visa. RRN: ${parsed.data.rrn}. Approved by ${req.staff!.name}.`,
        },
      });
      if (claimed.count !== 1) {
        return res.status(409).json({ error: "Refund can only be approved on an open billing ticket" });
      }
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res.status(409).json({ error: "This RRN is already attached to another ticket" });
      }
      throw e;
    }

    await prisma.auditLog.create({
      data: {
        complaintId: claim.id,
        staffId: req.staff!.staffId,
        actorName: req.staff!.name,
        action: "APPROVE_BILLING_REFUND",
        details: `Refund of SAR ${parsed.data.amount} processed with RRN ${parsed.data.rrn}.`,
      },
    });
    await prisma.message.create({
      data: {
        complaintId: claim.id,
        sender: req.staff!.name,
        channel: MessageChannel.WHATSAPP,
        body: waText,
      },
    });
    const updated = await prisma.complaint.findUnique({ where: { id: claim.id } });

    void notifyCustomerWhatsApp(claim.id, claim.customerId, waText);
    return res.json({ success: true, complaint: updated });
  }));

  // Request Repair Quotation & Waiver from Customer
  router.post("/claims/:id/damage/request-quote", requireStaff, requireRoles(StaffRole.OPS_MANAGER, StaffRole.CSM, StaffRole.ADMIN, StaffRole.BUSINESS_OWNER), asyncHandler(async (req: StaffRequest, res) => {
    const parsed = z.object({ resolutionNote: z.string().max(1000).optional() }).safeParse(req.body);
    const note = parsed.success && parsed.data.resolutionNote
      ? parsed.data.resolutionNote
      : "Your damage claim has been approved for repair review. Please upload an official repair quotation and sign the liability waiver in your tracker.";

    const complaint = await loadClaim(req, res);
    if (!complaint) return;
    if (complaint.type !== "DAMAGE" || isClosed(complaint) || complaint.quotationApproved) {
      return res.status(409).json({ error: "Quotation can only be requested on open Damage claims awaiting a quotation" });
    }

    const cust = await prisma.customer.findUnique({
      where: { id: complaint.customerId },
      select: { id: true, phone: true, licensePlate: true },
    });
    const directUrl = cust
      ? buildDirectTicketUrl(cust, complaint.id)
      : process.env.PUBLIC_PORTAL_URL || "https://crm.rush.com.sa/";
    const waText = `Hi, your damage claim ${complaint.id} has been approved for repair review. Open your ticket directly to upload the official repair quotation and sign the waiver: ${directUrl}`;
    const updated = await prisma.complaint.update({
      where: { id: complaint.id },
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
            body: waText,
          },
        },
      },
    });

    void notifyCustomerWhatsApp(complaint.id, complaint.customerId, waText);
    return res.json({ success: true, complaint: updated });
  }));

  // Approve Damage Quotation (cap enforced against the customer-submitted amount stored on the ticket)
  router.post("/claims/:id/damage/approve-quote", requireStaff, requireRoles(StaffRole.FINANCE, StaffRole.CSM, StaffRole.ADMIN, StaffRole.BUSINESS_OWNER), asyncHandler(async (req: StaffRequest, res) => {
    const config = await getSystemConfig();
    const complaint = await loadClaim(req, res);
    if (!complaint) return;
    if (complaint.type !== "DAMAGE" || isClosed(complaint) || complaint.quotationApproved) {
      return res.status(409).json({ error: "No open quotation awaiting approval" });
    }
    if (!complaint.quotationUrl || !complaint.waiverSigned) {
      return res.status(409).json({ error: "Customer must upload a quotation and sign the waiver first" });
    }

    // The amount being approved is ALWAYS the stored one; only the Business Owner may override it, and the override is audited.
    const stored = Number(complaint.quotedAmount || 0);
    const body = z.object({ quotedAmount: z.number().positive().max(100000).optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Invalid quoted amount" });
    if (body.data.quotedAmount !== undefined && body.data.quotedAmount !== stored && req.staff!.role !== StaffRole.BUSINESS_OWNER) {
      return res.status(403).json({ error: "Only the Business Owner can change a customer-submitted quotation amount" });
    }
    const quoted = body.data.quotedAmount ?? stored;
    if (!(quoted > 0)) return res.status(409).json({ error: "A positive quoted amount is required before approval" });

    const cap = Number(config.damageApprovalCapSar);
    if (quoted > cap && req.staff!.role !== StaffRole.BUSINESS_OWNER) {
      return res.status(403).json({
        error: `Repair quotation (SAR ${quoted}) exceeds the configurable approval cap of SAR ${cap}. Only the Business Owner can approve this quotation.`,
      });
    }

    const cust = await prisma.customer.findUnique({
      where: { id: complaint.customerId },
      select: { id: true, phone: true, licensePlate: true },
    });
    const directUrl = cust
      ? buildDirectTicketUrl(cust, complaint.id)
      : process.env.PUBLIC_PORTAL_URL || "https://crm.rush.com.sa/";
    const waText = `Your repair quotation of SAR ${quoted} has been approved! Open your ticket directly to upload your official repair invoice and IBAN to receive payout: ${directUrl}`;
    const claimed = await prisma.complaint.updateMany({
      where: {
        id: complaint.id,
        quotationApproved: false,
        status: { not: TicketStatus.RESOLVED },
        payoutStatus: { notIn: [PayoutStatus.PAID, PayoutStatus.PAID_RRN] },
      },
      data: {
        quotationApproved: true,
        quotedAmount: quoted,
        payoutStatus: PayoutStatus.AWAITING_INVOICE_IBAN,
      },
    });
    if (claimed.count !== 1) {
      return res.status(409).json({ error: "No open quotation awaiting approval" });
    }
    await prisma.auditLog.create({
      data: {
        complaintId: complaint.id,
        staffId: req.staff!.staffId,
        actorName: req.staff!.name,
        action: "APPROVE_DAMAGE_QUOTE",
        details: `Repair quotation of SAR ${quoted} (submitted: SAR ${stored}) approved by ${req.staff!.name} (${req.staff!.role}). Unlocked Step 2 for customer invoice & IBAN.`,
      },
    });
    await prisma.message.create({
      data: {
        complaintId: complaint.id,
        sender: req.staff!.name,
        channel: MessageChannel.WHATSAPP,
        body: waText,
      },
    });
    const updated = await prisma.complaint.findUnique({ where: { id: complaint.id } });

    void notifyCustomerWhatsApp(complaint.id, complaint.customerId, waText);
    return res.json({ success: true, complaint: updated });
  }));

  // Sign Damage Compensation Form (Technician / Operations Manager / Finance) with R2 storage & reuse
  router.post("/claims/:id/damage/sign", requireStaff, asyncHandler(async (req: StaffRequest, res) => {
    const parsed = z.object({
      slot: z.enum(["tech", "ops", "finance"]),
      useSaved: z.boolean().optional(),
      signatureDataUrl: z.string().max(300000).optional(),
      saveAsDefault: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid signature payload" });

    const { slot, useSaved, signatureDataUrl, saveAsDefault } = parsed.data;
    const allowedBySlot: Record<"tech" | "ops" | "finance", StaffRole[]> = {
      tech: [StaffRole.OPS_MANAGER, StaffRole.ADMIN, StaffRole.BUSINESS_OWNER],
      ops: [StaffRole.OPS_MANAGER, StaffRole.ADMIN, StaffRole.BUSINESS_OWNER],
      finance: [StaffRole.FINANCE, StaffRole.ADMIN, StaffRole.BUSINESS_OWNER],
    };
    if (!allowedBySlot[slot].includes(req.staff!.role)) {
      return res.status(403).json({ error: "Your role is not permitted to sign this section" });
    }

    const complaint = await loadClaim(req, res);
    if (!complaint) return;
    if (complaint.type !== "DAMAGE") {
      return res.status(409).json({ error: "Staff signatures apply only to Damage claims" });
    }

    let key: string | null = null;
    if (useSaved) {
      const me = await prisma.staffUser.findUnique({ where: { id: req.staff!.staffId }, select: { signatureUrl: true } });
      if (!me?.signatureUrl) {
        return res.status(400).json({ error: "No saved signature found. Please draw your signature first." });
      }
      key = me.signatureUrl;
    } else {
      if (!signatureDataUrl) return res.status(400).json({ error: "Signature image is required" });
      key = await uploadSignatureDataUrl(signatureDataUrl);
      if (!key) return res.status(400).json({ error: "Invalid signature image format" });
      if (saveAsDefault) {
        await prisma.staffUser.update({ where: { id: req.staff!.staffId }, data: { signatureUrl: key } });
      }
    }

    const updateData =
      slot === "tech"
        ? { techSignatureUrl: key, techSignedBy: req.staff!.name }
        : slot === "ops"
          ? { opsSignatureUrl: key, opsSignedBy: req.staff!.name }
          : { financeSignatureUrl: key, financeSignedBy: req.staff!.name };

    const actionMap = {
      tech: "SIGN_DAMAGE_TECH",
      ops: "SIGN_DAMAGE_OPS",
      finance: "SIGN_DAMAGE_FINANCE",
    };

    await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        ...updateData,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: actionMap[slot],
            details: `${slot.toUpperCase()} signature ${useSaved ? "reused" : "captured"} by ${req.staff!.name} (${req.staff!.role}).`,
          },
        },
      },
    });
    invalidateClaimsCache();

    return res.json({
      success: true,
      slot,
      signatureUrl: signFileUrl(key),
      signedBy: req.staff!.name,
      savedSignatureUrl: saveAsDefault || useSaved ? signFileUrl(key) : undefined,
    });
  }));

  // Refuse Complaint
  router.post("/claims/:id/refuse", requireStaff, requireRoles(StaffRole.ADMIN, StaffRole.BUSINESS_OWNER, StaffRole.CSM, StaffRole.OPS_MANAGER), asyncHandler(async (req: StaffRequest, res) => {
    const parsed = z.object({ resolutionNote: z.string().min(5).max(1000) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Detailed resolution note is required when refusing a claim" });
    }
    const claim = await loadClaim(req, res);
    if (!claim) return;
    if (isClosed(claim)) return res.status(409).json({ error: "Ticket is already closed or paid" });

    const waText = `Update on ticket ${claim.id}: After review, we are unable to approve this claim. Reason: ${parsed.data.resolutionNote}`;
    const claimed = await prisma.complaint.updateMany({
      where: {
        id: claim.id,
        status: { not: TicketStatus.RESOLVED },
        payoutStatus: { notIn: [PayoutStatus.PAID, PayoutStatus.PAID_RRN] },
      },
      data: {
        status: TicketStatus.RESOLVED,
        resolutionStatus: ResolutionStatus.REFUSED,
        payoutStatus: PayoutStatus.DECLINED,
        resolutionNote: parsed.data.resolutionNote,
      },
    });
    if (claimed.count !== 1) {
      return res.status(409).json({ error: "Ticket is already closed or paid" });
    }
    await prisma.auditLog.create({
      data: {
        complaintId: claim.id,
        staffId: req.staff!.staffId,
        actorName: req.staff!.name,
        action: "REFUSE_CLAIM",
        details: `Claim declined by ${req.staff!.name}. Reason: ${parsed.data.resolutionNote}`,
      },
    });
    await prisma.message.create({
      data: {
        complaintId: claim.id,
        sender: req.staff!.name,
        channel: MessageChannel.WHATSAPP,
        body: waText,
      },
    });
    const updated = await prisma.complaint.findUnique({ where: { id: claim.id } });

    void notifyCustomerWhatsApp(claim.id, claim.customerId, waText);
    return res.json({ success: true, complaint: updated });
  }));

  // Patch non-financial claim fields. Money/closure state may ONLY change through the action endpoints above.
  router.patch("/claims/:id", requireStaff, requireRoles(StaffRole.ADMIN, StaffRole.BUSINESS_OWNER, StaffRole.CSM, StaffRole.OPS_MANAGER), asyncHandler(async (req: StaffRequest, res) => {
    const schema = z.object({
      resolutionNote: z.string().max(1000).nullable().optional(),
      status: z.enum(["SUBMITTED", "INVESTIGATING"]).optional(),
      assignedRole: z.nativeEnum(StaffRole).optional(),
      assignedStaffName: z.string().max(80).optional(),
      vehicleZones: z.array(z.string().max(60)).max(20).optional(),
      initialAssessment: z.string().max(120).nullable().optional(),
      vehicleColor: z.string().max(60).nullable().optional(),
    }).strict();

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Only resolutionNote, status (SUBMITTED/INVESTIGATING), assignment and zones can be patched; use the action endpoints for approvals and payouts" });
    }
    const complaint = await loadClaim(req, res);
    if (!complaint) return;
    if (isClosed(complaint)) return res.status(409).json({ error: "Ticket is closed" });

    const updated = await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        ...parsed.data,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "PATCH_CLAIM",
            details: `Fields changed by ${req.staff!.name}: ${Object.keys(parsed.data).join(", ")}`,
          },
        },
      },
    });

    return res.json({ success: true, complaint: updated });
  }));

  // Post Internal or Customer Message (Restricted from FINANCE-only role - REM-005)
  router.post("/claims/:id/messages", requireStaff, requireRoles(StaffRole.ADMIN, StaffRole.BUSINESS_OWNER, StaffRole.CSM, StaffRole.OPS_MANAGER), asyncHandler(async (req: StaffRequest, res) => {
    const schema = z.object({
      body: z.string().min(1).max(2000),
      channel: z.nativeEnum(MessageChannel).default(MessageChannel.INTERNAL),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid message text is required" });
    }
    const claim = await loadClaim(req, res);
    if (!claim) return;

    const message = await prisma.message.create({
      data: { complaintId: claim.id, sender: req.staff!.name, channel: parsed.data.channel, body: parsed.data.body },
    });
    if (parsed.data.channel === MessageChannel.WHATSAPP) {
      void notifyCustomerWhatsApp(claim.id, claim.customerId, parsed.data.body);
    }
    return res.json(message);
  }));

  // ==========================================
  // 6. Finance & Bank Transfer Disbursement (Owner/Admin/Finance)
  // ==========================================

  const financeRoles = [StaffRole.BUSINESS_OWNER, StaffRole.ADMIN, StaffRole.FINANCE] as StaffRole[];

  router.get("/finance", requireStaff, requireRoles(...financeRoles), asyncHandler(async (req: StaffRequest, res) => {
    const scopeWhere = branchScopeWhere(req.staff!);
    const complaints = await prisma.complaint.findMany({
      where: {
        ...scopeWhere,
        OR: [
          { payoutStatus: { not: PayoutStatus.PENDING_REVIEW } },
          { approvedAmount: { not: null } },
          { rewashCode: { not: null } },
        ],
      },
      include: { customer: true },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    });

    return res.json(
      complaints.map((c) => ({
        id: c.id,
        customer: { name: c.customer.name, phone: c.customer.phone, plate: c.customer.licensePlate },
        branch: c.site,
        type: c.type,
        amountSar: Number(c.approvedAmount || c.requestedAmount || c.quotedAmount || 0),
        payoutStatus: c.payoutStatus,
        iban: maskIban(c.iban),
        bankName: c.bankName || "—",
        accountHolder: c.accountHolder ? "•••• " + String(decryptField(c.accountHolder) || "").slice(-3) : "—",
        rrn: c.rrn || "—",
        rewashCode: c.rewashCode || "—",
        transferRef: c.transferRef || "—",
        updatedAt: c.updatedAt,
      }))
    );
  }));

  // Reveal full bank details for a pending or paid transfer — audited, rate limited
  router.get("/finance/:id/bank-details", requireStaff, requireRoles(...financeRoles), ibanRevealLimiter, asyncHandler(async (req: StaffRequest, res) => {
    const c = await loadClaim(req, res);
    if (!c) return;
    if ((c.payoutStatus !== PayoutStatus.PENDING_BANK_TRANSFER && c.payoutStatus !== PayoutStatus.PAID) || !c.iban) {
      return res.status(409).json({ error: "No bank transfer details available for this ticket" });
    }
    auditLog(prisma, req.staff, "REVEAL_BANK_DETAILS", `ticket=${c.id}`, c.id);
    return res.json({
      id: c.id,
      iban: decryptField(c.iban),
      accountHolder: decryptField(c.accountHolder),
      bankName: c.bankName,
      amountSar: Number(c.approvedAmount || c.quotedAmount || 0),
    });
  }));

  // Save Finance Repair Invoice & Wafeq Journal details (Finance / Admin / Business Owner)
  router.post("/finance/:id/invoice-details", requireStaff, requireRoles(...financeRoles), asyncHandler(async (req: StaffRequest, res) => {
    const schema = z.object({
      wafeqJournalNo: z.string().max(80).nullable().optional(),
      workshopName: z.string().max(160).nullable().optional(),
      invoiceNumber: z.string().max(80).nullable().optional(),
      invoiceDate: z.string().max(40).nullable().optional(),
      invoiceIssuedTo: z.string().max(160).nullable().optional(),
      invoiceTotalSar: z.number().nonnegative().max(100000).nullable().optional(),
      invoiceVatSar: z.number().nonnegative().max(100000).nullable().optional(),
      invoiceItems: z.string().max(500).nullable().optional(),
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid invoice / Wafeq details payload" });
    }
    const complaint = await loadClaim(req, res);
    if (!complaint) return;
    if (complaint.type !== "DAMAGE") {
      return res.status(409).json({ error: "Invoice & Wafeq details apply only to Damage claims" });
    }

    const updated = await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        ...parsed.data,
        auditLogs: {
          create: {
            staffId: req.staff!.staffId,
            actorName: req.staff!.name,
            action: "UPDATE_FINANCE_INVOICE",
            details: `Finance invoice/Wafeq details updated by ${req.staff!.name} (${req.staff!.role}).`,
          },
        },
      },
    });
    return res.json({ success: true, complaint: updated });
  }));

  // Mark Bank Transfer Paid
  router.post("/finance/:id/mark-paid", requireStaff, requireRoles(...financeRoles), asyncHandler(async (req: StaffRequest, res) => {
    const parsed = z.object({ transferRef: z.string().regex(/^[A-Za-z0-9\-_]{3,40}$/) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Transfer reference (e.g. TRF-994012) is required" });
    }

    const complaint = await loadClaim(req, res);
    if (!complaint) return;
    if (complaint.payoutStatus !== PayoutStatus.PENDING_BANK_TRANSFER || !complaint.iban || !complaint.quotationApproved) {
      return res.status(409).json({ error: "Ticket is not awaiting a bank transfer (needs approved quotation, invoice and IBAN)" });
    }
    const baseAmount = Number(complaint.approvedAmount || complaint.quotedAmount || 0);
    const invAmount =
      complaint.invoiceTotalSar != null && Number(complaint.invoiceTotalSar) > 0
        ? Number(complaint.invoiceTotalSar)
        : baseAmount;
    const amount = Math.min(baseAmount, invAmount);
    if (!(amount > 0)) return res.status(409).json({ error: "No approved amount on this ticket" });

    const waText = `Your payment has been sent to your bank account! Transfer Ref: ${parsed.data.transferRef}. Thank you for choosing RUSH Car Wash.`;
    const claimed = await prisma.complaint.updateMany({
      where: {
        id: complaint.id,
        payoutStatus: PayoutStatus.PENDING_BANK_TRANSFER,
        status: { not: TicketStatus.RESOLVED },
        quotationApproved: true,
      },
      data: {
        status: TicketStatus.RESOLVED,
        resolutionStatus: ResolutionStatus.APPROVED,
        payoutStatus: PayoutStatus.PAID,
        approvedAmount: amount,
        transferRef: parsed.data.transferRef,
        resolutionNote: `Bank transfer executed. Ref: ${parsed.data.transferRef}. Logged by ${req.staff!.name}.`,
      },
    });
    if (claimed.count !== 1) {
      return res.status(409).json({ error: "Ticket is no longer awaiting a bank transfer" });
    }

    await prisma.auditLog.create({
      data: {
        complaintId: complaint.id,
        staffId: req.staff!.staffId,
        actorName: req.staff!.name,
        action: "MARK_PAID",
        details: `Bank transfer of SAR ${amount} marked paid. Ref: ${parsed.data.transferRef} by ${req.staff!.name}.`,
      },
    });
    await prisma.message.create({
      data: {
        complaintId: complaint.id,
        sender: req.staff!.name,
        channel: MessageChannel.WHATSAPP,
        body: waText,
      },
    });
    const updated = await prisma.complaint.findUnique({ where: { id: complaint.id } });

    void notifyCustomerWhatsApp(complaint.id, complaint.customerId, waText);
    return res.json({ success: true, complaint: updated });
  }));

  // Export Finance CSV (RFC-4180, formula-injection safe, IBAN masked, access logged)
  router.get("/finance/export.csv", requireStaff, requireRoles(...financeRoles), asyncHandler(async (req: StaffRequest, res) => {
    const complaints = await prisma.complaint.findMany({
      where: branchScopeWhere(req.staff!),
      include: { customer: true },
      orderBy: { createdAt: "desc" },
      take: 10000,
    });
    auditLog(prisma, req.staff, "EXPORT_FINANCE_CSV", `rows=${complaints.length}`);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=rush_finance_export_${Date.now()}.csv`);

    const rows = [
      ["Ticket ID", "Branch", "Type", "Status", "Payout Status", "Customer", "Phone", "Plate", "Amount (SAR)", "IBAN (masked)", "Bank", "Transfer Ref / RRN", "Rewash Code", "Staff In Charge", "Date"].map(csvCell).join(","),
    ];
    for (const c of complaints) {
      const amt = Number(c.approvedAmount || c.requestedAmount || c.quotedAmount || 0);
      rows.push(
        [
          c.id, c.site, c.type, c.status, c.payoutStatus, c.customer.name, c.customer.phone, c.customer.licensePlate,
          amt.toFixed(2), c.iban ? maskIban(c.iban) : "", c.bankName || "", c.transferRef || c.rrn || "", c.rewashCode || "",
          c.assignedStaffName || "", formatRiyadhCsv(c.createdAt),
        ].map(csvCell).join(",")
      );
    }
    return res.send(rows.join("\r\n"));
  }));

  // ==========================================
  // 7. Staff Directory & RBAC Controls
  // ==========================================

  router.get("/staff", requireStaff, requireRoles(...PRIVILEGED), asyncHandler(async (_req, res) => {
    const staff = await prisma.staffUser.findMany({ orderBy: { createdAt: "asc" }, select: STAFF_PUBLIC });
    return res.json(staff);
  }));

  /** ADMINs may manage only non-privileged staff; only the Business Owner manages ADMIN/OWNER accounts. */
  function canManage(actor: StaffPayload, targetRole: StaffRole, newRole?: StaffRole) {
    if (actor.role === StaffRole.BUSINESS_OWNER) return true;
    if (actor.role !== StaffRole.ADMIN) return false;
    return !PRIVILEGED.includes(targetRole) && !(newRole && PRIVILEGED.includes(newRole));
  }

  router.post("/staff", requireStaff, requireRoles(...PRIVILEGED), asyncHandler(async (req: StaffRequest, res) => {
    const schema = z.object({
      name: z.string().min(2).max(80),
      email: z.string().email().max(200),
      phone: z.string().max(20).optional(),
      role: z.nativeEnum(StaffRole),
      branch: z.string().max(80).default("RUSH Al Kharj"),
      password: PASSWORD_POLICY, // required: no default/shared credentials
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (!canManage(req.staff!, parsed.data.role, parsed.data.role)) {
      return res.status(403).json({ error: "Only the Business Owner can create Admin or Owner accounts" });
    }

    const { password, ...staffData } = parsed.data;
    staffData.email = staffData.email.trim().toLowerCase();

    const existing = await prisma.staffUser.findFirst({ where: { email: { equals: staffData.email, mode: "insensitive" } } });
    if (existing) {
      return res.status(400).json({ error: "Staff user with this email already exists" });
    }

    const created = await prisma.staffUser.create({
      data: { ...staffData, passwordHash: await bcrypt.hash(password, 12) },
      select: STAFF_PUBLIC,
    });
    auditLog(prisma, req.staff, "STAFF_CREATE", `new=${created.id} role=${created.role}`);
    return res.json(created);
  }));

  router.patch("/staff/:id", requireStaff, requireRoles(...PRIVILEGED), asyncHandler(async (req: StaffRequest, res) => {
    const schema = z.object({
      role: z.nativeEnum(StaffRole).optional(),
      branch: z.string().max(80).optional(),
      active: z.boolean().optional(),
    }).strict();

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const target = await prisma.staffUser.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: "Staff user not found" });
    if (target.id === req.staff!.staffId && (parsed.data.role !== undefined || parsed.data.active !== undefined)) {
      return res.status(403).json({ error: "You cannot change your own role or active status" });
    }
    if (!canManage(req.staff!, target.role, parsed.data.role)) {
      return res.status(403).json({ error: "Only the Business Owner can modify Admin or Owner accounts" });
    }
    if (target.role === StaffRole.BUSINESS_OWNER && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== StaffRole.BUSINESS_OWNER))) {
      const owners = await prisma.staffUser.count({ where: { role: StaffRole.BUSINESS_OWNER, active: true } });
      if (owners <= 1) return res.status(409).json({ error: "Cannot demote or deactivate the last active Business Owner" });
    }

    const updated = await prisma.staffUser.update({ where: { id: target.id }, data: parsed.data, select: STAFF_PUBLIC });
    staffCache.delete(target.id);
    auditLog(prisma, req.staff, "STAFF_UPDATE", `target=${target.id} ${JSON.stringify(parsed.data)}`);
    return res.json(updated);
  }));

  router.post("/staff/:id/reset-password", requireStaff, requireRoles(...PRIVILEGED), asyncHandler(async (req: StaffRequest, res) => {
    const parsed = z.object({ newPassword: PASSWORD_POLICY }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const target = await prisma.staffUser.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: "Staff user not found" });
    if (!canManage(req.staff!, target.role)) return res.status(403).json({ error: "Not permitted for this account" });
    await prisma.staffUser.update({ where: { id: target.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) } });
    staffCache.delete(target.id);
    auditLog(prisma, req.staff, "STAFF_PASSWORD_RESET", `target=${target.id}`);
    return res.json({ success: true });
  }));

  // ==========================================
  // 8. Data-subject requests (PDPL) — Business Owner only, audited
  // ==========================================

  router.get("/customers/:id/export", requireStaff, requireRoles(StaffRole.BUSINESS_OWNER), asyncHandler(async (req: StaffRequest, res) => {
    const data = await exportCustomerData(prisma, req.params.id);
    if (!data) return res.status(404).json({ error: "Customer not found" });
    auditLog(prisma, req.staff, "CUSTOMER_EXPORT", `customer=${req.params.id}`);
    return res.json(data);
  }));

  router.post("/customers/:id/anonymise", requireStaff, requireRoles(StaffRole.BUSINESS_OWNER), asyncHandler(async (req: StaffRequest, res) => {
    const open = await prisma.complaint.count({ where: { customerId: req.params.id, status: { not: TicketStatus.RESOLVED } } });
    if (open) return res.status(409).json({ error: "Customer has open tickets; resolve them first" });
    const ok = await anonymiseCustomer(prisma, req.params.id);
    if (!ok) return res.status(404).json({ error: "Customer not found" });
    const complaints = await prisma.complaint.findMany({
      where: { customerId: req.params.id },
      select: { id: true, mediaUrls: true, invoiceUrl: true, quotationUrl: true, bankSmsUrl: true, waiverSignature: true },
    });
    if (complaints.length) {
      await deleteFiles(complaints.flatMap((c) => [...(c.mediaUrls || []), c.invoiceUrl, c.quotationUrl, c.bankSmsUrl, c.waiverSignature]));
      const complaintIds = complaints.map((c) => c.id);
      await prisma.message.updateMany({
        where: { complaintId: { in: complaintIds } },
        data: { sender: "Anonymised", body: "[removed on customer request]" },
      });
    }
    await prisma.complaint.updateMany({
      where: { customerId: req.params.id },
      data: { summary: "[removed on customer request]", mediaUrls: [], invoiceUrl: null, quotationUrl: null, iban: null, accountHolder: null, bankName: null, bankSmsText: null, bankSmsUrl: null, cardLast4: null, waiverSignature: null },
    });
    auditLog(prisma, req.staff, "CUSTOMER_ANONYMISE", `customer=${req.params.id}`);
    return res.json({ success: true });
  }));

  return router;
}
