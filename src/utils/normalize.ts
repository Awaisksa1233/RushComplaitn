import crypto from "crypto";
import { OTP_PEPPER } from "../config/env";

export function normalizePlate(p: string): string {
  return p.toUpperCase().replace(/[^A-Z0-9ء-ي]/g, "").slice(0, 12);
}

export function normalizePhone(p: string): string {
  return p.replace(/\D/g, "").slice(-9);
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

/** Only allow references to files we host (local uploads, our R2 proxy, or the configured R2 public URL). */
export function isSafeFileUrl(u: string): boolean {
  if (u.length > 600) return false;
  if (/^\/(uploads|api\/files)\/[A-Za-z0-9_\-./]+$/.test(u) && !u.includes("..")) return true;
  const pub = process.env.R2_PUBLIC_URL;
  return Boolean(pub && u.startsWith(pub.replace(/\/$/, "") + "/") && /^https:\/\//.test(u));
}
