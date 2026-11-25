import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { uploadFile, ALLOWED_UPLOAD_TYPES, sniffMatches } from "../services/storage";
import { CUSTOMER_JWT_SECRET } from "../config/env";
import { uploadLimiter } from "../middleware/security";
import { asyncHandler } from "../utils/asyncHandler";
import { signFileUrl } from "../utils/crypto";
import { verifyActiveStaffJwt } from "./admin";

const CATEGORIES = new Set(["media", "quotations", "invoices", "complaints", "damage", "signatures"]);

function makeRequireAnyAuth(prisma?: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "Authentication required" });
    try {
      const cust = jwt.verify(token, CUSTOMER_JWT_SECRET, {
        audience: "rush-customer",
        issuer: "rush-care",
        algorithms: ["HS256"],
      }) as { customerId?: string; scope?: string; ticketIds?: string[] };
      if (cust.scope === "track" && (!cust.ticketIds || !cust.ticketIds.length)) {
        return res.status(403).json({ error: "Invalid tracking token scope" });
      }
      return next();
    } catch {}

    if (prisma) {
      const staffRes = await verifyActiveStaffJwt(prisma, token);
      if ("staff" in staffRes) return next();
      if (staffRes.status === 403) return res.status(403).json({ error: staffRes.error });
    }
    return res.status(401).json({ error: "Invalid or expired session" });
  };
}

export function createUploadRouter(prisma?: PrismaClient) {
  const router = Router();
  const requireAnyAuth = makeRequireAnyAuth(prisma);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 5 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_UPLOAD_TYPES[file.mimetype]) return cb(null, true);
      cb(new Error("Unsupported file type. Allowed: JPEG, PNG, WebP, PDF, MP4, MOV."));
    },
  });

  router.post("/", uploadLimiter, requireAnyAuth, upload.single("file"), asyncHandler(async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      if (!sniffMatches(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ error: "File content does not match its declared type." });
      }
      const cat = String(req.body.category || "media");
      const prefix = CATEGORIES.has(cat) ? cat : "media";
      const rawUrl = await uploadFile(req.file.buffer, req.file.mimetype, prefix);
      return res.status(201).json({ url: signFileUrl(rawUrl, 7200), key: rawUrl });
    } catch {
      return res.status(500).json({ error: "Failed to upload file" });
    }
  }));

  return router;
}
