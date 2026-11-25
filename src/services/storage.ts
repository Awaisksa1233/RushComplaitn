import path from "path";
import fs from "fs";
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { VALID_STORAGE_KEY } from "../utils/crypto";
import { isProd } from "../config/env";

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME || "rushwash";
  const publicUrl = process.env.R2_PUBLIC_URL || "";
  const isR2Configured = Boolean(accountId && accessKeyId && secretAccessKey);
  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl, isR2Configured };
}

let _r2Client: S3Client | null = null;
export function getR2Client(): S3Client | null {
  const { accountId, accessKeyId, secretAccessKey, isR2Configured } = getR2Config();
  if (!isR2Configured) return null;
  if (!_r2Client) {
    _r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
    });
  }
  return _r2Client;
}

// Local uploads directory fallback
const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** Magic-byte check so a renamed HTML/SVG/EXE cannot masquerade as an image or PDF. */
export function sniffMatches(buf: Buffer, mime: string): boolean {
  const h = buf.subarray(0, 12);
  switch (mime) {
    case "image/jpeg": return h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
    case "image/png": return h.subarray(0, 4).toString("hex") === "89504e47";
    case "image/webp": return h.subarray(0, 4).toString() === "RIFF" && h.subarray(8, 12).toString() === "WEBP";
    case "application/pdf": return h.subarray(0, 4).toString() === "%PDF";
    case "video/mp4":
    case "video/quicktime": return h.subarray(4, 8).toString() === "ftyp";
    default: return false;
  }
}

/** Keys are server-generated (random, extension derived from validated MIME); client filenames are never used. */
export function newObjectKey(prefix: string, mimeType: string): string {
  return `${prefix}/${Date.now()}-${crypto.randomBytes(16).toString("hex")}.${ALLOWED_UPLOAD_TYPES[mimeType]}`;
}

export async function uploadFile(fileBuffer: Buffer, mimeType: string, prefix: string = "complaints"): Promise<string> {
  const { bucketName } = getR2Config();
  const client = getR2Client();
  const key = newObjectKey(prefix, mimeType);

  if (client) {
    try {
      await client.send(
        new PutObjectCommand({ Bucket: bucketName, Key: key, Body: fileBuffer, ContentType: mimeType })
      );
      // Always go through the authenticated-by-obscurity proxy route; objects are never public.
      return `/api/files/${key}`;
    } catch (err) {
      if (isProd && process.env.ALLOW_LOCAL_STORAGE_FALLBACK !== "true") {
        throw err;
      }
      console.warn("R2 upload error, falling back to local storage (non-production)");
    }
  }

  const localFilePath = resolveLocalPath(key)!;
  await fs.promises.mkdir(path.dirname(localFilePath), { recursive: true });
  await fs.promises.writeFile(localFilePath, fileBuffer, { mode: 0o640 });
  return `/api/files/${key}`;
}

/** Resolve a key inside uploads/ — null if it would escape the directory. */
export function resolveLocalPath(key: string): string | null {
  const full = path.resolve(uploadsDir, key);
  return full.startsWith(uploadsDir + path.sep) ? full : null;
}

export async function getFileFromR2(key: string) {
  const client = getR2Client();
  const { bucketName } = getR2Config();
  if (!client) return null;
  try {
    return await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
  } catch (err) {
    return null;
  }
}

export function extractStorageKey(fileUrlOrKey: string | null | undefined): string | null {
  if (!fileUrlOrKey) return null;
  const trimmed = fileUrlOrKey.trim().split("?")[0];
  const key = trimmed.startsWith("/api/files/") ? trimmed.slice("/api/files/".length) : trimmed;
  return VALID_STORAGE_KEY.test(key) ? key : null;
}

export async function deleteFile(fileUrlOrKey: string | null | undefined): Promise<void> {
  const key = extractStorageKey(fileUrlOrKey);
  if (!key) return;

  const client = getR2Client();
  const { bucketName } = getR2Config();
  if (client) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    } catch (err: any) {
      console.warn("[Storage] R2 delete error:", err?.message || err);
    }
  }

  const localPath = resolveLocalPath(key);
  if (localPath && fs.existsSync(localPath)) {
    await fs.promises.unlink(localPath).catch(() => {});
  }
}

export async function deleteFiles(urls: Array<string | null | undefined>): Promise<void> {
  await Promise.all(urls.filter(Boolean).map((u) => deleteFile(u)));
}
