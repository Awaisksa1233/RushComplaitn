import crypto from "crypto";
import { getFieldKey, FILE_URL_SECRET } from "../config/env";

const PREFIX = "enc:v1:";
export const VALID_STORAGE_KEY = /^(media|quotations|invoices|complaints|damage|signatures)\/\d+-[0-9a-f]{32}\.(jpg|png|webp|pdf|mp4|mov)$/;

/** AES-256-GCM field encryption. Passes plaintext through when no key is configured (dev only). */
export function encryptField(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  const key = getFieldKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function decryptField(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const key = getFieldKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskIban(iban: string | null | undefined): string {
  const v = decryptField(iban ?? null);
  if (!v) return "—";
  return `${v.slice(0, 4)}${"•".repeat(Math.max(0, v.length - 8))}${v.slice(-4)}`;
}

export function randomCode(len: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function cleanFileUrl(u: string | null | undefined): string | null {
  if (u == null || u === "") return u ?? null;
  const trimmed = String(u).trim();
  if (trimmed.startsWith("/api/files/")) {
    const pathOnly = trimmed.split("?")[0];
    const key = pathOnly.slice("/api/files/".length);
    if (VALID_STORAGE_KEY.test(key)) return `/api/files/${key}`;
  }
  return trimmed;
}

export function signFileUrl(u: string | null | undefined, ttlSec = 3600): string | null {
  if (u == null || u === "") return u ?? null;
  const cleaned = cleanFileUrl(u);
  if (!cleaned || !cleaned.startsWith("/api/files/")) return cleaned ?? null;
  const key = cleaned.slice("/api/files/".length);
  if (!VALID_STORAGE_KEY.test(key)) return cleaned;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac("sha256", FILE_URL_SECRET).update(`${key}:${exp}`).digest("hex");
  return `/api/files/${key}?exp=${exp}&sig=${sig}`;
}

export function verifyFileUrlSig(key: string, exp?: string, sig?: string): boolean {
  if (!VALID_STORAGE_KEY.test(key)) return false;
  if (!exp || !/^\d+$/.test(exp) || !sig || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac("sha256", FILE_URL_SECRET).update(`${key}:${exp}`).digest("hex");
  return safeEqual(sig.toLowerCase(), expected);
}
