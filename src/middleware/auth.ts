import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface CustomerPayload {
  customerId: string;
  phone: string;
  licensePlate: string;
}

export interface AuthedRequest extends Request {
  customer?: CustomerPayload;
}

export function requireCustomerJwt(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Missing session token" });
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const secret = process.env.JWT_SECRET || "rush_care_portal_default_secret";

  try {
    const decoded = jwt.verify(token, secret) as CustomerPayload;
    req.customer = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired OTP session" });
  }
}
