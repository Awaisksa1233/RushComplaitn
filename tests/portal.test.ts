import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app, prisma } from "../src/server";
import { hashOtp } from "../src/utils/normalize";

describe.skipIf(
  process.env.ALLOW_LIVE_DB_TESTS !== "true" &&
  !/^(localhost|127\.0\.0\.1)$/i.test((() => { try { return new URL(process.env.DATABASE_URL || "").hostname; } catch { return ""; } })())
)("RUSH Customer Care Portal API Integration Tests", { timeout: 30000 }, () => {
  let customerToken: string;
  let testCustomerId: string;

  beforeAll(async () => {
    // Look up or seed authorized test customer Awais
    const customer = await prisma.customer.upsert({
      where: {
        licensePlate_phone: { licensePlate: "5962HSS", phone: "569809578" }
      },
      update: {},
      create: {
        name: "Awais",
        phone: "569809578",
        licensePlate: "5962HSS",
        vehicleModel: "MG"
      }
    });
    testCustomerId = customer.id;

    // Clean up only portal.test.ts records while preserving E2E C-900* & POS-E2E-* fixtures
    const e2eIds = ["C-9001", "C-9002", "C-9003", "C-9004", "C-9005", "C-9006"];
    await prisma.otpSession.deleteMany({ where: { phone: "569809578" } });
    await prisma.complaint.deleteMany({ where: { customerId: testCustomerId, id: { notIn: e2eIds } } });
    await prisma.washVisit.deleteMany({ where: { id: { in: ["POS-94102", "POS-93881", "POS-91400"] } } });

    // Seed test wash visits for test 2 and test 3 (most recent within 7 days)
    const now = Date.now();
    await prisma.washVisit.upsert({
      where: { id: "POS-94102" },
      update: { customerId: testCustomerId, washedAt: new Date(now - 10 * 60 * 1000) },
      create: {
        id: "POS-94102",
        customerId: testCustomerId,
        site: "RUSH Al Kharj",
        lane: "Express Lane 1",
        packageName: "Fresh Wash",
        washedAt: new Date(now - 10 * 60 * 1000),
      },
    });
    await prisma.washVisit.upsert({
      where: { id: "POS-93881" },
      update: { customerId: testCustomerId, washedAt: new Date(now - 20 * 60 * 1000) },
      create: {
        id: "POS-93881",
        customerId: testCustomerId,
        site: "RUSH Al Kharj",
        lane: "Express Lane 2",
        packageName: "Shiny Wash",
        washedAt: new Date(now - 20 * 60 * 1000),
      },
    });
    await prisma.washVisit.upsert({
      where: { id: "POS-91400" },
      update: { customerId: testCustomerId, washedAt: new Date(now - 12 * 24 * 3600 * 1000) },
      create: {
        id: "POS-91400",
        customerId: testCustomerId,
        site: "RUSH Al Kharj",
        lane: "Express Lane 1",
        packageName: "Nano Ceramic Wash",
        washedAt: new Date(now - 12 * 24 * 3600 * 1000),
      },
    });

    // Seed complaint C-1041 for test 3 duplicate guard
    await prisma.complaint.upsert({
      where: { id: "C-1041" },
      update: { customerId: testCustomerId, posRecordId: "POS-93881" },
      create: {
        id: "C-1041",
        customerId: testCustomerId,
        type: "UNSATISFIED",
        site: "RUSH Al Kharj",
        posRecordId: "POS-93881",
        posRecordLabel: "Fresh Wash · Express Lane 1",
        summary: "Previous complaint",
        status: "INVESTIGATING",
        assignedRole: "ADMIN",
      },
    });

    // Seed complaint C-1042 for test 5 Damage Step 2
    await prisma.complaint.upsert({
      where: { id: "C-1042" },
      update: {
        customerId: testCustomerId,
        type: "DAMAGE",
        posRecordId: "POS-91400",
        quotationApproved: true,
        quotationUrl: "/api/files/quotations/1-00000000000000000000000000000000.pdf",
        quotedAmount: 500,
        status: "INVESTIGATING",
        assignedRole: "OPS_MANAGER",
        iban: null,
        bankName: null,
        accountHolder: null,
        invoiceUrl: null,
        payoutStatus: "AWAITING_INVOICE_IBAN",
      },
      create: {
        id: "C-1042",
        customerId: testCustomerId,
        type: "DAMAGE",
        site: "RUSH Al Kharj",
        posRecordId: "POS-91400",
        posRecordLabel: "Nano Ceramic Wash",
        summary: "Bumper scratch approved",
        quotationApproved: true,
        quotationUrl: "/api/files/quotations/1-00000000000000000000000000000000.pdf",
        quotedAmount: 500,
        status: "INVESTIGATING",
        assignedRole: "OPS_MANAGER",
      },
    });
  }, 30000);

  afterAll(async () => {
    const e2eIds = ["C-9001", "C-9002", "C-9003", "C-9004", "C-9005", "C-9006"];
    await prisma.otpSession.deleteMany({ where: { phone: "569809578" } }).catch(() => {});
    await prisma.complaint.deleteMany({ where: { customerId: testCustomerId, id: { notIn: e2eIds } } }).catch(() => {});
    await prisma.washVisit.deleteMany({ where: { id: { in: ["POS-94102", "POS-93881", "POS-91400"] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  // Test 1: Request OTP and Handle OTP Mismatch
  it("1. should reject invalid OTP code with 401", async () => {
    // Request OTP
    const otpRes = await request(app)
      .post("/api/auth/request-otp")
      .send({ licensePlate: "5962HSS", phone: "0569809578" });

    expect(otpRes.status).toBe(200);
    expect(otpRes.body.sent).toBe(true);
    expect(otpRes.body.devOtp).toBeUndefined(); // never leaked outside explicit dev mode
    // Tests can't read the SMS; replace the stored hash with a known code
    const validDevOtp = "123456";
    await prisma.otpSession.updateMany({
      where: { phone: "569809578", verified: false },
      data: { codeHash: hashOtp(validDevOtp) },
    });

    // Verify with WRONG OTP
    const failRes = await request(app)
      .post("/api/auth/verify-otp")
      .send({ licensePlate: "5962HSS", phone: "0569809578", code: "000000" });

    expect(failRes.status).toBe(401);
    expect(failRes.body.error).toContain("Invalid OTP");

    // Verify with CORRECT OTP
    const passRes = await request(app)
      .post("/api/auth/verify-otp")
      .send({ licensePlate: "5962HSS", phone: "0569809578", code: validDevOtp });

    expect(passRes.status).toBe(200);
    expect(passRes.body.token).toBeDefined();
    customerToken = passRes.body.token;
  });

  // Test 2: 7-Day Wash Window
  it("2. should only return washes within the past 7 days (exclude older washes)", async () => {
    const res = await request(app)
      .get("/api/customer/history?type=UNSATISFIED")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("washes");
    const records = res.body.records;

    // In seed: POS-94102 (2 days ago), POS-93881 (4 days ago), POS-91400 (12 days ago)
    const returnedIds = records.map((r: any) => r.id);
    expect(returnedIds).toContain("POS-94102");
    expect(returnedIds).toContain("POS-93881");
    // POS-91400 is 12 days old, so it MUST be excluded
    expect(returnedIds).not.toContain("POS-91400");
    expect(records.length).toBeLessThanOrEqual(3);
  });

  // Test 3: Duplicate Guard for Listed Visit
  it("3. should reject duplicate complaint on an already reported visit", async () => {
    // In seed, C-1041 already exists for POS-93881
    const res = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        type: "UNSATISFIED",
        posRecordId: "POS-93881",
        posRecordLabel: "Fresh Wash · Express Lane 1",
        site: "Al Kharj Main",
        summary: "Attempting to file duplicate complaint on same wash",
        qualityTags: ["Windshield Spots"],
      });

    expect(res.status).toBe(409);
    expect(res.body.ticketId).toBe("C-1041");
  });

  // Test 4: Unlisted Order Requirements (Card Last 4 + Bank SMS proof)
  it("4. should enforce Card Last 4 and Bank SMS proof for ORD-UNLISTED", async () => {
    // Missing both
    const fail1 = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        type: "BILLING_REFUND",
        posRecordId: "ORD-UNLISTED",
        posRecordLabel: "Unlisted Order",
        site: "Al Kharj Main",
        summary: "Unknown charge on credit card",
      });

    expect(fail1.status).toBe(400);
    expect(fail1.body.error).toContain("Card last 4 digits and Bank SMS proof");

    // Success with both card last 4 and bank SMS
    const successRes = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        type: "BILLING_REFUND",
        posRecordId: "ORD-UNLISTED",
        posRecordLabel: "Unlisted Card Charge",
        site: "Al Kharj Main",
        summary: "Charged twice for single wash",
        billingReason: "Duplicate Charge",
        requestedAmount: 75.0,
        cardLast4: "4192",
        bankSmsText: "Purchase of SAR 75.00 with AlRajhi card *4192 at RUSH Car Wash",
      });

    expect(successRes.status).toBe(201);
    expect(successRes.body.id).toMatch(/^C-\d+$/);
    expect(successRes.body.cardLast4).toBe("4192");
  });

  // Test 5: Damage Step 2 Server-Side Lock (Must be rejected with 403 unless quotationApproved === true)
  it("5. should reject Damage Step 2 with 403 if quotation is not approved", async () => {
    // Create a new Damage ticket with quotationApproved = false (including required mediaUrls)
    const newDmg = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        type: "DAMAGE",
        posRecordId: "POS-94102",
        posRecordLabel: "Fresh Wash",
        site: "RUSH Al Kharj",
        summary: "Side scratch on bumper",
        vehicleZones: ["Front Bumper"],
        mediaUrls: ["/api/files/media/1-00000000000000000000000000000000.jpg"],
      });

    expect(newDmg.status).toBe(201);
    const newTicketId = newDmg.body.id;

    // Unauthenticated Step 2 must be rejected outright
    const noAuth = await request(app).post(`/api/complaints/${newTicketId}/damage/step2`).send({});
    expect(noAuth.status).toBe(401);

    // Attempt Step 2 before quotation approval
    const step2Fail = await request(app)
      .post(`/api/complaints/${newTicketId}/damage/step2`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        invoiceUrl: "/api/files/invoices/1-00000000000000000000000000000000.pdf",
        bankName: "Alinma Bank",
        accountHolder: "Mohammed Al-Qahtani",
        iban: "SA0380000000608010167519",
      });

    expect(step2Fail.status).toBe(403);
    expect(step2Fail.body.error).toContain("Management must review and approve your repair quotation");

    // Seeded ticket C-1042 HAS quotationApproved: true
    const step2Pass = await request(app)
      .post("/api/complaints/C-1042/damage/step2")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        invoiceUrl: "/api/files/invoices/2-00000000000000000000000000000000.pdf",
        bankName: "Alinma Bank",
        accountHolder: "Awais",
        iban: "SA0380000000608010167519",
      });

    expect(step2Pass.status).toBe(200);
    expect(step2Pass.body.iban).not.toContain("0000000608"); // masked in responses
    expect(step2Pass.body.status).toBe("PENDING_PAYOUT");
  });

  // Test 6: Complaint Tracking & Saudi Tax Details
  it("6. should return complaint tracking with Rush tax details", async () => {
    const trackRes = await request(app)
      .post("/api/complaints/track")
      .send({ query: "5962HSS", phone: "0569809578" });

    expect(trackRes.status).toBe(200);
    expect(trackRes.body.rushTaxDetails).toBeDefined();
    expect(trackRes.body.rushTaxDetails.vatNumber).toBeDefined();
    expect(trackRes.body.tickets.length).toBeGreaterThan(0);
    // Plate lookups return a limited view: no messages, no bank data
    expect(trackRes.body.limited).toBe(true);
    expect(trackRes.body.tickets[0].iban).toBeUndefined();
    expect(trackRes.body.tickets[0].messages).toBeUndefined();
  });

  // Test 7: VISIT-GENERAL (Other) & VISIT-UNLISTED submissions
  it("7. should allow OTHER with VISIT-GENERAL and UNSATISFIED with VISIT-UNLISTED", async () => {
    const genRes = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        type: "OTHER",
        posRecordId: "VISIT-GENERAL",
        posRecordLabel: "VISIT-GENERAL (General Inquiry)",
        site: "RUSH Al Kharj",
        summary: "[Topic: General Feedback] Great service at Al Kharj tunnel lane.",
      });
    expect(genRes.status).toBe(201);
    expect(genRes.body.posRecordId).toBe("VISIT-GENERAL");

    const unlRes = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        type: "UNSATISFIED",
        posRecordId: "VISIT-UNLISTED",
        posRecordLabel: "VISIT-UNLISTED (Earlier Wash)",
        site: "RUSH Al Kharj",
        summary: "[Tags: Water Spots] Previous week visit water spots.",
        qualityTags: ["Water Spots"],
      });
    expect(unlRes.status).toBe(201);
    expect(unlRes.body.posRecordId).toBe("VISIT-UNLISTED");
  });

  // Test 8: Inbound Chatwoot WhatsApp webhook (with ticket_code and phone fallback)
  it("8. should ingest inbound Chatwoot customer messages via ticket_code and phone fallback", async () => {
    const secret = process.env.CHATWOOT_WEBHOOK_SECRET;
    if (!secret) return;

    const r1 = await request(app)
      .post(`/api/complaints/webhooks/chatwoot?token=${secret}`)
      .send({
        event: "message_created",
        id: 990001,
        message_type: "incoming",
        private: false,
        content: "Inbound customer photo follow-up",
        sender: { name: "Awais", phone_number: "+966569809578" },
        conversation: { custom_attributes: { ticket_code: "C-1041" } },
      });
    expect(r1.status).toBe(200);
    expect(r1.body.ok).toBe(true);

    const r2 = await request(app)
      .post(`/api/complaints/webhooks/chatwoot?token=${secret}`)
      .send({
        event: "message_created",
        id: 990002,
        message_type: "incoming",
        private: false,
        content: "Inbound message without ticket_code attribute",
        sender: { name: "Awais", phone_number: "+966569809578" },
        conversation: { custom_attributes: {} },
      });
    expect(r2.status).toBe(200);
    expect(r2.body.ok).toBe(true);

    const msgs = await prisma.message.findMany({
      where: { externalId: { in: ["cw_990001", "cw_990002"] } },
    });
    expect(msgs.length).toBe(2);
    expect(msgs.find((m) => m.externalId === "cw_990001")?.complaintId).toBe("C-1041");
  });

  // Test 9: Direct 1-click ticket link (/api/complaints/direct)
  it("9. should load owned ticket via signed direct link and reject missing/tampered tokens", async () => {
    const noAuth = await request(app).get("/api/complaints/direct");
    expect(noAuth.status).toBe(401);

    const badAuth = await request(app)
      .get("/api/complaints/direct")
      .set("Authorization", "Bearer invalid.jwt.token");
    expect(badAuth.status).toBe(401);

    const trackRes = await request(app)
      .post("/api/complaints/track")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ query: "C-1041", phone: "0569809578" });
    expect(trackRes.status).toBe(200);
    expect(trackRes.body.trackToken).toBeDefined();

    const directRes = await request(app)
      .get("/api/complaints/direct")
      .set("Authorization", `Bearer ${trackRes.body.trackToken}`);
    expect(directRes.status).toBe(200);
    expect(directRes.body.tickets[0].id).toBe("C-1041");
    expect(directRes.body.rushTaxDetails).toBeDefined();
  });
});
