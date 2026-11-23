import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { createAuthRouter } from "./routes/auth";
import { createCustomerRouter } from "./routes/customer";
import { createComplaintsRouter } from "./routes/complaints";
import { createUploadRouter } from "./routes/upload";
import { createAdminRouter } from "./routes/admin";
import helmet from "helmet";
import { getFileFromR2, resolveLocalPath } from "./services/storage";
import { CORS_ORIGINS } from "./config/env";
import { globalLimiter } from "./middleware/security";
import { startRetentionScheduler } from "./services/retention";

const app = express();
const prisma = new PrismaClient();

app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(
  helmet({
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
const FILE_KEY = /^(media|quotations|invoices|complaints|damage)\/\d+-[0-9a-f]{32}\.(jpg|png|webp|pdf|mp4|mov)$/;
app.get("/api/files/:key(*)", async (req, res) => {
  const key = req.params.key;
  if (!FILE_KEY.test(key)) return res.status(404).json({ error: "File not found" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
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
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "error" });
  }
});

// Mount Routes
app.use("/api/auth", createAuthRouter(prisma));
app.use("/api/customer", createCustomerRouter(prisma));
app.use("/api/complaints", createComplaintsRouter(prisma));
app.use("/api/upload", createUploadRouter());
app.use("/api/admin", createAdminRouter(prisma));

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

export { app, prisma };

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`[RUSH Customer Care Portal API] Listening on port ${PORT}`);
  });
  startRetentionScheduler(prisma);
}
