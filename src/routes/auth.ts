import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { normalizePlate, normalizePhone, hashOtp } from "../utils/normalize";
import { findCustomerInMongo } from "../services/mongo";

export function createAuthRouter(prisma: PrismaClient) {
  const router = Router();
  const JWT_SECRET = process.env.JWT_SECRET || "rush_care_portal_default_secret";

  // 1. Request OTP (Strict Plate + Phone match)
  router.post("/request-otp", async (req, res) => {
    const parsed = z
      .object({
        licensePlate: z.string().min(2),
        phone: z.string().min(9),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid plate or phone format" });
    }

    const plate = normalizePlate(parsed.data.licensePlate);
    const phone = normalizePhone(parsed.data.phone);

    // Support both letter/number orderings (e.g. 8821KSA vs KSA8821)
    const letters = plate.replace(/[^A-Z\u0621-\u064A]/g, "");
    const numbers = plate.replace(/[^0-9]/g, "");
    const candidatePlates = Array.from(new Set([plate, numbers + letters, letters + numbers].filter(Boolean)));

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

    const code = String(1000 + Math.floor(Math.random() * 9000));
    await prisma.otpSession.create({
      data: {
        phone,
        licensePlate: plate,
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min TTL
      },
    });

    return res.json({
      sent: true,
      message: `OTP sent to +966 ${phone}`,
      ...(process.env.NODE_ENV !== "production" ? { devOtp: code } : {}),
    });
  });

  // 2. Verify OTP -> Issue Customer JWT
  router.post("/verify-otp", async (req, res) => {
    const parsed = z
      .object({
        licensePlate: z.string().min(2),
        phone: z.string().min(9),
        code: z.string().length(4),
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

    const session = await prisma.otpSession.findFirst({
      where: {
        phone,
        licensePlate: { in: candidatePlates },
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!session || session.attempts >= 5) {
      return res.status(400).json({ error: "OTP expired or maximum attempts exceeded" });
    }

    if (session.codeHash !== hashOtp(parsed.data.code)) {
      await prisma.otpSession.update({
        where: { id: session.id },
        data: { attempts: { increment: 1 } },
      });
      return res.status(401).json({ error: "Invalid OTP code" });
    }

    await prisma.otpSession.update({
      where: { id: session.id },
      data: { verified: true },
    });

    const customer = await prisma.customer.findFirstOrThrow({
      where: { licensePlate: { in: candidatePlates }, phone },
    });

    const token = jwt.sign(
      {
        customerId: customer.id,
        phone: customer.phone,
        licensePlate: customer.licensePlate,
      },
      JWT_SECRET,
      { expiresIn: "30m" }
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
  });

  return router;
}
