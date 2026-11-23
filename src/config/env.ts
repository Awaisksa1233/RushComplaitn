import crypto from "crypto";

const isTest = process.env.NODE_ENV === "test";

function requireSecret(name: string, minLen = 32): string {
  const v = process.env[name];
  if (v && v.length >= minLen) return v;
  if (isTest) return `test-only-${name}-${"x".repeat(minLen)}`;
  throw new Error(`${name} must be set (min ${minLen} chars). Refusing to start with a missing/weak secret.`);
}

// Master secret; customer and staff tokens use independently derived keys so one can never be replayed as the other.
const MASTER = requireSecret("JWT_SECRET");
const derive = (label: string) => crypto.createHmac("sha256", MASTER).update(label).digest("hex");

export const CUSTOMER_JWT_SECRET = derive("rush:customer-jwt:v1");
export const STAFF_JWT_SECRET = derive("rush:staff-jwt:v1");
export const OTP_PEPPER = derive("rush:otp:v1");

export const isProd = process.env.NODE_ENV === "production";
export const exposeDevOtp = process.env.NODE_ENV === "development" && process.env.EXPOSE_DEV_OTP === "true";

export const ALLOWED_SITES = (process.env.ALLOWED_SITES || "RUSH Al Kharj").split(",").map((s) => s.trim());
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
export const WHATSAPP_WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || "";

// 32-byte key for field-level encryption of bank data (hex or base64). Required in production.
export function getFieldKey(): Buffer | null {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    if (isProd) throw new Error("FIELD_ENCRYPTION_KEY is required in production");
    return null;
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must decode to 32 bytes");
  return buf;
}
if (isProd) getFieldKey();

export const RETENTION = {
  otpHours: Number(process.env.RETENTION_OTP_HOURS || 24),
  bankDetailsDaysAfterPaid: Number(process.env.RETENTION_BANK_DAYS || 90),
  anonymiseTicketsAfterDays: Number(process.env.RETENTION_TICKET_DAYS || 730),
};
