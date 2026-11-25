import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { CUSTOMER_JWT_SECRET } from "../config/env";

export interface CustomerPayload {
  customerId: string;
  phone: string;
  licensePlate: string;
  scope?: "otp" | "track";
  ticketIds?: string[];
}

export interface AuthedRequest extends Request {
  customer?: CustomerPayload;
}

export function signCustomerToken(payload: CustomerPayload, expiresIn: string | number) {
  return jwt.sign(payload, CUSTOMER_JWT_SECRET, { expiresIn: expiresIn as any, audience: "rush-customer", issuer: "rush-care" });
}

export function buildDirectTicketUrl(
  customer: { id: string; phone: string; licensePlate: string },
  ticketId: string
): string {
  const token = signCustomerToken(
    { customerId: customer.id, phone: customer.phone, licensePlate: customer.licensePlate, scope: "track", ticketIds: [ticketId] },
    "48h"
  );
  const base = (process.env.PUBLIC_PORTAL_URL || "https://crm.rush.com.sa").replace(/\/+$/, "");
  return `${base}/?t=${encodeURIComponent(token)}`;
}

/** Optional customer JWT extraction for routes that elevate privileges only when verified. */
export function tryDecodeCustomerJwt(req: Request): CustomerPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  try {
    return jwt.verify(token, CUSTOMER_JWT_SECRET, {
      algorithms: ["HS256"],
      audience: "rush-customer",
      issuer: "rush-care",
    }) as CustomerPayload;
  } catch {
    return null;
  }
}

export function requireCustomerJwt(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return res.status(401).json({ error: "Missing session token" });
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  try {
    req.customer = jwt.verify(token, CUSTOMER_JWT_SECRET, {
      algorithms: ["HS256"], audience: "rush-customer", issuer: "rush-care",
    }) as CustomerPayload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

/** Ticket-scoped access: a token must belong to the ticket's owner. Returns true if allowed. */
export function ownsTicket(req: AuthedRequest, ticket: { id: string; customerId: string }): boolean {
  const c = req.customer;
  if (!c || c.customerId !== ticket.customerId) return false;
  if (c.scope === "track" && !(c.ticketIds || []).includes(ticket.id)) return false;
  return true;
}
