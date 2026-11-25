import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { StaffRole, ComplaintType, TicketStatus, PayoutStatus, ResolutionStatus } from "@prisma/client";
import { InMemoryPrismaClient, createIsolatedApp } from "./helpers/inMemoryPrisma";
import { STAFF_JWT_SECRET } from "../src/config/env";
import { hashOtp, normalizePhone } from "../src/utils/normalize";
import { signCustomerToken } from "../src/middleware/auth";
import { runRetention } from "../src/services/retention";
import { runSlaSweep } from "../src/services/slaSweeper";

const TEST_PW = "Enterprise!Audit#2026";
const uploadedLocalPaths: string[] = [];

function trackUploadKeyOrUrl(urlOrKey?: string | null) {
  if (!urlOrKey) return;
  const cleaned = urlOrKey.split("?")[0];
  const rel = cleaned.startsWith("/api/files/") ? cleaned.slice("/api/files/".length) : cleaned;
  const abs = path.resolve(process.cwd(), "uploads", rel);
  if (abs.startsWith(path.resolve(process.cwd(), "uploads") + path.sep)) {
    uploadedLocalPaths.push(abs);
  }
}

function signStaffJwt(staff: { id: string; name: string; role: StaffRole; branch: string; email: string; passwordHash: string }) {
  const pwdFp = crypto.createHmac("sha256", STAFF_JWT_SECRET).update(staff.passwordHash).digest("hex").slice(0, 16);
  return jwt.sign(
    { staffId: staff.id, name: staff.name, role: staff.role, branch: staff.branch, email: staff.email, pwdFp },
    STAFF_JWT_SECRET,
    { expiresIn: "8h", audience: "rush-staff", issuer: "rush-care" }
  );
}

describe("Enterprise Production Go-Live Audit & Regression Suite (Phase 16 Verified)", { timeout: 60000 }, () => {
  let mem: InMemoryPrismaClient;
  let app: any;
  let owner: any;
  let admin: any;
  let opsKharj: any;
  let opsBranchB: any;
  let csm: any;
  let finance: any;
  let financeAll: any;
  let inactiveStaff: any;

  let ownerToken: string;
  let adminToken: string;
  let opsKharjToken: string;
  let opsBranchBToken: string;
  let csmToken: string;
  let financeToken: string;
  let financeAllToken: string;
  let inactiveStaffToken: string;

  let userA: any; // Rule 14 authorized test customer: Awais / 569809578 / 5962HSS / MG
  let userB: any; // Synthetic User B / 500000001 / 1111AAA / Toyota Camry
  let userC: any; // Synthetic User C / 500000002 / 2222BBB / Toyota Hilux
  let userAToken: string;
  let userBToken: string;
  let userCToken: string;

  beforeAll(async () => {
    mem = new InMemoryPrismaClient();
    app = createIsolatedApp(mem);
    const pwHash = bcrypt.hashSync(TEST_PW, 10);

    owner = await mem.staffUser.create({ data: { name: "Audit Owner", email: "audit.owner@rush.com.sa", role: StaffRole.BUSINESS_OWNER, branch: "All Branches", active: true, passwordHash: pwHash } });
    admin = await mem.staffUser.create({ data: { name: "Audit Admin", email: "audit.admin@rush.com.sa", role: StaffRole.ADMIN, branch: "All Branches", active: true, passwordHash: pwHash } });
    opsKharj = await mem.staffUser.create({ data: { name: "Audit Ops Kharj", email: "audit.ops.kharj@rush.com.sa", role: StaffRole.OPS_MANAGER, branch: "RUSH Al Kharj", active: true, passwordHash: pwHash } });
    opsBranchB = await mem.staffUser.create({ data: { name: "Audit Ops BranchB", email: "audit.ops.b@rush.com.sa", role: StaffRole.OPS_MANAGER, branch: "SYNTHETIC_BRANCH_B", active: true, passwordHash: pwHash } });
    csm = await mem.staffUser.create({ data: { name: "Audit CSM", email: "audit.csm@rush.com.sa", role: StaffRole.CSM, branch: "All Branches", active: true, passwordHash: pwHash } });
    finance = await mem.staffUser.create({ data: { name: "Audit Finance Kharj", email: "audit.finance@rush.com.sa", role: StaffRole.FINANCE, branch: "RUSH Al Kharj", active: true, passwordHash: pwHash } });
    financeAll = await mem.staffUser.create({ data: { name: "Audit Finance Global", email: "audit.finance.all@rush.com.sa", role: StaffRole.FINANCE, branch: "All Branches", active: true, passwordHash: pwHash } });
    inactiveStaff = await mem.staffUser.create({ data: { name: "Audit Inactive", email: "audit.inactive@rush.com.sa", role: StaffRole.ADMIN, branch: "All Branches", active: false, passwordHash: pwHash } });

    ownerToken = signStaffJwt(owner);
    adminToken = signStaffJwt(admin);
    opsKharjToken = signStaffJwt(opsKharj);
    opsBranchBToken = signStaffJwt(opsBranchB);
    csmToken = signStaffJwt(csm);
    financeToken = signStaffJwt(finance);
    financeAllToken = signStaffJwt(financeAll);
    inactiveStaffToken = signStaffJwt(inactiveStaff);

    userA = await mem.customer.upsert({
      where: { licensePlate_phone: { licensePlate: "5962HSS", phone: "569809578" } },
      update: {},
      create: { name: "Awais", phone: "569809578", licensePlate: "5962HSS", vehicleModel: "MG" },
    });
    userB = await mem.customer.upsert({
      where: { licensePlate_phone: { licensePlate: "1111AAA", phone: "500000001" } },
      update: {},
      create: { name: "Synthetic User B", phone: "500000001", licensePlate: "1111AAA", vehicleModel: "Toyota Camry" },
    });
    userC = await mem.customer.upsert({
      where: { licensePlate_phone: { licensePlate: "2222BBB", phone: "500000002" } },
      update: {},
      create: { name: "Synthetic User C", phone: "500000002", licensePlate: "2222BBB", vehicleModel: "Toyota Hilux" },
    });

    userAToken = signCustomerToken({ customerId: userA.id, phone: userA.phone, licensePlate: userA.licensePlate, scope: "otp" }, "30m");
    userBToken = signCustomerToken({ customerId: userB.id, phone: userB.phone, licensePlate: userB.licensePlate, scope: "otp" }, "30m");
    userCToken = signCustomerToken({ customerId: userC.id, phone: userC.phone, licensePlate: userC.licensePlate, scope: "otp" }, "30m");

    const now = Date.now();
    mem.washVisits.push(
      { id: "POS-AUD-A1", customerId: userA.id, site: "RUSH Al Kharj", lane: "Tunnel 1", packageName: "Nano Ceramic", washedAt: new Date(now - 3600_000) },
      { id: "POS-AUD-B1", customerId: userB.id, site: "RUSH Al Kharj", lane: "Tunnel 1", packageName: "Fresh Wash", washedAt: new Date(now - 3600_000) },
      { id: "POS-AUD-C1", customerId: userC.id, site: "SYNTHETIC_BRANCH_B", lane: "Tunnel 1", packageName: "Shiny Wash", washedAt: new Date(now - 3600_000) }
    );
    mem.posOrders.push(
      { id: "ORD-AUD-A1", customerId: userA.id, site: "RUSH Al Kharj", itemName: "Fresh Plan", amountSar: 75, paymentMethod: "Mada", orderedAt: new Date(now - 3600_000) },
      { id: "ORD-AUD-B1", customerId: userB.id, site: "RUSH Al Kharj", itemName: "Nano Plan", amountSar: 189, paymentMethod: "Apple Pay", orderedAt: new Date(now - 3600_000) }
    );
  });

  afterAll(async () => {
    for (const p of uploadedLocalPaths) {
      await fs.promises.unlink(p).catch(() => {});
    }
  });

  // =========================================================================
  // PHASE 2: CROSS-USER & MULTI-BRANCH ISOLATION (REGRESSION VERIFIED)
  // =========================================================================
  describe("Phase 2: Cross-User & Multi-Branch Isolation", () => {
    it("2.1 enforces customer ownership on /api/customer/history, non-sequential IDs, and authenticated /api/complaints/:id mutations", async () => {
      const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
      const upB = await request(app)
        .post("/api/upload")
        .set("Authorization", `Bearer ${userBToken}`)
        .field("category", "media")
        .attach("file", pdf, "dmg-b.pdf");
      expect(upB.status).toBe(201);
      trackUploadKeyOrUrl(upB.body.key);

      const createB = await request(app)
        .post("/api/complaints")
        .set("Authorization", `Bearer ${userBToken}`)
        .send({
          type: "DAMAGE",
          posRecordId: "POS-AUD-B1",
          posRecordLabel: "POS-AUD-B1 (Fresh Wash)",
          site: "RUSH Al Kharj",
          summary: "User B private bumper damage",
          vehicleZones: ["Front Bumper"],
          mediaUrls: [upB.body.url],
        });
      expect(createB.status).toBe(201);
      // REM-001: non-sequential 8-digit CSPRNG ticket ID
      expect(createB.body.id).toMatch(/^C-\d{8}$/);
      const bTicketId = createB.body.id;

      const histA = await request(app)
        .get("/api/customer/history?type=UNSATISFIED")
        .set("Authorization", `Bearer ${userAToken}`);
      expect(histA.status).toBe(200);
      expect(histA.body.records.map((r: any) => r.id)).toContain("POS-AUD-A1");
      expect(histA.body.records.map((r: any) => r.id)).not.toContain("POS-AUD-B1");

      const stealVisit = await request(app)
        .post("/api/complaints")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          type: "UNSATISFIED",
          posRecordId: "POS-AUD-B1",
          posRecordLabel: "POS-AUD-B1",
          site: "RUSH Al Kharj",
          summary: "Cross-user POS record probe",
        });
      expect(stealVisit.status).toBe(400);

      const muts = [
        request(app).post(`/api/complaints/${bTicketId}/damage/step1`).set("Authorization", `Bearer ${userAToken}`).send({ quotationUrl: upB.body.url }),
        request(app).post(`/api/complaints/${bTicketId}/damage/step2`).set("Authorization", `Bearer ${userAToken}`).send({ invoiceUrl: upB.body.url, bankName: "SNB", accountHolder: "Attacker", iban: "SA0380000000608010167519" }),
        request(app).post(`/api/complaints/${bTicketId}/damage/upload-doc`).set("Authorization", `Bearer ${userAToken}`).send({ field: "quotationUrl", url: upB.body.url }),
        request(app).post(`/api/complaints/${bTicketId}/whatsapp`).set("Authorization", `Bearer ${userAToken}`).send({ body: "hijack" }),
        request(app).post(`/api/complaints/${bTicketId}/messages`).set("Authorization", `Bearer ${userAToken}`).send({ body: "hijack" }),
        request(app).post(`/api/complaints/${bTicketId}/csat`).set("Authorization", `Bearer ${userAToken}`).send({ rating: 1 }),
      ];
      for (const reqP of muts) {
        expect((await reqP).status).toBe(404);
      }

      const cTrackToken = signCustomerToken({ customerId: userC.id, phone: userC.phone, licensePlate: userC.licensePlate, scope: "track", ticketIds: ["C-99999999"] }, "2h");
      expect((await request(app).post(`/api/complaints/${bTicketId}/messages`).set("Authorization", `Bearer ${cTrackToken}`).send({ body: "x" })).status).toBe(404);
    });

    it("2.2 [REGRESSION REM-001] /api/complaints/track NEVER issues trackToken or full details without verified OTP JWT", async () => {
      const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
      const upC = await request(app).post("/api/upload").set("Authorization", `Bearer ${userCToken}`).field("category", "quotations").attach("file", pdf, "q.pdf");
      trackUploadKeyOrUrl(upC.body.key);

      const cTicket = await mem.complaint.create({
        data: {
          id: "C-77010001",
          customerId: userC.id,
          type: ComplaintType.DAMAGE,
          status: TicketStatus.INVESTIGATING,
          resolutionStatus: ResolutionStatus.APPROVED,
          payoutStatus: PayoutStatus.AWAITING_INVOICE_IBAN,
          assignedRole: StaffRole.CSM,
          site: "RUSH Al Kharj",
          posRecordId: "POS-AUD-C1",
          posRecordLabel: "POS-AUD-C1",
          summary: "User C approved quote",
          quotationUrl: upC.body.key,
          waiverSigned: true,
          quotationApproved: true,
          quotedAmount: 190,
        },
      });

      // Unauthenticated attacker with Ticket ID + phone gets limited status ONLY
      const trackAnon = await request(app)
        .post("/api/complaints/track")
        .send({ query: cTicket.id, phone: "0500000002" });
      expect(trackAnon.status).toBe(200);
      expect(trackAnon.body.limited).toBe(true);
      expect(trackAnon.body.trackToken).toBeUndefined();
      expect(trackAnon.body.tickets[0].messages).toBeUndefined();
      expect(trackAnon.body.tickets[0].quotationUrl).toBeUndefined();

      // Authenticated owner WITH OTP token gets full access & trackToken, and can submit IBAN
      const trackAuthed = await request(app)
        .post("/api/complaints/track")
        .set("Authorization", `Bearer ${userCToken}`)
        .send({ query: cTicket.id, phone: "0500000002" });
      expect(trackAuthed.status).toBe(200);
      expect(trackAuthed.body.limited).toBe(false);
      expect(trackAuthed.body.trackToken).toBeDefined();

      const legitRes = await request(app)
        .post(`/api/complaints/${cTicket.id}/damage/step2`)
        .set("Authorization", `Bearer ${trackAuthed.body.trackToken}`)
        .send({
          invoiceUrl: upC.body.url,
          bankName: "Al Rajhi Bank",
          accountHolder: "Synthetic User C",
          iban: "SA4420000001234567891234",
        });
      expect(legitRes.status).toBe(200);
      expect(legitRes.body.payoutStatus).toBe("PENDING_BANK_TRANSFER");
    });

    it("2.3 [REGRESSION REM-002] /api/files/:key blocks cross-customer BOLA and deactivated staff on files & uploads", async () => {
      const secretPdf = Buffer.from("%PDF-1.4\n%USER-B-PRIVATE-INVOICE\n%%EOF\n");
      const upRes = await request(app)
        .post("/api/upload")
        .set("Authorization", `Bearer ${userBToken}`)
        .field("category", "invoices")
        .attach("file", secretPdf, "user-b-invoice.pdf");
      expect(upRes.status).toBe(201);
      const rawKeyPath = upRes.body.key as string;
      const signedUrl = upRes.body.url as string;
      trackUploadKeyOrUrl(rawKeyPath);

      // Attach file to a User B ticket
      await mem.complaint.create({
        data: {
          id: "C-77010002",
          customerId: userB.id,
          type: ComplaintType.DAMAGE,
          site: "RUSH Al Kharj",
          posRecordId: "VISIT-UNLISTED",
          posRecordLabel: "Earlier",
          summary: "B private invoice",
          invoiceUrl: rawKeyPath,
          assignedRole: StaffRole.OPS_MANAGER,
        },
      });

      // User A (unrelated customer) is BLOCKED (404)
      const crossFileRes = await request(app)
        .get(rawKeyPath)
        .set("Authorization", `Bearer ${userAToken}`);
      expect(crossFileRes.status).toBe(404);

      // User B (owner) and HMAC signed URL are ALLOWED (200)
      expect((await request(app).get(rawKeyPath).set("Authorization", `Bearer ${userBToken}`)).status).toBe(200);
      expect((await request(app).get(signedUrl)).status).toBe(200);

      // Deactivated staff user is BLOCKED (403) on /api/admin/claims, /api/files/:key, AND /api/upload
      expect((await request(app).get("/api/admin/claims").set("Authorization", `Bearer ${inactiveStaffToken}`)).status).toBe(403);
      expect((await request(app).get(rawKeyPath).set("Authorization", `Bearer ${inactiveStaffToken}`)).status).toBe(403);
      expect(
        (await request(app).post("/api/upload").set("Authorization", `Bearer ${inactiveStaffToken}`).field("category", "media").attach("file", secretPdf, "stale.pdf")).status
      ).toBe(403);
    });

    it("2.4 enforces branch scoping for OPS_MANAGER and branch-assigned FINANCE staff", async () => {
      await mem.complaint.create({
        data: {
          id: "C-77020001",
          customerId: userC.id,
          type: ComplaintType.DAMAGE,
          status: TicketStatus.PENDING_PAYOUT,
          payoutStatus: PayoutStatus.PENDING_BANK_TRANSFER,
          assignedRole: StaffRole.OPS_MANAGER,
          site: "SYNTHETIC_BRANCH_B",
          posRecordId: "VISIT-UNLISTED",
          posRecordLabel: "Earlier",
          summary: "Branch B damage claim",
        },
      });

      const opsClaims = await request(app).get("/api/admin/claims").set("Authorization", `Bearer ${opsKharjToken}`);
      expect(opsClaims.status).toBe(200);
      expect(opsClaims.body.some((c: any) => c.id === "C-77020001")).toBe(false);
      expect((await request(app).get("/api/admin/claims/C-77020001").set("Authorization", `Bearer ${opsKharjToken}`)).status).toBe(404);
      expect((await request(app).get("/api/admin/claims/C-77020001").set("Authorization", `Bearer ${opsBranchBToken}`)).status).toBe(200);

      // Branch-assigned FINANCE ("RUSH Al Kharj") cannot see Branch B; All-Branches FINANCE can
      const finKharjList = await request(app).get("/api/admin/finance").set("Authorization", `Bearer ${financeToken}`);
      expect(finKharjList.status).toBe(200);
      expect(finKharjList.body.some((c: any) => c.id === "C-77020001")).toBe(false);

      const finAllList = await request(app).get("/api/admin/finance").set("Authorization", `Bearer ${financeAllToken}`);
      expect(finAllList.status).toBe(200);
      expect(finAllList.body.some((c: any) => c.id === "C-77020001")).toBe(true);
    });
  });

  // =========================================================================
  // PHASE 3: AUTHENTICATION & ROLE-BASED ACCESS CONTROL
  // =========================================================================
  describe("Phase 3: Authentication & RBAC", () => {
    it("3.1 enforces OTP lockout, single-use claim, and cross-audience JWT isolation", async () => {
      const otpReq = await request(app)
        .post("/api/auth/request-otp")
        .send({ licensePlate: "5962HSS", phone: "0569809578" });
      expect(otpReq.status).toBe(200);
      expect(otpReq.body.devOtp).toBeUndefined();

      const validCode = "654321";
      await mem.otpSession.updateMany({ where: { phone: "569809578", verified: false }, data: { codeHash: hashOtp(validCode) } });

      for (let i = 0; i < 5; i++) {
        expect((await request(app).post("/api/auth/verify-otp").send({ licensePlate: "5962HSS", phone: "0569809578", code: "000000" })).status).toBe(401);
      }
      expect((await request(app).post("/api/auth/verify-otp").send({ licensePlate: "5962HSS", phone: "0569809578", code: validCode })).status).toBe(429);

      await mem.otpSession.deleteMany({ where: { phone: "569809578" } });
      await request(app).post("/api/auth/request-otp").send({ licensePlate: "5962HSS", phone: "0569809578" });
      await mem.otpSession.updateMany({ where: { phone: "569809578", verified: false }, data: { codeHash: hashOtp(validCode) } });

      const ok = await request(app).post("/api/auth/verify-otp").send({ licensePlate: "5962HSS", phone: "0569809578", code: validCode });
      expect(ok.status).toBe(200);
      expect((await request(app).post("/api/auth/verify-otp").send({ licensePlate: "5962HSS", phone: "0569809578", code: validCode })).status).toBe(400);

      expect((await request(app).get("/api/admin/claims").set("Authorization", `Bearer ${userAToken}`)).status).toBe(401);
      expect((await request(app).get("/api/customer/history").set("Authorization", `Bearer ${ownerToken}`)).status).toBe(401);
    });

    it("3.2 [REGRESSION REM-005 & REM-014] enforces 5-role RBAC, blocks FINANCE messages (403), and persists non-ticket AuditLogs", async () => {
      expect((await request(app).patch("/api/admin/config").set("Authorization", `Bearer ${adminToken}`).send({ maxSlaHours: 24 })).status).toBe(403);
      expect((await request(app).patch("/api/admin/config").set("Authorization", `Bearer ${ownerToken}`).send({ maxSlaHours: 48 })).status).toBe(200);

      expect((await request(app).post("/api/admin/staff").set("Authorization", `Bearer ${adminToken}`).send({ name: "Rogue Admin", email: "rogue@rush.com.sa", role: StaffRole.ADMIN, password: TEST_PW })).status).toBe(403);
      expect((await request(app).patch(`/api/admin/staff/${owner.id}`).set("Authorization", `Bearer ${adminToken}`).send({ active: false })).status).toBe(403);
      expect((await request(app).patch(`/api/admin/staff/${owner.id}`).set("Authorization", `Bearer ${ownerToken}`).send({ role: StaffRole.ADMIN })).status).toBe(403);

      expect((await request(app).get(`/api/admin/customers/${userA.id}/export`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(403);
      expect((await request(app).post(`/api/admin/customers/${userA.id}/anonymise`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(403);

      await mem.complaint.create({
        data: { id: "C-77030001", customerId: userA.id, type: ComplaintType.UNSATISFIED, site: "RUSH Al Kharj", posRecordId: "POS-AUD-A1", posRecordLabel: "POS-AUD-A1", summary: "Spots", assignedRole: StaffRole.ADMIN },
      });
      expect((await request(app).post("/api/admin/claims/C-77030001/unsatisfied/approve").set("Authorization", `Bearer ${opsKharjToken}`)).status).toBe(403);
      expect((await request(app).post("/api/admin/claims/C-77030001/unsatisfied/approve").set("Authorization", `Bearer ${financeToken}`)).status).toBe(403);

      // REM-005: FINANCE role is now blocked (403) from sending outbound customer messages
      const finMsg = await request(app)
        .post("/api/admin/claims/C-77030001/messages")
        .set("Authorization", `Bearer ${financeToken}`)
        .send({ body: "Blocked WhatsApp message from Finance role", channel: "WHATSAPP" });
      expect(finMsg.status).toBe(403);

      // REM-014: Non-ticket audit logs persisted to DB (CONFIG_UPDATE, RBAC_DENIED)
      await new Promise((r) => setTimeout(r, 15));
      const sysLogs = await mem.auditLog.findMany({ where: { complaintId: null } });
      expect(sysLogs.some((l: any) => l.action === "CONFIG_UPDATE")).toBe(true);
      expect(sysLogs.some((l: any) => l.action === "RBAC_DENIED")).toBe(true);
    });
  });

  // =========================================================================
  // PHASE 4: API SECURITY, VALIDATION & WEBHOOKS
  // =========================================================================
  describe("Phase 4: API Security, Validation & Webhooks", () => {
    it("4.1 rejects mass assignment, spoofed MIME magic bytes, and neutralizes CSV formula injection", async () => {
      const massRes = await request(app)
        .patch("/api/admin/claims/C-77030001")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ resolutionNote: "ok", approvedAmount: 99999, payoutStatus: "PAID" });
      expect(massRes.status).toBe(400);

      const spoofRes = await request(app)
        .post("/api/upload")
        .set("Authorization", `Bearer ${userAToken}`)
        .attach("file", Buffer.from("<script>alert(1)</script>"), { filename: "xss.jpg", contentType: "image/jpeg" });
      expect(spoofRes.status).toBe(400);

      await mem.complaint.create({
        data: { id: "C-77040001", customerId: userA.id, type: ComplaintType.OTHER, site: "RUSH Al Kharj", posRecordId: "VISIT-GENERAL", posRecordLabel: "General", summary: "Formula test", assignedRole: StaffRole.ADMIN, assignedStaffName: "=CMD|' /C calc'!A0" },
      });
      const csvRes = await request(app).get("/api/admin/finance/export.csv").set("Authorization", `Bearer ${financeToken}`);
      expect(csvRes.status).toBe(200);
      expect(csvRes.text).toContain('"\'=CMD|\' /C calc\'!A0"');
    });

    it("4.2 [REGRESSION REM-010 & REM-011] blocks international phone suffix collisions, query-token webhook auth, and phone-less Chatwoot matches", async () => {
      expect(normalizePhone("+44 7569 809578")).toBe("");
      expect(normalizePhone("00447569809578")).toBe("");
      expect(normalizePhone("+966 56 980 9578")).toBe("569809578");
      expect(normalizePhone("0569809578")).toBe("569809578");

      const secret = process.env.CHATWOOT_WEBHOOK_SECRET!;
      // ?token= query auth rejected (401)
      const queryAuthRes = await request(app)
        .post(`/api/complaints/webhooks/chatwoot?token=${secret}`)
        .send({ event: "message_created", id: 88001, message_type: "incoming", content: "C-77030001" });
      expect(queryAuthRes.status).toBe(401);

      // Header auth without sender phone does NOT match C-77030001 from text
      const noPhoneRes = await request(app)
        .post("/api/complaints/webhooks/chatwoot")
        .set("x-chatwoot-webhook-token", secret)
        .send({
          event: "message_created",
          id: 88002,
          message_type: "incoming",
          private: false,
          content: "Forcing message onto C-77030001 without sender phone",
          sender: { name: "Unknown Sender" },
          conversation: { custom_attributes: {} },
        });
      expect(noPhoneRes.status).toBe(200);
      expect(await mem.message.findFirst({ where: { externalId: "cw_88002" } })).toBeNull();

      // Header auth WITH matching customer phone attaches cleanly & deduplicates
      const validCw = await request(app)
        .post("/api/complaints/webhooks/chatwoot")
        .set("x-chatwoot-webhook-token", secret)
        .send({
          event: "message_created",
          id: 88003,
          message_type: "incoming",
          private: false,
          content: "Legit reply on C-77030001",
          sender: { name: "Awais", phone_number: "+966569809578" },
          conversation: { custom_attributes: {} },
        });
      expect(validCw.status).toBe(200);
      expect((await mem.message.findFirst({ where: { externalId: "cw_88003" } }))?.complaintId).toBe("C-77030001");
    });
  });

  // =========================================================================
  // PHASE 6 & 7: SIGNATURES, FINANCIAL INTEGRITY & CONCURRENCY
  // =========================================================================
  describe("Phase 6 & 7: Workflows, Signatures, Financial Integrity & Concurrency", () => {
    it("6.1 [REGRESSION REM-004] uploaded digital signatures serve 200 and waiver signatures delete on PDPL anonymise", async () => {
      const validPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const saveSig = await request(app)
        .post("/api/admin/me/signature")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ signatureDataUrl: validPng });
      expect(saveSig.status).toBe(200);
      expect(saveSig.body.signatureUrl).toContain("/api/files/signatures/");
      expect(saveSig.body.signatureUrl).toContain("sig=");
      trackUploadKeyOrUrl(saveSig.body.signatureUrl);

      const fetchSig = await request(app).get(saveSig.body.signatureUrl);
      expect(fetchSig.status).toBe(200);

      // Customer waiver signature uploaded in step1 is deleted during PDPL anonymise
      const custAnon = await mem.customer.upsert({
        where: { licensePlate_phone: { licensePlate: "4444DDD", phone: "500000004" } },
        update: {},
        create: { name: "Anon Cust", phone: "500000004", licensePlate: "4444DDD", vehicleModel: "Sonata" },
      });
      const tokAnon = signCustomerToken({ customerId: custAnon.id, phone: custAnon.phone, licensePlate: custAnon.licensePlate, scope: "otp" }, "30m");
      const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
      const qUp = await request(app).post("/api/upload").set("Authorization", `Bearer ${tokAnon}`).field("category", "quotations").attach("file", pdf, "q.pdf");
      trackUploadKeyOrUrl(qUp.body.key);

      await mem.complaint.create({
        data: {
          id: "C-77080001",
          customerId: custAnon.id,
          type: ComplaintType.DAMAGE,
          status: TicketStatus.SUBMITTED,
          site: "RUSH Al Kharj",
          posRecordId: "VISIT-UNLISTED",
          posRecordLabel: "Earlier",
          summary: "Anon damage",
          assignedRole: StaffRole.CSM,
        },
      });
      const step1Res = await request(app)
        .post("/api/complaints/C-77080001/damage/step1")
        .set("Authorization", `Bearer ${tokAnon}`)
        .send({ quotationUrl: qUp.body.url, waiverSignature: validPng, quotedAmount: 100 });
      expect(step1Res.status).toBe(200);
      const savedTicket = await mem.complaint.findUnique({ where: { id: "C-77080001" } });
      expect(savedTicket.waiverSignature).toContain("/api/files/signatures/");
      trackUploadKeyOrUrl(savedTicket.waiverSignature);
      const { signFileUrl } = await import("../src/utils/crypto");
      const signedWaiver = signFileUrl(savedTicket.waiverSignature, 120)!;
      expect((await request(app).get(signedWaiver)).status).toBe(200);

      await mem.complaint.update({ where: { id: "C-77080001" }, data: { status: TicketStatus.RESOLVED } });
      const anonRes = await request(app).post(`/api/admin/customers/${custAnon.id}/anonymise`).set("Authorization", `Bearer ${ownerToken}`);
      expect(anonRes.status).toBe(200);
      expect((await request(app).get(signedWaiver)).status).toBe(404);
    });

    it("7.1 [REGRESSION REM-006] enforces Owner cap on ORD-UNLISTED refunds and caps mark-paid at invoiceTotalSar", async () => {
      const createUnl = await request(app)
        .post("/api/complaints")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          type: "BILLING_REFUND",
          posRecordId: "ORD-UNLISTED",
          posRecordLabel: "Unlisted",
          site: "RUSH Al Kharj",
          summary: "Unlisted massive charge",
          requestedAmount: 50000,
          cardLast4: "4192",
          bankSmsText: "Bank SMS",
        });
      expect(createUnl.status).toBe(201);

      // ADMIN cannot approve SAR 50,000 ORD-UNLISTED refund (403); BUSINESS_OWNER can (200)
      expect(
        (await request(app).post(`/api/admin/claims/${createUnl.body.id}/billing/approve`).set("Authorization", `Bearer ${adminToken}`).send({ rrn: "RRN50000", amount: 50000 })).status
      ).toBe(403);
      expect(
        (await request(app).post(`/api/admin/claims/${createUnl.body.id}/billing/approve`).set("Authorization", `Bearer ${ownerToken}`).send({ rrn: "RRN50000", amount: 50000 })).status
      ).toBe(200);

      // mark-paid caps payout at invoiceTotalSar (300) when quotedAmount is 500
      await mem.complaint.create({
        data: {
          id: "C-77060001",
          customerId: userA.id,
          type: ComplaintType.DAMAGE,
          status: TicketStatus.PENDING_PAYOUT,
          resolutionStatus: ResolutionStatus.APPROVED,
          payoutStatus: PayoutStatus.PENDING_BANK_TRANSFER,
          assignedRole: StaffRole.FINANCE,
          site: "RUSH Al Kharj",
          posRecordId: "POS-AUD-A2",
          posRecordLabel: "POS-AUD-A2",
          summary: "Quote vs invoice cap",
          quotationUrl: "/api/files/quotations/1-00000000000000000000000000000000.pdf",
          invoiceUrl: "/api/files/invoices/1-00000000000000000000000000000000.pdf",
          waiverSigned: true,
          quotationApproved: true,
          quotedAmount: 500,
          iban: "SA0380000000608010167519",
          bankName: "Al Rajhi",
          accountHolder: "Awais",
        },
      });
      await request(app)
        .post("/api/admin/finance/C-77060001/invoice-details")
        .set("Authorization", `Bearer ${financeToken}`)
        .send({ invoiceTotalSar: 300 });

      const paid = await request(app)
        .post("/api/admin/finance/C-77060001/mark-paid")
        .set("Authorization", `Bearer ${financeToken}`)
        .send({ transferRef: "TRF-CAPPED" });
      expect(paid.status).toBe(200);
      expect(paid.body.complaint.approvedAmount).toBe(300);
    });

    it("7.2 [REGRESSION REM-007] prevents concurrent duplicate complaints and concurrent double mark-paid under async DB latency", async () => {
      const custD = await mem.customer.upsert({
        where: { licensePlate_phone: { licensePlate: "3333CCC", phone: "500000003" } },
        update: {},
        create: { name: "Concurrent D", phone: "500000003", licensePlate: "3333CCC", vehicleModel: "Accord" },
      });
      mem.washVisits.push({ id: "POS-RACE-1", customerId: custD.id, site: "RUSH Al Kharj", lane: "T1", packageName: "Fresh", washedAt: new Date() });
      const tokD = signCustomerToken({ customerId: custD.id, phone: custD.phone, licensePlate: custD.licensePlate, scope: "otp" }, "30m");

      const origFindFirst = mem.complaint.findFirst;
      const origFindUnique = mem.complaint.findUnique;
      mem.complaint.findFirst = async (args: any) => {
        const res = await origFindFirst(args);
        await new Promise((r) => setTimeout(r, 15));
        return res;
      };
      mem.complaint.findUnique = async (args: any) => {
        const res = await origFindUnique(args);
        await new Promise((r) => setTimeout(r, 15));
        return res;
      };

      try {
        const [r1, r2] = await Promise.all([
          request(app).post("/api/complaints").set("Authorization", `Bearer ${tokD}`).send({ type: "UNSATISFIED", posRecordId: "POS-RACE-1", posRecordLabel: "POS-RACE-1", site: "RUSH Al Kharj", summary: "Concurrent 1" }),
          request(app).post("/api/complaints").set("Authorization", `Bearer ${tokD}`).send({ type: "UNSATISFIED", posRecordId: "POS-RACE-1", posRecordLabel: "POS-RACE-1", site: "RUSH Al Kharj", summary: "Concurrent 2" }),
        ]);
        expect([r1.status, r2.status].sort()).toEqual([201, 409]);

        await mem.complaint.create({
          data: {
            id: "C-RACE-PAY-1",
            customerId: custD.id,
            type: ComplaintType.DAMAGE,
            status: TicketStatus.PENDING_PAYOUT,
            resolutionStatus: ResolutionStatus.APPROVED,
            payoutStatus: PayoutStatus.PENDING_BANK_TRANSFER,
            assignedRole: StaffRole.FINANCE,
            site: "RUSH Al Kharj",
            posRecordId: "POS-RACE-PAY-1",
            posRecordLabel: "POS-RACE-PAY-1",
            summary: "Concurrent mark-paid",
            quotationApproved: true,
            quotedAmount: 150,
            iban: "SA0380000000608010167519",
          },
        });
        const [p1, p2] = await Promise.all([
          request(app).post("/api/admin/finance/C-RACE-PAY-1/mark-paid").set("Authorization", `Bearer ${financeToken}`).send({ transferRef: "TRF-RACE-1" }),
          request(app).post("/api/admin/finance/C-RACE-PAY-1/mark-paid").set("Authorization", `Bearer ${financeToken}`).send({ transferRef: "TRF-RACE-2" }),
        ]);
        expect([p1.status, p2.status].sort()).toEqual([200, 409]);
        const logs = await mem.auditLog.findMany({ where: { complaintId: "C-RACE-PAY-1" } });
        expect(logs.filter((l: any) => l.action === "MARK_PAID").length).toBe(1);
      } finally {
        mem.complaint.findFirst = origFindFirst;
        mem.complaint.findUnique = origFindUnique;
      }
    });

    it("6.2 verifies SLA sweeper, PDPL retention, pagination, and static hardening gates (REM-003, REM-008, REM-012, REM-013, REM-017)", async () => {
      await mem.complaint.create({
        data: {
          id: "C-77070001",
          customerId: userA.id,
          type: ComplaintType.UNSATISFIED,
          status: TicketStatus.SUBMITTED,
          assignedRole: StaffRole.ADMIN,
          site: "RUSH Al Kharj",
          posRecordId: "VISIT-UNLISTED",
          posRecordLabel: "Earlier",
          summary: "Old open ticket",
          createdAt: new Date(Date.now() - 72 * 3600_000),
        },
      });
      const slaRes = await runSlaSweep(mem as any);
      expect(slaRes.flagged).toBeGreaterThanOrEqual(1);
      expect((await mem.complaint.findUnique({ where: { id: "C-77070001" } }))?.slaBreached).toBe(true);

      mem.otpSessions.push({ id: "old-otp", phone: "569809578", licensePlate: "5962HSS", codeHash: "x", attempts: 0, expiresAt: new Date(Date.now() - 48 * 3600_000), verified: false, createdAt: new Date(Date.now() - 48 * 3600_000) });
      expect((await runRetention(mem as any)).otpDeleted).toBeGreaterThanOrEqual(1);

      // REM-013: /claims pagination + X-Total-Count header
      const paged = await request(app).get("/api/admin/claims?limit=2&offset=0").set("Authorization", `Bearer ${ownerToken}`);
      expect(paged.status).toBe(200);
      expect(paged.body.length).toBeLessThanOrEqual(2);
      expect(Number(paged.headers["x-total-count"])).toBeGreaterThan(2);

      // REM-003: E2E scripts guarded & zero hardcoded passwords
      const setupSrc = fs.readFileSync(path.resolve(process.cwd(), "prisma/setup_e2e_clean.ts"), "utf8");
      const mockSrc = fs.readFileSync(path.resolve(process.cwd(), "prisma/seed_mock_e2e.ts"), "utf8");
      expect(setupSrc).toContain("assertSafeToRunDestructive");
      expect(mockSrc).toContain("assertSafeToRunDestructive");
      expect(setupSrc).not.toContain("E2e-Rush!2026-Sec#9");
      expect(mockSrc).not.toContain("E2e-Rush!2026-Sec#9");

      // REM-008: Versioned Prisma migration exists with RLS & partial unique index
      const migPath = path.resolve(process.cwd(), "prisma/migrations/20261125163500_enterprise_hardening/migration.sql");
      expect(fs.existsSync(migPath)).toBe(true);
      const migSql = fs.readFileSync(migPath, "utf8");
      expect(migSql).toContain("Complaint_customerId_listed_posRecordId_key");
      expect(migSql).toContain("ENABLE ROW LEVEL SECURITY");

      // REM-012 & REM-017: Frontend fixes present
      const custHtml = fs.readFileSync(path.resolve(process.cwd(), "public/rush_wash_customer_care.html"), "utf8");
      const adminHtml = fs.readFileSync(path.resolve(process.cwd(), "public/rush_admin_operations_console.html"), "utf8");
      expect(custHtml).toContain("dmg-quote-amt-");
      expect(custHtml).toContain("verifyTrackOtp");
      expect(custHtml).not.toContain("const matches = tickets.filter");
      expect(adminHtml).toContain('<option value="Other">Other</option>');
      expect(adminHtml).toContain("withActionLock");
      expect(adminHtml).toContain('"modal-staff-sign", "modal-print-form"');
    });
  });

  // =========================================================================
  // PHASE 9: PERFORMANCE & LATENCY BENCHMARK (CONTROLLED IN-MEMORY BURST)
  // =========================================================================
  describe("Phase 9: Controlled In-Process Performance Benchmark", () => {
    it("9.1 measures 50 concurrent GET /api/admin/claims and /api/admin/dashboard latency and heap impact", async () => {
      const memBefore = process.memoryUsage().heapUsed;
      const start = performance.now();
      const reqs = Array.from({ length: 50 }, (_, idx) => {
        const t0 = performance.now();
        const p = idx % 2 === 0 ? "/api/admin/claims" : "/api/admin/dashboard";
        return request(app)
          .get(p)
          .set("Authorization", `Bearer ${ownerToken}`)
          .then((res) => ({ status: res.status, ms: performance.now() - t0 }));
      });
      const results = await Promise.all(reqs);
      const totalMs = performance.now() - start;
      const memAfter = process.memoryUsage().heapUsed;

      const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const maxMs = sorted[sorted.length - 1];

      expect(results.every((r) => r.status === 200)).toBe(true);
      console.log(
        `[PERF_BENCHMARK] n=50 totalMs=${totalMs.toFixed(1)} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${maxMs.toFixed(1)}ms heapDeltaKB=${((memAfter - memBefore) / 1024).toFixed(1)}`
      );
    });
  });
});
