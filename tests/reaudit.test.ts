// Re-audit probes (AUDIT/REAUDIT-2026-11-25). Each test documents the CURRENT behaviour of a finding.
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
const WA_SECRET = vi.hoisted(() => {
  process.env.WHATSAPP_WEBHOOK_SECRET = "wa-test-secret-0123456789abcdef0123456789";
  process.env.CHATWOOT_WEBHOOK_SECRET = "cw-test-secret-0123456789abcdef0123456789";
  return process.env.WHATSAPP_WEBHOOK_SECRET!;
});
import request from "supertest";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { StaffRole, ComplaintType } from "@prisma/client";
import { InMemoryPrismaClient, createIsolatedApp } from "./helpers/inMemoryPrisma";
import { STAFF_JWT_SECRET } from "../src/config/env";
import { signCustomerToken } from "../src/middleware/auth";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const created: string[] = [];

describe("re-audit probes", () => {
  let mem: InMemoryPrismaClient; let app: any;
  let a: any, b: any, aTok: string, bTok: string, adminTok: string;
  beforeAll(async () => {
    mem = new InMemoryPrismaClient(); app = createIsolatedApp(mem);
    const hash = bcrypt.hashSync("Reaudit!Probe#2026", 4);
    const admin = await mem.staffUser.create({ data: { name: "RA Admin", email: "ra.admin@rush.com.sa", role: StaffRole.ADMIN, branch: "All Branches", active: true, passwordHash: hash } });
    const fp = crypto.createHmac("sha256", STAFF_JWT_SECRET).update(hash).digest("hex").slice(0, 16);
    adminTok = jwt.sign({ staffId: admin.id, name: admin.name, role: admin.role, branch: admin.branch, email: admin.email, pwdFp: fp }, STAFF_JWT_SECRET, { expiresIn: "1h", audience: "rush-staff", issuer: "rush-care" });
    a = await mem.customer.upsert({ where: { licensePlate_phone: { licensePlate: "1111RAA", phone: "500000011" } }, update: {}, create: { name: "RA User A", phone: "500000011", licensePlate: "1111RAA", vehicleModel: "X" } });
    b = await mem.customer.upsert({ where: { licensePlate_phone: { licensePlate: "2222RAB", phone: "500000012" } }, update: {}, create: { name: "RA User B", phone: "500000012", licensePlate: "2222RAB", vehicleModel: "Y" } });
    aTok = signCustomerToken({ customerId: a.id, phone: a.phone, licensePlate: a.licensePlate, scope: "otp" }, "30m");
    bTok = signCustomerToken({ customerId: b.id, phone: b.phone, licensePlate: b.licensePlate, scope: "otp" }, "30m");
  });
  afterAll(() => { for (const k of created) { try { fs.unlinkSync(path.resolve(process.cwd(), "uploads", k)); } catch {} } });

  it.fails("PROBE-1 [KNOWN DEFECT AUD-R1] HMAC-signed WhatsApp webhook is reachable (expects 201 for a valid signature)", async () => {
    await mem.complaint.create({ data: { id: "C-55000001", customerId: a.id, type: ComplaintType.OTHER, site: "RUSH Al Kharj", posRecordId: "VISIT-GENERAL", posRecordLabel: "g", summary: "probe", assignedRole: StaffRole.ADMIN } });
    const body = JSON.stringify({ ticketId: "C-55000001", body: "hello from agent", externalId: "wa-1" });
    const sig = "sha256=" + crypto.createHmac("sha256", WA_SECRET).update(body).digest("hex");
    const r = await request(app).post("/api/complaints/webhooks/whatsapp").set("Content-Type", "application/json").set("x-hub-signature-256", sig).send(body);
    console.log("PROBE-1 status:", r.status, JSON.stringify(r.body));
    expect(r.status).toBe(201);
  });

  it.fails("PROBE-2 [KNOWN DEFECT AUD-R2] customer cannot bind another customer's file key to their own ticket", async () => {
    const up = await request(app).post("/api/upload").set("Authorization", `Bearer ${bTok}`).field("category", "quotations").attach("file", PNG, { filename: "x.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    const key: string = up.body.key; created.push(key.replace("/api/files/", ""));
    // Without a signature, A must not read B's file.
    const direct = await request(app).get(key).set("Authorization", `Bearer ${aTok}`);
    expect(direct.status).toBe(404);
    // A files a DAMAGE ticket and references B's key as their own quotation.
    await mem.complaint.create({ data: { id: "C-55000002", customerId: a.id, type: ComplaintType.DAMAGE, site: "RUSH Al Kharj", posRecordId: "VISIT-UNLISTED", posRecordLabel: "g", summary: "probe", assignedRole: StaffRole.OPS_MANAGER } });
    const s1 = await request(app).post("/api/complaints/C-55000002/damage/step1").set("Authorization", `Bearer ${aTok}`).send({ quotationUrl: key, quotedAmount: 10 });
    console.log("PROBE-2 step1 status:", s1.status);
    const after = await request(app).get(key).set("Authorization", `Bearer ${aTok}`);
    console.log("PROBE-2 A reads B's file after binding it:", after.status);
    expect(after.status).toBe(404);
  });

  it.fails("PROBE-3 [KNOWN DEFECT AUD-R3] waiverSignature accepts non-image data URLs and admin echoes them back", async () => {
    await mem.complaint.create({ data: { id: "C-55000003", customerId: a.id, type: ComplaintType.DAMAGE, site: "RUSH Al Kharj", posRecordId: "VISIT-UNLISTED", posRecordLabel: "g", summary: "probe", assignedRole: StaffRole.OPS_MANAGER } });
    const up = await request(app).post("/api/upload").set("Authorization", `Bearer ${aTok}`).attach("file", PNG, { filename: "q.png", contentType: "image/png" });
    created.push(up.body.key.replace("/api/files/", ""));
    const svg = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    const s1 = await request(app).post("/api/complaints/C-55000003/damage/step1").set("Authorization", `Bearer ${aTok}`).send({ quotationUrl: up.body.key, waiverSignature: svg });
    expect(s1.status).toBe(200);
    const list = await request(app).get("/api/admin/claims").set("Authorization", `Bearer ${adminTok}`);
    const c = list.body.find((x: any) => x.id === "C-55000003");
    console.log("PROBE-3 admin waiverSignatureUrl starts with:", String(c?.waiverSignatureUrl).slice(0, 40));
    expect(String(c?.waiverSignatureUrl || "")).not.toMatch(/^data:image\/svg/);
  });
});

describe("re-audit HTTP hygiene (regression: expected to PASS)", () => {
  let app: any;
  beforeAll(() => { app = createIsolatedApp(new InMemoryPrismaClient()); });
  it("serves only public/: no source, env, lockfile, schema or audit docs", async () => {
    for (const p of ["/.env", "/package.json", "/package-lock.json", "/prisma/schema.prisma", "/src/server.ts", "/AUDIT/FINAL_GO_LIVE_REPORT.md", "/.git/config", "/uploads/", "/dist/server.js"]) {
      const r = await request(app).get(p);
      expect([404, 401, 403], `${p} -> ${r.status}`).toContain(r.status);
      expect(String(r.text || "")).not.toMatch(/JWT_SECRET|datasource db|createApp/);
    }
  });
  it("path traversal and malformed keys on /api/files are rejected without touching disk", async () => {
    for (const p of ["/api/files/..%2f..%2fetc%2fpasswd", "/api/files/media/../../package.json", "/api/files/%2e%2e/%2e%2e/.env", "/api/files/media/1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png%00.html"]) {
      const r = await request(app).get(p);
      expect([400, 401, 404], `${p} -> ${r.status}`).toContain(r.status);
    }
  });
  it("security headers present; API responses are no-store; no X-Powered-By", async () => {
    const page = await request(app).get("/");
    expect(page.headers["x-powered-by"]).toBeUndefined();
    expect(page.headers["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(page.headers["strict-transport-security"]).toBeDefined();
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    const api = await request(app).get("/api/health");
    expect(api.headers["cache-control"]).toMatch(/no-store/);
  });
  it("unknown API route and malformed JSON return clean JSON errors (no stack trace)", async () => {
    const nf = await request(app).get("/api/nope/../zzz");
    expect(nf.status).toBe(404);
    const bad = await request(app).post("/api/auth/request-otp").set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });
  it("CORS: cross-origin browsers get no Access-Control-Allow-Origin by default", async () => {
    const r = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("all admin endpoints reject missing / forged / customer-scoped tokens", async () => {
    const forged = jwt.sign({ staffId: "x", role: "BUSINESS_OWNER", branch: "All Branches", name: "n", email: "e" }, "wrong-secret-wrong-secret-wrong-secret!!", { audience: "rush-staff", issuer: "rush-care" });
    const custTok = signCustomerToken({ customerId: "c1", phone: "500000099", licensePlate: "X", scope: "otp" }, "5m");
    for (const [m, p] of [["get", "/api/admin/dashboard"], ["get", "/api/admin/claims"], ["get", "/api/admin/staff"], ["get", "/api/admin/finance"], ["get", "/api/admin/finance/export.csv"], ["patch", "/api/admin/config"], ["post", "/api/admin/staff"], ["get", "/api/admin/customers/c1/export"]] as const) {
      for (const tok of [undefined, forged, custTok]) {
        const r = await (request(app) as any)[m](p).set(...(tok ? ["Authorization", `Bearer ${tok}`] : ["X-None", "1"])).send({});
        expect(r.status, `${m} ${p} tok=${tok ? tok.slice(0, 8) : "none"}`).toBe(401);
      }
    }
  });
});
