import { Router } from "express";
import multer from "multer";
import { uploadFile } from "../services/storage";

export function createUploadRouter() {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
  });

  router.post("/", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const prefix = (req.body.category || "media").replace(/[^a-zA-Z0-9_-]/g, "");
      const url = await uploadFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        prefix
      );

      return res.status(201).json({ url });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to upload file" });
    }
  });

  return router;
}
