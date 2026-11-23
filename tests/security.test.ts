import { describe, it, expect } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { app } from "../src/server";
import { isValidSaIban } from "../src/routes/complaints";
import { isSafeFileUrl, normalizePhone, isSaudiMobile } from "../src/utils/normalize";
import { encryptField, decryptField, maskIban } from "../src/utils/crypto";

// These tests need no database: they exercise gates that must reject BEFORE any DB access.
describe("Security regression tests (no DB)", () => {
  it("does not serve project files (.env, source, package.json, guides)", async () => {
    for (const p of ["/.env", "/package.json", "/src/server.ts", "/prisma/schema.prisma", "/docs/rush_backend_antigravity_guide.md", "/../.env"]) {
      const r = await request(app).get(p);
      expect(r.status).toBe(404);
    }
  });

  it("serves the two UIs with a CSP and no demo helpers", async () => {
    const r = await request(app).get("/");
    expect(r.status).toBe(200);
    expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.text).not.toContain("Quick Demo Lookup");
    expect(r.text).not.toContain("fillDemoLookup");
    const a = await request(app).get("/admin");
    expect(a.text).not.toContain('value="admin@rush.com.sa"');
  });

  it("requires auth on every customer-side mutation", async () => {
    const posts = [
      "/api/complaints/C-1043/damage/step1",
      "/api/complaints/C-1043/damage/step2",
      "/api/complaints/C-1043/damage/upload-doc",
      "/api/complaints/C-1043/whatsapp",
      "/api/complaints/C-1043/csat",
      "/api/complaints",
    ];
    for (const p of posts) {
      const r = await request(app).post(p).send({});
      expect(r.status, p).toBe(401);
    }
  });

  it("rejects forged tokens (wrong secret / staff token on customer routes)", async () => {
    const forged = (await import("jsonwebtoken")).default.sign({ customerId: "x", phone: "5", licensePlate: "A" }, "rush_care_portal_default_secret");
    const r = await request(app).post("/api/complaints/C-1043/csat").set("Authorization", `Bearer ${forged}`).send({ rating: 5 });
    expect(r.status).toBe(401);
    const staffForged = (await import("jsonwebtoken")).default.sign({ staffId: "x", role: "BUSINESS_OWNER" }, "rush_care_portal_jwt_sec_38210384729103847291");
    const a = await request(app).get("/api/admin/config").set("Authorization", `Bearer ${staffForged}`);
    expect(a.status).toBe(401);
  });

  it("blocks anonymous and bad-type uploads", async () => {
    const anon = await request(app).post("/api/upload").attach("file", Buffer.from("<html>"), "x.html");
    expect(anon.status).toBe(401);
  });

  it("webhook is closed unless correctly signed", async () => {
    const r = await request(app).post("/api/complaints/webhooks/whatsapp").send({ ticketId: "C-1043", body: "forged" });
    expect([401, 503]).toContain(r.status);
  });

  it("file proxy only serves server-generated keys", async () => {
    for (const k of ["../.env", "complaints/..%2f..%2f.env", "media/evil.html", "media/1-abc.jpg"]) {
      const r = await request(app).get(`/api/files/${k}`);
      expect(r.status, k).toBe(404);
    }
  });

  it("admin endpoints reject anonymous callers", async () => {
    for (const p of ["/api/admin/claims", "/api/admin/finance", "/api/admin/finance/export.csv", "/api/admin/staff"]) {
      expect((await request(app).get(p)).status, p).toBe(401);
    }
  });

  it("validates OTP payload shape before touching the DB", async () => {
    const r = await request(app).post("/api/auth/verify-otp").send({ licensePlate: "8821KSA", phone: "0553914420", code: "1234" });
    expect(r.status).toBe(400);
  });
});

describe("Helpers", () => {
  it("validates Saudi IBAN checksum", () => {
    expect(isValidSaIban("SA0380000000608010167519")).toBe(true);
    expect(isValidSaIban("SA0380000000608010167518")).toBe(false);
    expect(isValidSaIban("SA12")).toBe(false);
  });
  it("only accepts our own file references", () => {
    expect(isSafeFileUrl("/api/files/invoices/1-" + "a".repeat(32) + ".pdf")).toBe(true);
    expect(isSafeFileUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeFileUrl("https://evil.example/x.pdf")).toBe(false);
    expect(isSafeFileUrl("/uploads/../../etc/passwd")).toBe(false);
  });
  it("normalises Saudi mobiles", () => {
    expect(isSaudiMobile(normalizePhone("+966 55 391 4420"))).toBe(true);
    expect(isSaudiMobile("123456789")).toBe(false);
  });
  it("encrypts/decrypts bank fields and masks IBANs", () => {
    process.env.FIELD_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
    const enc = encryptField("SA0380000000608010167519")!;
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptField(enc)).toBe("SA0380000000608010167519");
    expect(maskIban(enc)).toBe("SA03••••••••••••••••7519");
    delete process.env.FIELD_ENCRYPTION_KEY;
  });
});
