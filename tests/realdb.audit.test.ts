/**
 * Real-PostgreSQL verification (re-audit 2026-11-25).
 * Runs ONLY against a throwaway local database:  REALDB_AUDIT=1 DATABASE_URL=postgresql://...@127.0.0.1:PORT/db
 * Refuses to run if the DB host is not localhost. Uses synthetic data only.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
vi.hoisted(() => { process.env.NODE_ENV = "test"; });
import request from "supertest";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { PrismaClient, StaffRole, ComplaintType, PayoutStatus, TicketStatus } from "@prisma/client";
import { createApp } from "../src/server";
import { STAFF_JWT_SECRET } from "../src/config/env";
import { signCustomerToken } from "../src/middleware/auth";
import { encryptField } from "../src/utils/crypto";

const host = (() => { try { return new URL(process.env.DATABASE_URL || "").hostname; } catch { return ""; } })();
const enabled = process.env.REALDB_AUDIT === "1" && ["127.0.0.1", "localhost"].includes(host);

describe.skipIf(!enabled)("real PostgreSQL: constraints, concurrency, scale", { timeout: 120000 }, () => {
  const prisma = new PrismaClient();
  const app = createApp(prisma);
  let cust: any, custTok: string, ownerTok: string, financeTok: string;
  const tag = crypto.randomBytes(3).toString("hex");
  let staffSeq = 0;

  const staffToken = async (role: StaffRole, branch = "All Branches") => {
    const n = ++staffSeq; const hash = "x".repeat(20) + tag + role + n;
    const s = await prisma.staffUser.create({ data: { name: `RA ${role}`, email: `ra.${role.toLowerCase()}.${tag}.${n}@example.test`, role, branch, passwordHash: hash } });
    const pwdFp = crypto.createHmac("sha256", STAFF_JWT_SECRET).update(hash).digest("hex").slice(0, 16);
    return jwt.sign({ staffId: s.id, name: s.name, role: s.role, branch: s.branch, email: s.email, pwdFp }, STAFF_JWT_SECRET, { expiresIn: "1h", audience: "rush-staff", issuer: "rush-care" });
  };

  beforeAll(async () => {
    cust = await prisma.customer.create({ data: { name: "RA Cust", phone: "5000" + tag.slice(0, 5).replace(/\D/g, "1").padEnd(5, "1"), licensePlate: "RA" + tag.toUpperCase(), vehicleModel: "T" } });
    custTok = signCustomerToken({ customerId: cust.id, phone: cust.phone, licensePlate: cust.licensePlate, scope: "otp" }, "30m");
    ownerTok = await staffToken(StaffRole.BUSINESS_OWNER);
    financeTok = await staffToken(StaffRole.FINANCE);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("DB-1 partial unique index: 10 concurrent direct inserts for one listed record -> exactly 1 row", async () => {
    await prisma.washVisit.create({ data: { id: `W-${tag}-1`, customerId: cust.id, site: "RUSH Al Kharj", lane: "1", packageName: "p", washedAt: new Date() } });
    const mk = (i: number) => prisma.complaint.create({ data: { id: `C-9${tag}${i}`.slice(0, 12), customerId: cust.id, type: ComplaintType.UNSATISFIED, site: "RUSH Al Kharj", posRecordId: `W-${tag}-1`, posRecordLabel: "x", summary: "dup test", assignedRole: StaffRole.ADMIN } });
    const res = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => mk(i)));
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(1);
  });

  it("DB-2 API: 10 concurrent POST /complaints for the same visit -> exactly 1 x 201, rest 409", async () => {
    await prisma.washVisit.create({ data: { id: `W-${tag}-2`, customerId: cust.id, site: "RUSH Al Kharj", lane: "1", packageName: "p", washedAt: new Date() } });
    const body = { type: "UNSATISFIED", posRecordId: `W-${tag}-2`, posRecordLabel: "visit", site: "RUSH Al Kharj", summary: "concurrent submit" };
    const rs = await Promise.all(Array.from({ length: 10 }, () => request(app).post("/api/complaints").set("Authorization", `Bearer ${custTok}`).send(body)));
    const codes = rs.map((r) => r.status).sort();
    console.log("DB-2 status codes:", codes.join(","));
    expect(codes.filter((c) => c === 201).length).toBe(1);
    expect(codes.filter((c) => c === 409).length).toBe(9);
  });

  it("DB-3 API: 10 concurrent mark-paid on one ticket -> exactly 1 x 200 and one PAID transition", async () => {
    const id = `C-8${tag}0`;
    await prisma.complaint.create({ data: { id, customerId: cust.id, type: ComplaintType.DAMAGE, site: "RUSH Al Kharj", posRecordId: "VISIT-UNLISTED", posRecordLabel: "x", summary: "pay", assignedRole: StaffRole.OPS_MANAGER, quotationApproved: true, quotedAmount: 150, payoutStatus: PayoutStatus.PENDING_BANK_TRANSFER, status: TicketStatus.PENDING_PAYOUT, iban: encryptField("SA0380000000608010167519"), bankName: "B", accountHolder: encryptField("Holder X") } });
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => request(app).post(`/api/admin/finance/${id}/mark-paid`).set("Authorization", `Bearer ${financeTok}`).send({ transferRef: `TRF-${tag}${i}` })));
    const codes = rs.map((r) => r.status).sort();
    console.log("DB-3 status codes:", codes.join(","));
    expect(codes.filter((c) => c === 200).length).toBe(1);
    const audits = await prisma.auditLog.count({ where: { complaintId: id, action: "MARK_PAID" } });
    expect(audits).toBe(1);
  });

  it.fails("DB-0 [KNOWN DEFECT AUD-R6] first-ever admin requests on an empty SystemConfig table race and one returns 500", async () => {
    await prisma.systemConfig.deleteMany();
    const fresh = createApp(prisma); // fresh router => empty in-process config cache
    const rs = await Promise.all([1, 2, 3, 4].map(() => request(fresh).get("/api/admin/config").set("Authorization", `Bearer ${ownerTok}`)));
    console.log("DB-0 status codes:", rs.map((r) => r.status).sort().join(","));
    expect(rs.every((r) => r.status === 200)).toBe(true);
  });

  it("DB-4 duplicate RRN across two billing tickets, approved concurrently -> exactly one wins", async () => {
    await prisma.systemConfig.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
    const ids = [`C-7${tag}A`, `C-7${tag}B`];
    for (const id of ids) {
      await prisma.complaint.create({ data: { id, customerId: cust.id, type: ComplaintType.BILLING_REFUND, site: "RUSH Al Kharj", posRecordId: "ORD-UNLISTED", posRecordLabel: "x", summary: "refund", assignedRole: StaffRole.ADMIN, requestedAmount: 50 } });
    }
    const rs = await Promise.all(ids.map((id) => request(app).post(`/api/admin/claims/${id}/billing/approve`).set("Authorization", `Bearer ${ownerTok}`).send({ rrn: `RRN${tag}99`, amount: 50 })));
    const codes = rs.map((r) => r.status).sort();
    console.log("DB-4 status codes:", codes.join(","));
    expect(codes).toEqual([200, 409]);
  });

  it("PERF-1 scale: 5,000 tickets (3 msgs + 1 audit each) -> /claims?limit=50 and /dashboard latency & RSS", async () => {
    const N = 5000;
    const rows = Array.from({ length: N }, (_, i) => ({ id: `C-6${tag}${String(i).padStart(5, "0")}`.slice(0, 14), customerId: cust.id, type: ComplaintType.OTHER, site: "RUSH Al Kharj", posRecordId: "VISIT-GENERAL", posRecordLabel: "x", summary: "bulk ticket " + i, assignedRole: StaffRole.ADMIN }));
    await prisma.complaint.createMany({ data: rows, skipDuplicates: true });
    await prisma.message.createMany({ data: rows.flatMap((r) => [0, 1, 2].map((k) => ({ complaintId: r.id, sender: "Customer", channel: "WEB_PORTAL" as const, body: `m${k} ` + "x".repeat(200) }))) });
    await prisma.auditLog.createMany({ data: rows.map((r) => ({ complaintId: r.id, actorName: "x", action: "PATCH_CLAIM", details: "d" })) });
    const total = await prisma.complaint.count();
    const t = async (path: string) => { const s = process.hrtime.bigint(); const r = await request(app).get(path).set("Authorization", `Bearer ${ownerTok}`); return { ms: Number(process.hrtime.bigint() - s) / 1e6, status: r.status, bytes: JSON.stringify(r.body).length, total: r.headers["x-total-count"] }; };
    const rss0 = process.memoryUsage().rss / 1048576;
    const claimsCold = await t("/api/admin/claims?limit=50");
    const claimsWarm = await t("/api/admin/claims?limit=50");
    const claimsPage2 = await t("/api/admin/claims?limit=50&offset=50");
    const dash = await t("/api/admin/dashboard");
    const rss1 = process.memoryUsage().rss / 1048576;
    console.log("PERF-1", JSON.stringify({ totalTickets: total, claimsCold, claimsWarm, claimsPage2, dash, rssMB: [Math.round(rss0), Math.round(rss1)] }));
    expect(claimsCold.status).toBe(200);
  });

  it("ISO-1 real PG: cross-user (A vs B) and cross-branch isolation across customer, file and staff endpoints", async () => {
    const mk = async (suffix: string) => {
      const c = await prisma.customer.create({ data: { name: "ISO " + suffix, phone: "5001" + Math.floor(Math.random() * 1e5).toString().padStart(5, "0"), licensePlate: "ISO" + suffix + tag.toUpperCase(), vehicleModel: "T" } });
      return { c, tok: signCustomerToken({ customerId: c.id, phone: c.phone, licensePlate: c.licensePlate, scope: "otp" }, "30m") };
    };
    const A = await mk("A"), B = await mk("B"), C = await mk("C");
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const up = await request(app).post("/api/upload").set("Authorization", `Bearer ${B.tok}`).attach("file", PNG, { filename: "e.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    const key: string = up.body.key; const signed: string = up.body.url;
    const bId = "C-" + (40000000 + Math.floor(Math.random() * 9999999)), aId = "C-" + (50000000 + Math.floor(Math.random() * 9999999));
    await prisma.complaint.create({ data: { id: bId, customerId: B.c.id, type: ComplaintType.DAMAGE, site: "RUSH Al Kharj", posRecordId: "VISIT-UNLISTED", posRecordLabel: "x", summary: "B secret", assignedRole: StaffRole.OPS_MANAGER, mediaUrls: [key], quotationApproved: true, quotedAmount: 80, iban: encryptField("SA0380000000608010167519"), bankName: "BANKB", accountHolder: encryptField("B Holder"), payoutStatus: PayoutStatus.PENDING_BANK_TRANSFER, status: TicketStatus.PENDING_PAYOUT } });
    await prisma.complaint.create({ data: { id: aId, customerId: A.c.id, type: ComplaintType.OTHER, site: "RUSH Al Kharj", posRecordId: "VISIT-GENERAL", posRecordLabel: "x", summary: "A own", assignedRole: StaffRole.ADMIN } });
    const as = (tok: string) => (r: any) => r.set("Authorization", `Bearer ${tok}`);
    const codes: Record<string, number> = {};
    // customer A -> B's ticket: every mutating/reading endpoint must 404
    for (const [name, call] of [
      ["msg", () => as(A.tok)(request(app).post(`/api/complaints/${bId}/messages`)).send({ body: "x" })],
      ["wa", () => as(A.tok)(request(app).post(`/api/complaints/${bId}/whatsapp`)).send({ body: "x" })],
      ["csat", () => as(A.tok)(request(app).post(`/api/complaints/${bId}/csat`)).send({ rating: 1 })],
      ["step1", () => as(A.tok)(request(app).post(`/api/complaints/${bId}/damage/step1`)).send({ quotationUrl: key })],
      ["step2", () => as(A.tok)(request(app).post(`/api/complaints/${bId}/damage/step2`)).send({ invoiceUrl: key, bankName: "EVIL", accountHolder: "Evil", iban: "SA0380000000608010167519" })],
      ["upload-doc", () => as(A.tok)(request(app).post(`/api/complaints/${bId}/damage/upload-doc`)).send({ field: "quotationUrl", url: key })],
    ] as const) { codes[name] = (await (call as any)()).status; }
    expect(Object.values(codes).every((c) => c === 404), JSON.stringify(codes)).toBe(true);
    // /direct and /track never expose B's data to A
    const direct = await as(A.tok)(request(app).get("/api/complaints/direct"));
    expect(JSON.stringify(direct.body)).not.toMatch(/B secret|BANKB/);
    const track = await request(app).post("/api/complaints/track").send({ query: bId, phone: A.c.phone });
    expect(track.status).toBe(404);
    const trackOwn = await request(app).post("/api/complaints/track").send({ query: bId, phone: B.c.phone });
    expect(trackOwn.body.limited).toBe(true);
    expect(JSON.stringify(trackOwn.body)).not.toMatch(/B secret|BANKB|iban|trackToken/i);
    // files (uses real PG array `has`)
    const f = async (hdr?: string, qs = "") => (await (hdr ? request(app).get(key + qs).set("Authorization", `Bearer ${hdr}`) : request(app).get(key + qs))).status;
    expect(await f(B.tok)).toBe(200);
    expect(await f(A.tok)).toBe(404);
    expect(await f(C.tok)).toBe(404);
    expect(await f()).toBe(401);
    expect(await f(undefined, "?exp=9999999999&sig=" + "0".repeat(64))).toBe(401);
    expect((await request(app).get(signed)).status).toBe(200);
    // staff branch isolation
    const opsOther = await staffToken(StaffRole.OPS_MANAGER, "OTHER_BRANCH");
    const finOther = await staffToken(StaffRole.FINANCE, "OTHER_BRANCH");
    const opsHome = await staffToken(StaffRole.OPS_MANAGER, "RUSH Al Kharj");
    expect((await as(opsOther)(request(app).get(`/api/admin/claims/${bId}`))).status).toBe(404);
    expect((await as(finOther)(request(app).get(`/api/admin/finance/${bId}/bank-details`))).status).toBe(404);
    expect((await as(finOther)(request(app).post(`/api/admin/finance/${bId}/mark-paid`)).send({ transferRef: "TRF-X1" })).status).toBe(404);
    expect((await as(opsOther)(request(app).get(`/api/admin/claims?limit=500`))).body.some((x: any) => x.id === bId)).toBe(false);
    expect((await as(opsOther)(request(app).get(key))).status).toBe(404);
    expect((await as(opsHome)(request(app).get(key))).status).toBe(200);
    // role: OPS cannot touch money / staff / config
    expect((await as(opsHome)(request(app).post(`/api/admin/finance/${bId}/mark-paid`)).send({ transferRef: "TRF-X2" })).status).toBe(403);
    expect((await as(opsHome)(request(app).get(`/api/admin/staff`))).status).toBe(403);
    expect((await as(opsHome)(request(app).patch(`/api/admin/config`)).send({ damageApprovalCapSar: 99999 })).status).toBe(403);
    // B's bank data unchanged
    const after = await prisma.complaint.findUnique({ where: { id: bId } });
    expect(after?.bankName).toBe("BANKB");
    expect(after?.payoutStatus).toBe(PayoutStatus.PENDING_BANK_TRANSFER);
  });

  it.fails("PERF-2 [KNOWN DEFECT AUD-R7] dashboard KPIs must cover ALL tickets, not just the newest 2,000", async () => {
    const open = await prisma.complaint.count({ where: { status: { not: "RESOLVED" } } });
    const r = await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${ownerTok}`);
    console.log("PERF-2 openCount reported:", r.body?.kpis?.openCount, "actual open tickets:", open);
    expect(r.body.kpis.openCount).toBe(open);
  });
});
