import crypto from "crypto";
import { OTP_PEPPER } from "../config/env";

export function normalizePlate(p: string): string {
  return p.toUpperCase().replace(/[^A-Z0-9ء-ي]/g, "").slice(0, 12);
}

export function normalizePhone(p: string): string {
  const raw = String(p || "").trim();
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (hasPlus && !digits.startsWith("966")) return "";
  if (raw.startsWith("00") && !digits.startsWith("00966")) return "";
  if (digits.startsWith("00966") && digits.length === 14 && digits[5] === "5") return digits.slice(5);
  if (digits.startsWith("966") && digits.length === 12 && digits[3] === "5") return digits.slice(3);
  if (digits.startsWith("05") && digits.length === 10) return digits.slice(1);
  if (digits.startsWith("5") && digits.length === 9) return digits;
  return "";
}

export function isSaudiMobile(normalized: string): boolean {
  return /^5\d{8}$/.test(normalized);
}

export function hashOtp(otp: string): string {
  return crypto.createHmac("sha256", OTP_PEPPER).update(otp).digest("hex");
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Only allow references to files we host (signed or clean /api/files/ keys, or the configured R2 public URL). */
export function isSafeFileUrl(u: string): boolean {
  if (u.length > 600 || u.includes("..")) return false;
  if (/^\/api\/files\/(media|quotations|invoices|complaints|damage|signatures)\/\d+-[0-9a-f]{32}\.(jpg|png|webp|pdf|mp4|mov)(\?exp=\d+&sig=[0-9a-f]{64})?$/.test(u)) return true;
  const pub = process.env.R2_PUBLIC_URL;
  return Boolean(pub && u.startsWith(pub.replace(/\/$/, "") + "/") && /^https:\/\//.test(u));
}
