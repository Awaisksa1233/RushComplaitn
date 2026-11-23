import rateLimit from "express-rate-limit";

const base = { standardHeaders: true, legacyHeaders: false } as const;
const json = (error: string) => ({ error });

export const globalLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 300, message: json("Too many requests") });
export const otpRequestLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 10, message: json("Too many OTP requests. Try again later.") });
export const otpVerifyLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 20, message: json("Too many verification attempts. Try again later.") });
export const trackLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 20, message: json("Too many lookups. Try again later.") });
export const staffLoginLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, message: json("Too many login attempts. Try again later.") });
export const uploadLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 40, message: json("Too many uploads") });
export const webhookLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 120, message: json("Too many requests") });
