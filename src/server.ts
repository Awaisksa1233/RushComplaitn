import dotenv from "dotenv";
if (process.env.NODE_ENV !== "test") {
  dotenv.config();
}

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import { PrismaClient, StaffRole } from "@prisma/client";
import { createAuthRouter } from "./routes/auth";
import { createCustomerRouter } from "./routes/customer";
import { createComplaintsRouter } from "./routes/complaints";
import { createUploadRouter } from "./routes/upload";
import { createAdminRouter, verifyActiveStaffJwt } from "./routes/admin";
import helmet from "helmet";
import { getFileFromR2, resolveLocalPath } from "./services/storage";
import { CORS_ORIGINS, CUSTOMER_JWT_SECRET } from "./config/env";
import { globalLimiter } from "./middleware/security";
import { startRetentionScheduler } from "./services/retention";
import { startSlaSweeper } from "./services/slaSweeper";
import { closeMongoClient } from "./services/mongo";
import { VALID_STORAGE_KEY, verifyFileUrlSig } from "./utils/crypto";
import { CustomerPayload } from "./middleware/auth";

const prisma = new PrismaClient();

async function resolveFileAuth(
  db: PrismaClient,
  req: express.Request,
  key: string
): Promise<{ allowed: true } | { allowed: false; status: 401 | 403 | 404; error: string }> {
  const exp = typeof req.query.exp === "string" ? req.query.exp : "";
  const sig = typeof req.query.sig === "string" ? req.query.sig : "";
  if (verifyFileUrlSig(key, exp, sig)) return { allowed: true };

  const authHeader = req.headers.authorization || "";
  if (!/^Bearer\s+/i.test(authHeader)) {
    return { allowed: false, status: 401, error: "Unauthorized file access" };
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cleanPath = `/api/files/${key}`;

  try {
    const cust = jwt.verify(token, CUSTOMER_JWT_SECRET, {
      audience: "rush-customer",
      issuer: "rush-care",
      algorithms: ["HS256"],
    }) as CustomerPayload;
    const owned = await db.complaint.findFirst({
      where: {
        customerId: cust.customerId,
        ...(cust.scope === "track" && cust.ticketIds?.length ? { id: { in: cust.ticketIds } } : {}),
        OR: [
          { quotationUrl: cleanPath },
          { invoiceUrl: cleanPath },
          { bankSmsUrl: cleanPath },
          { waiverSignature: cleanPath },
          { mediaUrls: { has: cleanPath } },
        ],
      },
      select: { id: true },
    });
    if (!owned) return { allowed: false, status: 404, error: "File not found" };
    return { allowed: true };
  } catch {}

  const staffRes = await verifyActiveStaffJwt(db, token);
  if ("error" in staffRes) {
    return { allowed: false, status: staffRes.status, error: staffRes.error };
  }
  const staff = staffRes.staff;
  const branchScoped =
    staff.role === StaffRole.OPS_MANAGER ||
    (staff.role === StaffRole.FINANCE && staff.branch !== "All Branches");
  if (branchScoped) {
    const ownSig = await db.staffUser.findUnique({ where: { id: staff.staffId }, select: { signatureUrl: true } });
    if (ownSig?.signatureUrl === cleanPath) return { allowed: true };
    const inBranch = await db.complaint.findFirst({
      where: {
        site: staff.branch,
        OR: [
          { quotationUrl: cleanPath },
          { invoiceUrl: cleanPath },
          { bankSmsUrl: cleanPath },
          { waiverSignature: cleanPath },
          { techSignatureUrl: cleanPath },
          { opsSignatureUrl: cleanPath },
          { financeSignatureUrl: cleanPath },
          { mediaUrls: { has: cleanPath } },
        ],
      },
      select: { id: true },
    });
    if (!inBranch) return { allowed: false, status: 404, error: "File not found" };
  }
  return { allowed: true };
}

export function createApp(db: PrismaClient = prisma) {
  const app = express();

  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY !== "") {
    const hops = Number(process.env.TRUST_PROXY);
    if (!Number.isInteger(hops) || hops < 0) {
      throw new Error("TRUST_PROXY must be a non-negative integer");
    }
    app.set("trust proxy", hops);
  }

  app.use(
    helmet({
      referrerPolicy: { policy: "no-referrer" },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // The two single-file UIs use inline scripts/styles plus CDN libs.
          "script-src": ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
          "img-src": ["'self'", "data:", "blob:"],
          "media-src": ["'self'", "blob:"],
          "connect-src": ["'self'"],
          "script-src-attr": ["'unsafe-inline'"],
          "object-src": ["'none'"],
          "frame-ancestors": ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // Same-origin by default; set CORS_ORIGINS="https://a.example,https://b.example" to allow others.
  app.use(cors({ origin: CORS_ORIGINS.length ? CORS_ORIGINS : false }));
  app.use(globalLimiter);
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  // Keep the raw body for webhook signature verification; small JSON limit (uploads use multipart).
  app.use(
    express.json({
      limit: "1mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  // Uploaded files: unguessable server-generated keys only, never executable/renderable as HTML.
  app.get("/api/files/:key(*)", async (req, res) => {
    const key = req.params.key;
    if (!VALID_STORAGE_KEY.test(key)) return res.status(404).json({ error: "File not found" });
    const auth = await resolveFileAuth(db, req, key);
    if (!auth.allowed) return res.status(auth.status).json({ error: auth.error });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "private, no-store");
    if (!/\.(jpg|png|webp)$/i.test(key)) {
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(key)}"`);
    }
    try {
      const s3Res = await getFileFromR2(key);
      if (s3Res && s3Res.Body) {
        if (s3Res.ContentType) res.setHeader("Content-Type", s3Res.ContentType);
        if (s3Res.ContentLength) res.setHeader("Content-Length", String(s3Res.ContentLength));
        return (s3Res.Body as any).pipe(res);
      }
      const localPath = resolveLocalPath(key);
      if (localPath && fs.existsSync(localPath)) {
        return res.sendFile(localPath, { dotfiles: "deny" });
      }
    } catch {
      /* fall through */
    }
    return res.status(404).json({ error: "File not found" });
  });

  // Static frontend: ONLY the public/ directory is served (never the project root).
  const publicPath = path.join(process.cwd(), "public");
  app.use(express.static(publicPath, { index: false, dotfiles: "deny" }));

  const noCache = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  };
  app.get("/", noCache, (_req, res) => res.sendFile(path.join(publicPath, "rush_wash_customer_care.html")));
  app.get("/admin", noCache, (_req, res) => res.sendFile(path.join(publicPath, "rush_admin_operations_console.html")));

  // Health check — no internals leaked
  app.get("/api/health", async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "error" });
    }
  });

  // Mount Routes
  app.use("/api/auth", createAuthRouter(db));
  app.use("/api/customer", createCustomerRouter(db));
  app.use("/api/complaints", createComplaintsRouter(db));
  app.use("/api/upload", createUploadRouter(db));
  app.use("/api/admin", createAdminRouter(db));

  // API 404 JSON catch-all
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.name === "MulterError" || /Unsupported file type/.test(err?.message || "")) {
      return res.status(400).json({ error: err.message });
    }
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Payload too large" });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON" });
    console.error("Server Error:", err?.message);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

const app = createApp(prisma);

export { app, prisma };

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(PORT, () => {
    console.log(`[RUSH Customer Care Portal API] Listening on port ${PORT}`);
  });
  startRetentionScheduler(prisma);
  startSlaSweeper(prisma);

  const shutdown = (signal: string) => {
    console.log(`[RUSH Customer Care Portal API] Received ${signal}, shutting down cleanly...`);
    server.close(async () => {
      await prisma.$disconnect().catch(() => {});
      await closeMongoClient();
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
