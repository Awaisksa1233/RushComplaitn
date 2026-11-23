import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthedRequest, requireCustomerJwt } from "../middleware/auth";
import { findCustomerInMongo, getWashesFromMongo, getOrdersFromMongo } from "../services/mongo";

export function createCustomerRouter(prisma: PrismaClient) {
  const router = Router();

  // Dynamic Visit History / Orders with 7-Day Window and Duplicate Guard
  router.get("/history", requireCustomerJwt, async (req: AuthedRequest, res: Response) => {
    try {
      const type = String(req.query.type || "UNSATISFIED").toUpperCase();
      const customerId = req.customer!.customerId;

      // Find existing complaints to tag already-reported visits/orders
      const existing = await prisma.complaint.findMany({
        where: { customerId },
        select: { id: true, posRecordId: true },
      });
      const dupMap = new Map<string, string>(
        existing.map((c) => [c.posRecordId, c.id])
      );

      if (type === "BILLING_REFUND" || type === "BILLING / REFUND") {
        let orders = await prisma.posOrder.findMany({
          where: { customerId },
          orderBy: { orderedAt: "desc" },
          take: 10,
        });

        // Check local MongoDB by license plate (Strictly Paid Orders)
        if (!orders.length && req.customer) {
          const mongoCust = await findCustomerInMongo(req.customer.licensePlate, req.customer.phone);
          const mOrders = await getOrdersFromMongo(req.customer.licensePlate, mongoCust?.mongoCustomerId, 10);
          if (mOrders.length) {
            return res.json({
              kind: "orders",
              allowUnlisted: true,
              records: mOrders.map((o) => ({
                ...o,
                alreadyReportedTicketId: dupMap.get(o.id) || null,
              })),
            });
          }
        }

        return res.json({
          kind: "orders",
          allowUnlisted: true,
          records: orders.map((o) => ({
            ...o,
            amountSar: Number(o.amountSar),
            alreadyReportedTicketId: dupMap.get(o.id) || null,
          })),
        });
      }

      // Default: UNSATISFIED, DAMAGE, and OTHER return last 3 washes within past 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      let washes = await prisma.washVisit.findMany({
        where: {
          customerId,
          washedAt: { gte: sevenDaysAgo },
        },
        orderBy: { washedAt: "desc" },
        take: 3,
      });

      // Check local MongoDB by license plate (Prioritizing Main Exterior Wash)
      if (!washes.length && req.customer) {
        const mongoCust = await findCustomerInMongo(req.customer.licensePlate, req.customer.phone);
        const mWashes = await getWashesFromMongo(req.customer.licensePlate, mongoCust?.mongoCustomerId, 7, 3);
        if (mWashes.length) {
          return res.json({
            kind: "washes",
            records: mWashes.map((w) => ({
              ...w,
              alreadyReportedTicketId: dupMap.get(w.id) || null,
            })),
          });
        }
      }

      return res.json({
        kind: "washes",
        records: washes.map((w) => ({
          ...w,
          alreadyReportedTicketId: dupMap.get(w.id) || null,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to fetch customer history" });
    }
  });

  return router;
}
