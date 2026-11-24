import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import { uploadFile, ALLOWED_UPLOAD_TYPES, sniffMatches } from "../services/storage";
import { CUSTOMER_JWT_SECRET, STAFF_JWT_SECRET } from "../config/env";
import { uploadLimiter } from "../middleware/security";
import { asyncHandler } from "../utils/asyncHandler";

const CATEGORIES = new Set(["media", "quotations", "invoices", "complaints", "damage"]);

function requireAnyAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    jwt.verify(token, CUSTOMER_JWT_SECRET, { audience: "rush-customer", issuer: "rush-care", algorithms: ["HS256"] });
    return next();
  } catch {}
  try {
    jwt.verify(token, STAFF_JWT_SECRET, { audience: "rush-staff", issuer: "rush-care", algorithms: ["HS256"] });
    return next();
  } catch {}
  return res.status(401).json({ error: "Invalid or expired session" });
}

export function createUploadRouter() {
  const router = Router();
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
      const url = await uploadFile(req.file.buffer, req.file.mimetype, prefix);
      return res.status(201).json({ url });
    } catch {
      return res.status(500).json({ error: "Failed to upload file" });
    }
  }));

  return router;
}
