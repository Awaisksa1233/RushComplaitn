import { MongoClient, ObjectId, Db } from "mongodb";
import { normalizePlate, normalizePhone, escapeRegex } from "../utils/normalize";

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/rushwash";
const ENABLE_LOCAL_MONGO = process.env.ENABLE_LOCAL_MONGO === "true";

let client: MongoClient | null = null;
let db: Db | null = null;

async function getDb(): Promise<Db | null> {
  if (!ENABLE_LOCAL_MONGO) return null;
  if (db) return db;

  try {
    client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
    });
    await client.connect();
    db = client.db("rushwash");
    console.log("[MongoDB Local Adapter] Connected (read-only)");
    return db;
  } catch (err: any) {
    console.warn("[MongoDB Local Adapter] Local MongoDB offline or unreachable:", err.message);
    return null;
  }
}

export interface MongoCustomerMatch {
  mongoCustomerId: string;
  name: string;
  phone: string;
  licensePlate: string;
  vehicleModel: string;
}

export function customerMatchesPhone(cust: any, normPhone: string): boolean {
  if (!normPhone || normPhone.length !== 9) return false;
  const candidates = [cust?.phone, cust?.normalizedPhone, cust?.mobile, cust?.phoneNumber]
    .filter((v) => v != null && String(v).trim() !== "")
    .map((v) => normalizePhone(String(v)));
  return candidates.some((c) => c.length === 9 && c === normPhone);
}

export async function findCustomerInMongo(
  rawPlate: string,
  rawPhone: string
): Promise<MongoCustomerMatch | null> {
  const database = await getDb();
  if (!database) return null;

  try {
    const normPhone = normalizePhone(rawPhone);
    const normPl = normalizePlate(rawPlate);

    // 1. First search vehicles directly by license plate, then verify phone ownership
    const vehicle = await database.collection("rushwash_vehicles").findOne({
      $or: [
        { normalizedPlate: normPl },
        { displayPlate: normPl },
        { plateNumber: normPl },
        { normalizedPlate: new RegExp(`^${escapeRegex(normPl)}$`, "i") },
        { displayPlate: new RegExp(`^${escapeRegex(normPl)}$`, "i") },
      ],
    });

    if (vehicle && vehicle.customerId) {
      const cust = await database.collection("rushwash_customers").findOne({
        _id: vehicle.customerId,
      });

      if (cust && customerMatchesPhone(cust, normPhone)) {
        return {
          mongoCustomerId: String(cust._id),
          name: cust.name || "RUSH Customer",
          phone: normPhone,
          licensePlate: vehicle.displayPlate || vehicle.normalizedPlate || normPl,
          vehicleModel: vehicle.model && vehicle.model !== "N/A" ? vehicle.model : "Vehicle",
        };
      }
    }

    // 2. Fallback: Search by phone if plate lookup didn't resolve verified customer
    const phoneRegex = new RegExp(`${escapeRegex(normPhone)}$`);
    const customers = await database
      .collection("rushwash_customers")
      .find({
        $or: [
          { phone: phoneRegex },
          { normalizedPhone: phoneRegex },
        ],
      })
      .toArray();

    for (const cust of customers) {
      if (!customerMatchesPhone(cust, normPhone)) continue;
      const v = await database.collection("rushwash_vehicles").findOne({
        customerId: cust._id,
        $or: [
          { normalizedPlate: normPl },
          { displayPlate: normPl },
          { plateNumber: normPl },
        ],
      });

      if (v) {
        return {
          mongoCustomerId: String(cust._id),
          name: cust.name || "RUSH Customer",
          phone: normPhone,
          licensePlate: v.displayPlate || v.normalizedPlate || normPl,
          vehicleModel: v.model && v.model !== "N/A" ? v.model : "Vehicle",
        };
      }
    }

    return null;
  } catch (err: any) {
    console.warn("[MongoDB Local Adapter] Error finding customer:", err.message);
    return null;
  }
}

export async function getWashesFromMongo(
  licensePlate: string,
  mongoCustomerId?: string,
  days: number = 7,
  limit: number = 3
) {
  const database = await getDb();
  if (!database) return [];

  try {
    const normPl = normalizePlate(licensePlate);
    const orClauses: any[] = [
      { normalizedPlate: normPl },
      { plateNumber: normPl },
      { "vehicleSnapshot.displayPlate": normPl },
      { normalizedPlate: new RegExp(`^${escapeRegex(normPl)}$`, "i") },
    ];

    if (mongoCustomerId && ObjectId.isValid(mongoCustomerId)) {
      orClauses.push({ customerId: new ObjectId(mongoCustomerId) });
    }

    const query: any = { $or: orClauses };
    if (days > 0) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      query.$and = [
        {
          $or: [
            { createdAt: { $gte: cutoff } },
            { washDate: { $gte: cutoff } },
          ],
        },
      ];
    }

    // Fetch raw wash records
    const rawWashes = await database
      .collection("rushwash_wash_histories")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 3) // fetch more to allow session grouping
      .toArray();

    if (!rawWashes.length) return [];

    // Pre-fetch linked subscriptions and sale orders to resolve true exterior package names
    const subCodes = rawWashes.map((w: any) => w.subscriptionReadableCode).filter(Boolean);
    const orderCodes = rawWashes.map((w: any) => w.saleOrderReadableCode).filter(Boolean);

    const [subs, orders] = await Promise.all([
      subCodes.length ? database.collection("rushwash_subscriptions").find({ readableCode: { $in: subCodes } }).toArray() : [],
      orderCodes.length ? database.collection("rushwash_sale_orders").find({ readableCode: { $in: orderCodes } }).toArray() : []
    ]);

    const subMap = new Map(subs.map((s: any) => [s.readableCode, s]));
    const orderMap = new Map(orders.map((o: any) => [o.readableCode, o]));

    // Group washes on the same visit (within 2 hours of each other) to prioritize main exterior wash
    const visits: any[] = [];
    for (const rw of rawWashes) {
      const washTime = rw.createdAt instanceof Date ? rw.createdAt : new Date(rw.createdAt || Date.now());
      const rawPlan = String(rw.planType || "exterior_wash").toLowerCase();
      let hasExterior = !rawPlan.includes("interior") || rw.exteriorStatus === "done";
      let hasInterior = rawPlan.includes("interior") || Boolean(rw.includesInterior) || rw.interiorStatus === "done";
      let exteriorName = "";

      // 1. Resolve exterior tier from linked subscription
      if (rw.subscriptionReadableCode && subMap.has(rw.subscriptionReadableCode)) {
        const sub: any = subMap.get(rw.subscriptionReadableCode);
        const services = sub?.packageSnapshot?.services || sub?.services || [];
        const extService = services.find((s: any) => s.equipmentKind === "exterior" || /nano|shiny|fresh/i.test(s.nameEn || s.name || ""));
        if (extService) {
          exteriorName = formatPlanName(extService.nameEn || extService.name);
          hasExterior = true;
        } else if (sub?.planSnapshot?.name) {
          exteriorName = formatPlanName(sub.planSnapshot.name);
          hasExterior = true;
        }
      }

      // 2. Resolve exterior tier from linked POS sale order
      if (!exteriorName && rw.saleOrderReadableCode && orderMap.has(rw.saleOrderReadableCode)) {
        const order: any = orderMap.get(rw.saleOrderReadableCode);
        const lines = order?.lines || order?.lineSnapshots || [];
        const extLine = lines.find((l: any) => l.equipmentKind === "exterior" || /nano|shiny|fresh/i.test(l.displayNameEn || l.name || ""));
        if (extLine) {
          exteriorName = formatPlanName(extLine.displayNameEn || extLine.name);
          hasExterior = true;
        }
      }

      // 3. Fallback: if plan is recorded as interior_cleaning but customer had an exterior wash
      if (!exteriorName) {
        if (rawPlan.includes("interior")) {
          // At Rush Wash, every car wash visit's primary service is Exterior Wash
          exteriorName = "Exterior Wash";
          hasExterior = true;
          hasInterior = true;
        } else {
          exteriorName = formatPlanName(rawPlan);
        }
      }

      // Check if there is an existing visit within 2 hours
      const existingVisit = visits.find(
        (v) => Math.abs(v.washedAt.getTime() - washTime.getTime()) < 2 * 60 * 60 * 1000
      );

      if (existingVisit) {
        if (hasExterior) {
          existingVisit.hasExterior = true;
          existingVisit.primaryPlan = exteriorName;
        }
        if (hasInterior) {
          existingVisit.hasInterior = true;
        }
      } else {
        visits.push({
          id: rw.readableCode || `WASH-${String(rw._id).slice(-6).toUpperCase()}`,
          site: "RUSH Al Kharj",
          lane: rw.laneReadableCode || "Tunnel Lane 1",
          primaryPlan: exteriorName,
          hasExterior,
          hasInterior,
          washedAt: washTime,
        });
      }
    }

    return visits.slice(0, limit).map((v) => {
      let packageLabel = v.primaryPlan;
      if (v.hasInterior && !packageLabel.toLowerCase().includes("interior")) {
        packageLabel = `${packageLabel} + Interior Clean`;
      }
      return {
        id: v.id,
        site: v.site,
        lane: v.lane,
        packageName: packageLabel,
        washedAt: v.washedAt,
      };
    });
  } catch (err: any) {
    console.warn("[MongoDB Local Adapter] Error fetching washes:", err.message);
    return [];
  }
}

export async function getOrdersFromMongo(
  licensePlate: string,
  mongoCustomerId?: string,
  limit: number = 10
) {
  const database = await getDb();
  if (!database) return [];

  try {
    const normPl = normalizePlate(licensePlate);
    const orClauses: any[] = [
      { normalizedPlate: normPl },
      { "vehicleSnapshot.displayPlate": normPl },
      { normalizedPlate: new RegExp(`^${escapeRegex(normPl)}$`, "i") },
    ];

    if (mongoCustomerId && ObjectId.isValid(mongoCustomerId)) {
      orClauses.push({ customerId: new ObjectId(mongoCustomerId) });
    }

    // STRICTLY PAID ORDERS ONLY
    const query: any = {
      $and: [
        { status: "paid" },
        { $or: orClauses },
      ],
    };

    const orders = await database
      .collection("rushwash_sale_orders")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return orders.map((o: any) => {
      // Extract item names from lines or lineSnapshots
      const lines = o.lines || o.lineSnapshots || [];
      const itemNames = lines
        .map((l: any) => l.displayNameEn || l.name || l.description || l.productName)
        .filter(Boolean);

      const itemName = itemNames.length > 0 ? itemNames.join(" + ") : "POS Wash Service";
      const paymentMethod =
        (o.payments && o.payments[0]?.method) ||
        (o.payments && o.payments[0]?.source) ||
        "Mada";

      return {
        id: o.readableCode || `ORD-${String(o._id).slice(-5).toUpperCase()}`,
        site: "RUSH Al Kharj",
        itemName,
        amountSar: Number(o.postDiscountTotal ?? o.grandTotal ?? o.total ?? 0),
        paymentMethod,
        orderedAt: o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt || Date.now()),
      };
    });
  } catch (err: any) {
    console.warn("[MongoDB Local Adapter] Error fetching orders:", err.message);
    return [];
  }
}

export async function findPaidOrderCeilingInMongo(
  licensePlate: string,
  orderId: string
): Promise<number | null> {
  const orders = await getOrdersFromMongo(licensePlate, undefined, 25);
  const match = orders.find((o) => o.id === orderId);
  return match ? Number(match.amountSar) : null;
}

export async function closeMongoClient(): Promise<void> {
  if (client) {
    await client.close().catch(() => {});
    client = null;
    db = null;
  }
}

function formatPlanName(type: string): string {
  const map: Record<string, string> = {
    exterior_wash: "Exterior Wash",
    nano: "Nano Ceramic Wash",
    fresh: "Fresh Wash",
    shiny: "Shiny Wash",
    interior_cleaning: "Interior Clean",
  };
  return map[type.toLowerCase()] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
