import crypto from "crypto";
import { getFieldKey } from "../config/env";

const PREFIX = "enc:v1:";

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
