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
import { getFileFromR2 } from "./services/storage";

const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Stream files from Cloudflare R2 with local disk fallback
app.get("/api/files/:key(*)", async (req, res) => {
  try {
    const key = req.params.key;
    const s3Res = await getFileFromR2(key);
    if (s3Res && s3Res.Body) {
      if (s3Res.ContentType) res.setHeader("Content-Type", s3Res.ContentType);
      if (s3Res.ContentLength) res.setHeader("Content-Length", s3Res.ContentLength);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return (s3Res.Body as any).pipe(res);
    }

    // Local fallback
    const localPath = path.join(process.cwd(), "uploads", key);
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }
    return res.status(404).json({ error: "File not found" });
  } catch (err: any) {
    return res.status(404).json({ error: "File not found" });
  }
});

// Static serving for local uploads directory
const uploadsPath = path.join(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadsPath));

// Static serving for frontend HTML
const publicPath = path.join(process.cwd());
app.use(express.static(publicPath));

// Cache-busting middleware for HTML routes to ensure browsers always fetch latest UI
app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/admin") {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// Customer Portal Entry
app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "rush_wash_customer_care.html"));
});

// Admin & Operations Console Entry
app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicPath, "rush_admin_operations_console.html"));
});

// Health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected", timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ status: "error", error: err.message });
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
  console.error("Server Error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

export { app, prisma };

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`[RUSH Customer Care Portal API] Running on http://localhost:${PORT}`);
  });
}
