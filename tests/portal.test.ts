import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app, prisma } from "../src/server";

describe("RUSH Customer Care Portal API Integration Tests", { timeout: 30000 }, () => {
  let customerToken: string;
  let testCustomerId: string;

  beforeAll(async () => {
    // Look up seeded customer Mohammed Al-Qahtani
    const customer = await prisma.customer.findFirstOrThrow({
      where: { phone: "553914420" },
    });
    testCustomerId = customer.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Test 1: Request OTP and Handle OTP Mismatch
  it("1. should reject invalid OTP code with 401", async () => {
    // Request OTP
    const otpRes = await request(app)
      .post("/api/auth/request-otp")
      .send({ licensePlate: "8821KSA", phone: "0553914420" });

    expect(otpRes.status).toBe(200);
    expect(otpRes.body.sent).toBe(true);
    const validDevOtp = otpRes.body.devOtp;

    // Verify with WRONG OTP
    const failRes = await request(app)
      .post("/api/auth/verify-otp")
      .send({ licensePlate: "8821KSA", phone: "0553914420", code: "0000" });

    expect(failRes.status).toBe(401);
    expect(failRes.body.error).toContain("Invalid OTP");

    // Verify with CORRECT OTP
    const passRes = await request(app)
      .post("/api/auth/verify-otp")
      .send({ licensePlate: "8821KSA", phone: "0553914420", code: validDevOtp });

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
    // Create a new Damage ticket with quotationApproved = false
    const newDmg = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        type: "DAMAGE",
        posRecordId: `POS-TEST-${Date.now()}`,
        posRecordLabel: "Fresh Wash",
        site: "Al Kharj Main",
        summary: "Side scratch on bumper",
        vehicleZones: ["Front Bumper"],
      });

    expect(newDmg.status).toBe(201);
    const newTicketId = newDmg.body.id;

    // Attempt Step 2 before quotation approval
    const step2Fail = await request(app)
      .post(`/api/complaints/${newTicketId}/damage/step2`)
      .send({
        invoiceUrl: "https://rush.com.sa/sample_invoice.pdf",
        bankName: "Alinma Bank",
        accountHolder: "Mohammed Al-Qahtani",
        iban: "SA0380000000608010167519",
      });

    expect(step2Fail.status).toBe(403);
    expect(step2Fail.body.error).toContain("Management must review and approve your repair quotation");

    // Seeded ticket C-1042 HAS quotationApproved: true
    const step2Pass = await request(app)
      .post("/api/complaints/C-1042/damage/step2")
      .send({
        invoiceUrl: "https://rush.com.sa/official_tax_invoice.pdf",
        bankName: "Alinma Bank",
        accountHolder: "Mohammed Al-Qahtani",
        iban: "SA0380000000608010167519",
      });

    expect(step2Pass.status).toBe(200);
    expect(step2Pass.body.iban).toBe("SA0380000000608010167519");
    expect(step2Pass.body.status).toBe("PENDING_PAYOUT");
  });

  // Test 6: Complaint Tracking & Saudi Tax Details
  it("6. should return complaint tracking with Rush tax details", async () => {
    const trackRes = await request(app)
      .post("/api/complaints/track")
      .send({ query: "8821KSA", phone: "0553914420" });

    expect(trackRes.status).toBe(200);
    expect(trackRes.body.rushTaxDetails).toBeDefined();
    expect(trackRes.body.rushTaxDetails.vatNumber).toBe("310482917400003");
    expect(trackRes.body.tickets.length).toBeGreaterThan(0);
  });
});
