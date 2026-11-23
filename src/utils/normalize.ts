import crypto from "crypto";

export function normalizePlate(p: string): string {
  return p.toUpperCase().replace(/[^A-Z0-9\u0621-\u064A]/g, "");
}

export function normalizePhone(p: string): string {
  return p.replace(/\D/g, "").slice(-9);
}

export function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}
