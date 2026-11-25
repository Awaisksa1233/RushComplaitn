import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app, prisma } from "../src/server";
import { StaffRole } from "@prisma/client";

// Ephemeral fixture credential for throw-away test users (deleted in afterAll). The real owner login comes from env.
const TEST_PW = "Tst-Only!Fixture-9xQ2";

describe.skipIf(!process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD)("RUSH Admin & Operations Console API Tests", { timeout: 60000 }, () => {
  let ownerToken: string;
  let adminToken: string;
  let opsToken: string;
  let csmToken: string;
  let testComplaintId: string | null = null;
  let testCustomerId: string | null = null;
  const createdStaffIds: string[] = [];

  beforeAll(async () => {
    await prisma.staffUser.deleteMany({
      where: { email: { startsWith: "test." } },
    });
    await prisma.complaint.deleteMany({
      where: { id: { startsWith: "C-TEST-" } },
    });
  }, 30000);

  afterAll(async () => {
    // Clean up any test records created during test execution
    if (testComplaintId) {
      await prisma.auditLog.deleteMany({ where: { complaintId: testComplaintId } }).catch(() => {});
      await prisma.message.deleteMany({ where: { complaintId: testComplaintId } }).catch(() => {});
      await prisma.complaint.delete({ where: { id: testComplaintId } }).catch(() => {});
    }
    if (testCustomerId) {
      await prisma.customer.delete({ where: { id: testCustomerId } }).catch(() => {});
    }
    if (createdStaffIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { staffId: { in: createdStaffIds } } }).catch(() => {});
      await prisma.staffUser.deleteMany({ where: { id: { in: createdStaffIds } } }).catch(() => {});
    }
    await prisma.staffUser.deleteMany({
      where: { email: { startsWith: "test." } },
    });
    await prisma.$disconnect();
  }, 30000);

  // Test 1: Staff Authentication & Roles
  it("1. should authenticate admin with email/password and reject bad passwords", async () => {
    const ts = Date.now();
    const adminEmail = `test.sara.${ts}@rush.com.sa`;
    const opsEmail = `test.faisal.${ts}@rush.com.sa`;
    const csmEmail = `test.omar.${ts}@rush.com.sa`;

    // 1a. Reject invalid password
    const resBad = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: "admin@rush.com.sa", password: "WrongPassword!" });
    expect(resBad.status).toBe(401);
    expect(resBad.body.error).toContain("Invalid email or password");

    // 1b. Reject unknown email
    const resUnknown = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: "unknown@rush.com.sa", password: TEST_PW });
    expect(resUnknown.status).toBe(401);

    // 1c. Successfully authenticate primary admin
    const resOwner = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: process.env.TEST_OWNER_EMAIL!, password: process.env.TEST_OWNER_PASSWORD! });
    expect(resOwner.status).toBe(200);
    expect(resOwner.body.token).toBeDefined();
    expect(resOwner.body.user.email).toBe(process.env.TEST_OWNER_EMAIL!.toLowerCase());
    expect(resOwner.body.user.role).toBe(StaffRole.BUSINESS_OWNER);
    ownerToken = resOwner.body.token;

    // 1d. Create test staff for other roles
    const resCreateAdmin = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Test Sara Admin",
        email: adminEmail,
        role: StaffRole.ADMIN,
        branch: "RUSH Al Kharj",
        password: TEST_PW,
      });
    expect(resCreateAdmin.status).toBe(200);
    createdStaffIds.push(resCreateAdmin.body.id);

    const resCreateOps = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Test Faisal Ops",
        email: opsEmail,
        role: StaffRole.OPS_MANAGER,
        branch: "RUSH Al Kharj",
        password: TEST_PW,
      });
    expect(resCreateOps.status).toBe(200);
    createdStaffIds.push(resCreateOps.body.id);

    const resCreateCsm = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Test Omar CSM",
        email: csmEmail,
        role: StaffRole.CSM,
        branch: "RUSH Al Kharj",
        password: TEST_PW,
      });
    expect(resCreateCsm.status).toBe(200);
    createdStaffIds.push(resCreateCsm.body.id);

    // 1e. Login as each created staff member
    const resAdminLogin = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: adminEmail, password: TEST_PW });
    expect(resAdminLogin.status).toBe(200);
    adminToken = resAdminLogin.body.token;

    const resOpsLogin = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: opsEmail, password: TEST_PW });
    expect(resOpsLogin.status).toBe(200);
    opsToken = resOpsLogin.body.token;

    const resCsmLogin = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: csmEmail, password: TEST_PW });
    expect(resCsmLogin.status).toBe(200);
    csmToken = resCsmLogin.body.token;
  }, 45000);

  // Test 2: Require Staff Middleware
  it("2. should reject unauthenticated requests with 401", async () => {
    const res = await request(app).get("/api/admin/config");
    expect(res.status).toBe(401);
  });

  // Test 3: System Config & Owner-Only Policy Update
  it("3. should enforce that only Business Owner can update policy config", async () => {
    // Non-owner (CSM) update attempt -> 403
    const failRes = await request(app)
      .patch("/api/admin/config")
      .set("Authorization", `Bearer ${csmToken}`)
      .send({ damageApprovalCapSar: 300 });
    expect(failRes.status).toBe(403);

    // Business Owner update -> 200
    const passRes = await request(app)
      .patch("/api/admin/config")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ damageApprovalCapSar: 250, maxSlaHours: 48 });
    expect(passRes.status).toBe(200);
    expect(Number(passRes.body.damageApprovalCapSar)).toBe(250);

    // Reset back to 200
    await request(app)
      .patch("/api/admin/config")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ damageApprovalCapSar: 200, maxSlaHours: 48 });
  });

  // Test 4: Executive Dashboard KPIs
  it("4. should return dashboard KPIs and escalations", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.config).toBeDefined();
    expect(res.body.kpis).toBeDefined();
    expect(typeof res.body.kpis.openCount).toBe("number");
    expect(typeof res.body.kpis.slaCompliancePct).toBe("number");
    expect(res.body.escalations).toBeDefined();
    expect(res.body.charts).toBeDefined();
    expect(res.body.charts.byResolution).toBeDefined();
    expect(res.body.charts.byBranch.length).toBe(1);
    expect(res.body.charts.byBranch[0].branch).toBe("RUSH Al Kharj");
  });

  // Test 5: Claims Queue Filtering & Branch Scoping
  it("5. should list claims with branch scoping for Ops Manager", async () => {
    const resOps = await request(app)
      .get("/api/admin/claims")
      .set("Authorization", `Bearer ${opsToken}`);

    expect(resOps.status).toBe(200);
    expect(Array.isArray(resOps.body)).toBe(true);
    for (const c of resOps.body) {
      expect(c.branch).toBe("RUSH Al Kharj");
    }
  });

  // Test 6: Approve Rewash Pass
  it("6. should approve unsatisfied complaint and issue RW-xxxx rewash pass", async () => {
    let cust = await prisma.customer.findFirst();
    if (!cust) {
      cust = await prisma.customer.create({
        data: {
          licensePlate: "TEST 9999",
          phone: "0559999999",
          name: "Test Customer",
          vehicleModel: "2024 Toyota Camry",
        },
      });
      testCustomerId = cust.id;
    }

    const complaint = await prisma.complaint.create({
      data: {
        id: `C-TEST-${Math.floor(2000 + Math.random() * 8000)}`,
        customerId: cust.id,
        type: "UNSATISFIED",
        site: "RUSH Al Kharj",
        posRecordId: "POS-TEST",
        posRecordLabel: "Nano Ceramic Wash",
        summary: "Test unsatisfied wash spots",
        assignedRole: StaffRole.ADMIN,
      },
    });
    testComplaintId = complaint.id;

    const res = await request(app)
      .post(`/api/admin/claims/${complaint.id}/unsatisfied/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rewashCode).toMatch(/^RW-[A-Z0-9]{8}$/);
    expect(res.body.complaint.status).toBe("RESOLVED");
  });

  // Test 7: Finance Disbursement & CSV Export
  it("7. should list finance payout queue and export live RFC-4180 CSV", async () => {
    const resFin = await request(app)
      .get("/api/admin/finance")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(resFin.status).toBe(200);
    expect(Array.isArray(resFin.body)).toBe(true);

    const resCsv = await request(app)
      .get("/api/admin/finance/export.csv")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(resCsv.status).toBe(200);
    expect(resCsv.headers["content-type"]).toContain("text/csv");
    expect(resCsv.text).toContain('"Ticket ID","Branch","Type"');
  });

  // Test 8: Static HTML Serving on /admin
  it("8. should serve rush_admin_operations_console.html on /admin", async () => {
    const res = await request(app).get("/admin");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("RUSH رش واش | Admin &amp; Operations Console");
  });

  // Test 9: Password Reset Invalidates Prior Staff JWT
  it("9. should invalidate existing staff JWT immediately after password reset", async () => {
    const targetId = createdStaffIds[2]; // test.omar CSM
    expect(targetId).toBeDefined();

    const preRes = await request(app)
      .get("/api/admin/claims")
      .set("Authorization", `Bearer ${csmToken}`);
    expect(preRes.status).toBe(200);

    const resetRes = await request(app)
      .post(`/api/admin/staff/${targetId}/reset-password`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ newPassword: "New-Reset!Pass2026#" });
    expect(resetRes.status).toBe(200);

    const postRes = await request(app)
      .get("/api/admin/claims")
      .set("Authorization", `Bearer ${csmToken}`);
    expect(postRes.status).toBe(401);
  });

  // Test 10: FINANCE (Accountant) Role Permissions
  it("10. should allow FINANCE role to access finance endpoints and quote approval, but deny staff management", async () => {
    const finEmail = `test.finance.${Date.now()}@rush.com.sa`;
    const finPass = "Finance!Pass2026#";
    const createRes = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Test Accountant", email: finEmail, password: finPass, role: "FINANCE", branch: "All Branches" });
    expect(createRes.status).toBe(201);
    createdStaffIds.push(createRes.body.id);

    const loginRes = await request(app)
      .post("/api/admin/login")
      .send({ email: finEmail, password: finPass });
    expect(loginRes.status).toBe(200);
    const financeToken = loginRes.body.token;

    const finListRes = await request(app)
      .get("/api/admin/finance")
      .set("Authorization", `Bearer ${financeToken}`);
    expect(finListRes.status).toBe(200);
    expect(Array.isArray(finListRes.body)).toBe(true);

    const finCsvRes = await request(app)
      .get("/api/admin/finance/export.csv")
      .set("Authorization", `Bearer ${financeToken}`);
    expect(finCsvRes.status).toBe(200);

    // Non-existent ticket returns 404 (not 403), proving FINANCE role passes requireRoles on approve-quote & mark-paid
    const quoteRes = await request(app)
      .post("/api/admin/claims/C-DOES-NOT-EXIST/damage/approve-quote")
      .set("Authorization", `Bearer ${financeToken}`)
      .send({});
    expect(quoteRes.status).toBe(404);

    const paidRes = await request(app)
      .post("/api/admin/finance/C-DOES-NOT-EXIST/mark-paid")
      .set("Authorization", `Bearer ${financeToken}`)
      .send({ transferRef: "TRF-123456" });
    expect(paidRes.status).toBe(404);

    // FINANCE cannot manage staff
    const staffRes = await request(app)
      .get("/api/admin/staff")
      .set("Authorization", `Bearer ${financeToken}`);
    expect(staffRes.status).toBe(403);
  });

  // Test 11: Staff Reusable Signature (R2) & Damage Slot Signing
  it("11. should save reusable staff signature and enforce role gates on damage/sign", async () => {
    const validPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const saveRes = await request(app)
      .post("/api/admin/me/signature")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ signatureDataUrl: validPng });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.signatureUrl).toContain("/api/files/signatures/");

    const getRes = await request(app)
      .get("/api/admin/me/signature")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.signatureUrl).toContain("/api/files/signatures/");

    // CSM cannot sign finance or tech slots
    const csmSignRes = await request(app)
      .post("/api/admin/claims/C-DOES-NOT-EXIST/damage/sign")
      .set("Authorization", `Bearer ${csmToken}`)
      .send({ slot: "finance", useSaved: true });
    expect([401, 403]).toContain(csmSignRes.status);

    // Owner passes role check and gets 404 on non-existent ticket
    const ownerSignRes = await request(app)
      .post("/api/admin/claims/C-DOES-NOT-EXIST/damage/sign")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ slot: "finance", useSaved: true });
    expect(ownerSignRes.status).toBe(404);
  });
});
