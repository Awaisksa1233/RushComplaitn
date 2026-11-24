import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { signCustomerToken } from "../middleware/auth";
import { exposeDevOtp } from "../config/env";
import { otpRequestLimiter, otpVerifyLimiter } from "../middleware/security";
import { PrismaClient } from "@prisma/client";
import { normalizePlate, normalizePhone, isSaudiMobile, hashOtp } from "../utils/normalize";
import { findCustomerInMongo } from "../services/mongo";
import { sendSmsOtp } from "../services/unifonic";
import { asyncHandler } from "../utils/asyncHandler";

export function createAuthRouter(prisma: PrismaClient) {
  const router = Router();
  const MAX_ATTEMPTS = 5;
  const WINDOW_MS = 15 * 60 * 1000;

  // 1. Request OTP (Strict Plate + Phone match)
  router.post("/request-otp", otpRequestLimiter, asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        licensePlate: z.string().min(2).max(20),
        phone: z.string().min(9).max(20),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid plate or phone format" });
    }

    const plate = normalizePlate(parsed.data.licensePlate);
    const phone = normalizePhone(parsed.data.phone);
    if (!isSaudiMobile(phone)) {
      return res.status(400).json({ error: "Invalid plate or phone format" });
    }

    // Support both letter/number orderings (e.g. 8821KSA vs KSA8821)
    const letters = plate.replace(/[^A-Z\u0621-\u064A]/g, "");
    const numbers = plate.replace(/[^0-9]/g, "");
    const candidatePlates = Array.from(new Set([plate, numbers + letters, letters + numbers].filter(Boolean)));

    // Per-identity throttle (independent of client IP)
    const recent = await prisma.otpSession.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - WINDOW_MS) } },
    });
    if (recent >= 5) {
      return res.status(429).json({ error: "Too many OTP requests for this number. Try again later." });
    }

    let customer = await prisma.customer.findFirst({
      where: {
        licensePlate: { in: candidatePlates },
        phone,
      },
    });

    // If not in Supabase, check local MongoDB rushwash
    if (!customer) {
      const mongoCust = await findCustomerInMongo(parsed.data.licensePlate, parsed.data.phone);
      if (mongoCust) {
        // Upsert customer into Supabase for this portal session
        customer = await prisma.customer.upsert({
          where: {
            licensePlate_phone: {
              licensePlate: mongoCust.licensePlate,
              phone: mongoCust.phone,
            },
          },
          update: {
            name: mongoCust.name,
            vehicleModel: mongoCust.vehicleModel,
          },
          create: {
            name: mongoCust.name,
            phone: mongoCust.phone,
            licensePlate: mongoCust.licensePlate,
            vehicleModel: mongoCust.vehicleModel,
          },
        });
      }
    }

    if (!customer) {
      return res.status(404).json({
        error: "License plate and mobile number do not match our records.",
      });
    }

    const code = String(crypto.randomInt(100000, 1000000)); // 6 digits, CSPRNG
    // Invalidate any earlier unverified codes for this identity
    await prisma.otpSession.updateMany({
      where: { phone, licensePlate: { in: candidatePlates }, verified: false, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });
    await prisma.otpSession.create({
      data: {
        phone,
        licensePlate: plate,
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min TTL
      },
    });

    // Send real SMS OTP via Unifonic
    sendSmsOtp(phone, code).catch((err) => {
      console.warn("[Auth] Failed to dispatch Unifonic SMS OTP:", err);
    });

    return res.json({
      sent: true,
      message: `OTP sent to +966 ${phone.slice(0, 2)}•••••${phone.slice(-2)}`,
      ...(exposeDevOtp ? { devOtp: code } : {}),
    });
  }));

  // 2. Verify OTP -> Issue Customer JWT
  router.post("/verify-otp", otpVerifyLimiter, asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        licensePlate: z.string().min(2).max(20),
        phone: z.string().min(9).max(20),
        code: z.string().regex(/^\d{6}$/),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const plate = normalizePlate(parsed.data.licensePlate);
    const phone = normalizePhone(parsed.data.phone);

    const letters = plate.replace(/[^A-Z\u0621-\u064A]/g, "");
    const numbers = plate.replace(/[^0-9]/g, "");
    const candidatePlates = Array.from(new Set([plate, numbers + letters, letters + numbers].filter(Boolean)));

    // Cumulative lockout across all recent sessions for this identity
    const recentSessions = await prisma.otpSession.findMany({
      where: { phone, licensePlate: { in: candidatePlates }, createdAt: { gt: new Date(Date.now() - WINDOW_MS) } },
      select: { attempts: true },
    });
    if (recentSessions.reduce((n, x) => n + x.attempts, 0) >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many failed attempts. Try again later." });
    }

    const session = await prisma.otpSession.findFirst({
      where: {
        phone,
        licensePlate: { in: candidatePlates },
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!session || session.attempts >= MAX_ATTEMPTS) {
      return res.status(400).json({ error: "OTP expired or maximum attempts exceeded" });
    }

    const a = Buffer.from(session.codeHash), b = Buffer.from(hashOtp(parsed.data.code));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      await prisma.otpSession.updateMany({
        where: { id: session.id, verified: false, attempts: { lt: MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      return res.status(401).json({ error: "Invalid OTP code" });
    }

    const claimed = await prisma.otpSession.updateMany({
      where: {
        id: session.id,
        verified: false,
        expiresAt: { gt: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      data: { verified: true },
    });
    if (claimed.count !== 1) {
      return res.status(400).json({ error: "OTP expired or maximum attempts exceeded" });
    }

    const customer = await prisma.customer.findFirst({
      where: { licensePlate: { in: candidatePlates }, phone },
    });
    if (!customer) return res.status(400).json({ error: "OTP expired or maximum attempts exceeded" });

    const token = signCustomerToken(
      { customerId: customer.id, phone: customer.phone, licensePlate: customer.licensePlate, scope: "otp" },
      "30m"
    );

    return res.json({
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        vehicleModel: customer.vehicleModel,
        licensePlate: customer.licensePlate,
        phone: customer.phone,
      },
    });
  }));

  return router;
}
