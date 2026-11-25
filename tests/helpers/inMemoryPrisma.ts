import crypto from "crypto";
import {
  Prisma,
  ComplaintType,
  TicketStatus,
  ResolutionStatus,
  PayoutStatus,
  StaffRole,
  MessageChannel,
} from "@prisma/client";
import { createApp } from "../../src/server";

function newCuid() {
  return "cmem" + crypto.randomBytes(10).toString("hex");
}

function uniqueErr(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target.join(",")}`, {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target },
  });
}

function clone<T>(v: T): T {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return new Date(v.getTime()) as any;
  if (Array.isArray(v)) return v.map(clone) as any;
  if (typeof v === "object") {
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = clone((v as any)[k]);
    return out;
  }
  return v;
}

export class InMemoryPrismaClient {
  public systemConfigs: any[] = [
    {
      id: "default",
      damageApprovalCapSar: 200,
      maxSlaHours: 48,
      companyName: "شركة رَش للتجارة المتقدمة",
      vatNumber: "311949083200003",
      crNumber: "1011154912",
      unifiedNationalNumber: "7037475576",
      whatsappNumber: "966503444958",
      updatedAt: new Date(),
    },
  ];
  public staffUsers: any[] = [];
  public customers: any[] = [];
  public washVisits: any[] = [];
  public posOrders: any[] = [];
  public otpSessions: any[] = [];
  public complaints: any[] = [];
  public messages: any[] = [];
  public auditLogs: any[] = [];

  private matchCondition(row: any, where: any, table?: string): boolean {
    if (!where) return true;
    for (const key of Object.keys(where)) {
      const cond = where[key];
      if (cond === undefined) continue;
      if (key === "OR" && Array.isArray(cond)) {
        if (!cond.some((sub) => this.matchCondition(row, sub, table))) return false;
        continue;
      }
      if (key === "AND" && Array.isArray(cond)) {
        if (!cond.every((sub) => this.matchCondition(row, sub, table))) return false;
        continue;
      }
      if (key === "customer" && table === "complaint") {
        const cust = this.customers.find((c) => c.id === row.customerId);
        if (!cust || !this.matchCondition(cust, cond, "customer")) return false;
        continue;
      }
      if (key === "licensePlate_phone" && table === "customer") {
        if (row.licensePlate !== cond.licensePlate || row.phone !== cond.phone) return false;
        continue;
      }

      const val = row[key];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        if ("in" in cond && Array.isArray(cond.in)) {
          if (!cond.in.includes(val)) return false;
        }
        if ("notIn" in cond && Array.isArray(cond.notIn)) {
          if (cond.notIn.includes(val)) return false;
        }
        if ("not" in cond) {
          if (cond.not === null) {
            if (val === null || val === undefined) return false;
          } else if (val === cond.not) {
            return false;
          }
        }
        if ("gt" in cond) {
          const t = cond.gt instanceof Date ? cond.gt.getTime() : cond.gt;
          const v = val instanceof Date ? val.getTime() : val;
          if (!(v > t)) return false;
        }
        if ("gte" in cond) {
          const t = cond.gte instanceof Date ? cond.gte.getTime() : cond.gte;
          const v = val instanceof Date ? val.getTime() : val;
          if (!(v >= t)) return false;
        }
        if ("lt" in cond) {
          const t = cond.lt instanceof Date ? cond.lt.getTime() : cond.lt;
          const v = val instanceof Date ? val.getTime() : val;
          if (!(v < t)) return false;
        }
        if ("startsWith" in cond) {
          if (typeof val !== "string" || !val.startsWith(cond.startsWith)) return false;
        }
        if ("contains" in cond) {
          const needle = String(cond.contains);
          const hay = String(val ?? "");
          if (cond.mode === "insensitive") {
            if (!hay.toLowerCase().includes(needle.toLowerCase())) return false;
          } else if (!hay.includes(needle)) {
            return false;
          }
        }
        if ("equals" in cond) {
          const a = String(val ?? "");
          const b = String(cond.equals ?? "");
          if (cond.mode === "insensitive") {
            if (a.toLowerCase() !== b.toLowerCase()) return false;
          } else if (val !== cond.equals) {
            return false;
          }
        }
        if ("has" in cond) {
          if (!Array.isArray(val) || !val.includes(cond.has)) return false;
        }
      } else {
        if (cond === null ? val != null : val !== cond) return false;
      }
    }
    return true;
  }

  private sortRows(rows: any[], orderBy?: any): any[] {
    if (!orderBy) return rows;
    const field = Object.keys(orderBy)[0];
    const dir = orderBy[field] === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const av = a[field] instanceof Date ? a[field].getTime() : a[field];
      const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  private project(row: any, select?: any, include?: any, table?: string): any {
    if (!row) return null;
    const out = clone(row);
    if (include) {
      if (table === "complaint") {
        if (include.customer) {
          const c = this.customers.find((x) => x.id === row.customerId) || null;
          out.customer = c ? this.project(c, include.customer?.select) : null;
        }
        if (include.messages) {
          let msgs = this.messages.filter((m) => m.complaintId === row.id);
          if (include.messages.where) msgs = msgs.filter((m) => this.matchCondition(m, include.messages.where));
          if (include.messages.orderBy) msgs = this.sortRows(msgs, include.messages.orderBy);
          out.messages = clone(msgs);
        }
        if (include.auditLogs) {
          let logs = this.auditLogs.filter((a) => a.complaintId === row.id);
          if (include.auditLogs.orderBy) logs = this.sortRows(logs, include.auditLogs.orderBy);
          out.auditLogs = clone(logs);
        }
      } else if (table === "customer") {
        if (include.washes) out.washes = clone(this.washVisits.filter((w) => w.customerId === row.id));
        if (include.orders) out.orders = clone(this.posOrders.filter((o) => o.customerId === row.id));
        if (include.complaints) {
          const cs = this.complaints.filter((c) => c.customerId === row.id);
          out.complaints = cs.map((c) => this.project(c, undefined, include.complaints.include, "complaint"));
        }
      }
    }
    if (select) {
      const picked: any = {};
      for (const k of Object.keys(select)) {
        if (select[k]) picked[k] = out[k];
      }
      return picked;
    }
    return out;
  }

  async $queryRaw() {
    return [{ "?column?": 1 }];
  }
  async $disconnect() {}

  systemConfig = {
    findUnique: async ({ where }: any) => clone(this.systemConfigs.find((x) => x.id === where.id) || null),
    create: async ({ data }: any) => {
      const row = { id: "default", damageApprovalCapSar: 200, maxSlaHours: 48, companyName: "شركة رَش للتجارة المتقدمة", vatNumber: "311949083200003", crNumber: "1011154912", unifiedNationalNumber: "7037475576", whatsappNumber: "966503444958", updatedAt: new Date(), ...data };
      this.systemConfigs.push(row);
      return clone(row);
    },
    update: async ({ where, data }: any) => {
      const idx = this.systemConfigs.findIndex((x) => x.id === where.id);
      if (idx < 0) throw new Error("Not found");
      this.systemConfigs[idx] = { ...this.systemConfigs[idx], ...data, updatedAt: new Date() };
      return clone(this.systemConfigs[idx]);
    },
  };

  staffUser = {
    findFirst: async ({ where }: any) => clone(this.staffUsers.find((u) => this.matchCondition(u, where)) || null),
    findUnique: async ({ where, select }: any) => {
      const row = this.staffUsers.find((u) => (where.id ? u.id === where.id : u.email === where.email));
      return this.project(row, select);
    },
    findMany: async ({ where, orderBy, select }: any = {}) => {
      let rows = this.staffUsers.filter((u) => this.matchCondition(u, where));
      rows = this.sortRows(rows, orderBy);
      return rows.map((r) => this.project(r, select));
    },
    count: async ({ where }: any = {}) => this.staffUsers.filter((u) => this.matchCondition(u, where)).length,
    create: async ({ data, select }: any) => {
      if (this.staffUsers.some((u) => u.email.toLowerCase() === data.email.toLowerCase())) throw uniqueErr(["email"]);
      const row = { id: newCuid(), branch: "All Branches", active: true, signatureUrl: null, phone: null, createdAt: new Date(), ...data };
      this.staffUsers.push(row);
      return this.project(row, select);
    },
    update: async ({ where, data, select }: any) => {
      const idx = this.staffUsers.findIndex((u) => u.id === where.id);
      if (idx < 0) throw new Error("Staff not found");
      this.staffUsers[idx] = { ...this.staffUsers[idx], ...data };
      return this.project(this.staffUsers[idx], select);
    },
  };

  customer = {
    findFirst: async ({ where }: any) => clone(this.customers.find((c) => this.matchCondition(c, where, "customer")) || null),
    findUnique: async ({ where, select, include }: any) => {
      const row = this.customers.find((c) => (where.id ? c.id === where.id : c.licensePlate === where.licensePlate_phone?.licensePlate && c.phone === where.licensePlate_phone?.phone));
      return this.project(row, select, include, "customer");
    },
    upsert: async ({ where, update, create }: any) => {
      const lp = where.licensePlate_phone;
      const idx = this.customers.findIndex((c) => c.licensePlate === lp.licensePlate && c.phone === lp.phone);
      if (idx >= 0) {
        this.customers[idx] = { ...this.customers[idx], ...update };
        return clone(this.customers[idx]);
      }
      const row = { id: newCuid(), email: null, createdAt: new Date(), ...create };
      this.customers.push(row);
      return clone(row);
    },
    update: async ({ where, data }: any) => {
      const idx = this.customers.findIndex((c) => c.id === where.id);
      if (idx < 0) throw new Error("Customer not found");
      this.customers[idx] = { ...this.customers[idx], ...data };
      return clone(this.customers[idx]);
    },
  };

  washVisit = {
    findFirst: async ({ where, select }: any) => {
      const row = this.washVisits.find((w) => this.matchCondition(w, where));
      return this.project(row, select);
    },
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let rows = this.washVisits.filter((w) => this.matchCondition(w, where));
      rows = this.sortRows(rows, orderBy);
      if (take) rows = rows.slice(0, take);
      return clone(rows);
    },
  };

  posOrder = {
    findFirst: async ({ where, select }: any) => {
      const row = this.posOrders.find((o) => this.matchCondition(o, where));
      return this.project(row, select);
    },
    findUnique: async ({ where }: any) => clone(this.posOrders.find((o) => o.id === where.id) || null),
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let rows = this.posOrders.filter((o) => this.matchCondition(o, where));
      rows = this.sortRows(rows, orderBy);
      if (take) rows = rows.slice(0, take);
      return clone(rows);
    },
  };

  otpSession = {
    count: async ({ where }: any = {}) => this.otpSessions.filter((s) => this.matchCondition(s, where)).length,
    findMany: async ({ where, select }: any = {}) => {
      const rows = this.otpSessions.filter((s) => this.matchCondition(s, where));
      return rows.map((r) => this.project(r, select));
    },
    findFirst: async ({ where, orderBy }: any) => {
      let rows = this.otpSessions.filter((s) => this.matchCondition(s, where));
      rows = this.sortRows(rows, orderBy);
      return clone(rows[0] || null);
    },
    create: async ({ data }: any) => {
      const row = { id: newCuid(), attempts: 0, verified: false, createdAt: new Date(), ...data };
      this.otpSessions.push(row);
      return clone(row);
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const s of this.otpSessions) {
        if (this.matchCondition(s, where)) {
          for (const k of Object.keys(data)) {
            if (data[k] && typeof data[k] === "object" && "increment" in data[k]) {
              s[k] = (s[k] || 0) + data[k].increment;
            } else {
              s[k] = data[k];
            }
          }
          count++;
        }
      }
      return { count };
    },
    deleteMany: async ({ where }: any = {}) => {
      const before = this.otpSessions.length;
      this.otpSessions = this.otpSessions.filter((s) => !this.matchCondition(s, where));
      return { count: before - this.otpSessions.length };
    },
  };

  complaint = {
    count: async ({ where }: any = {}) => this.complaints.filter((c) => this.matchCondition(c, where, "complaint")).length,
    findUnique: async ({ where, include }: any) => {
      const row = this.complaints.find((c) => c.id === where.id);
      return this.project(row, undefined, include, "complaint");
    },
    findFirst: async ({ where, orderBy }: any) => {
      let rows = this.complaints.filter((c) => this.matchCondition(c, where, "complaint"));
      rows = this.sortRows(rows, orderBy);
      return clone(rows[0] || null);
    },
    findMany: async ({ where, include, select, orderBy, take, skip }: any = {}) => {
      let rows = this.complaints.filter((c) => this.matchCondition(c, where, "complaint"));
      rows = this.sortRows(rows, orderBy);
      if (skip) rows = rows.slice(skip);
      if (take) rows = rows.slice(0, take);
      return rows.map((r) => this.project(r, select, include, "complaint"));
    },
    create: async ({ data, include }: any) => {
      if (this.complaints.some((c) => c.id === data.id)) throw uniqueErr(["id"]);
      if (data.rewashCode && this.complaints.some((c) => c.rewashCode === data.rewashCode)) throw uniqueErr(["rewashCode"]);
      if (data.rrn && this.complaints.some((c) => c.rrn === data.rrn)) throw uniqueErr(["rrn"]);
      const special = ["ORD-UNLISTED", "VISIT-GENERAL", "VISIT-UNLISTED"];
      if (!special.includes(data.posRecordId) && this.complaints.some((c) => c.customerId === data.customerId && c.posRecordId === data.posRecordId)) {
        throw uniqueErr(["customerId", "posRecordId"]);
      }
      const { messages, auditLogs, ...scalar } = data;
      const row = {
        status: TicketStatus.SUBMITTED,
        resolutionStatus: ResolutionStatus.PENDING,
        payoutStatus: PayoutStatus.PENDING_REVIEW,
        callbackWindow: "Anytime",
        qualityTags: [],
        vehicleZones: [],
        mediaUrls: [],
        waiverSigned: false,
        quotationApproved: false,
        slaBreached: false,
        slaBreachedNotified: false,
        iban: null,
        accountHolder: null,
        bankName: null,
        rrn: null,
        rewashCode: null,
        csatRating: null,
        invoiceUrl: null,
        quotationUrl: null,
        bankSmsUrl: null,
        waiverSignature: null,
        approvedAmount: null,
        requestedAmount: null,
        quotedAmount: null,
        invoiceTotalSar: null,
        transferRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...scalar,
      };
      this.complaints.push(row);
      if (messages?.create) {
        const list = Array.isArray(messages.create) ? messages.create : [messages.create];
        for (const m of list) {
          this.messages.push({ id: newCuid(), complaintId: row.id, createdAt: new Date(), ...m });
        }
      }
      if (auditLogs?.create) {
        const list = Array.isArray(auditLogs.create) ? auditLogs.create : [auditLogs.create];
        for (const a of list) {
          this.auditLogs.push({ id: newCuid(), complaintId: row.id, createdAt: new Date(), ...a });
        }
      }
      return this.project(row, undefined, include, "complaint");
    },
    update: async ({ where, data, include }: any) => {
      const idx = this.complaints.findIndex((c) => c.id === where.id);
      if (idx < 0) throw new Error("Complaint not found");
      if (data.rewashCode && this.complaints.some((c, i) => i !== idx && c.rewashCode === data.rewashCode)) {
        throw uniqueErr(["rewashCode"]);
      }
      const { messages, auditLogs, ...scalar } = data;
      this.complaints[idx] = { ...this.complaints[idx], ...scalar, updatedAt: new Date() };
      if (messages?.create) {
        const list = Array.isArray(messages.create) ? messages.create : [messages.create];
        for (const m of list) {
          this.messages.push({ id: newCuid(), complaintId: where.id, createdAt: new Date(), ...m });
        }
      }
      if (auditLogs?.create) {
        const list = Array.isArray(auditLogs.create) ? auditLogs.create : [auditLogs.create];
        for (const a of list) {
          this.auditLogs.push({ id: newCuid(), complaintId: where.id, createdAt: new Date(), ...a });
        }
      }
      return this.project(this.complaints[idx], undefined, include, "complaint");
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (let i = 0; i < this.complaints.length; i++) {
        if (this.matchCondition(this.complaints[i], where, "complaint")) {
          if (data.rrn && this.complaints.some((c, j) => j !== i && c.rrn === data.rrn)) {
            throw uniqueErr(["rrn"]);
          }
          if (data.rewashCode && this.complaints.some((c, j) => j !== i && c.rewashCode === data.rewashCode)) {
            throw uniqueErr(["rewashCode"]);
          }
          this.complaints[i] = { ...this.complaints[i], ...data, updatedAt: new Date() };
          count++;
        }
      }
      return { count };
    },
  };

  message = {
    findFirst: async ({ where }: any) => clone(this.messages.find((m) => this.matchCondition(m, where)) || null),
    findMany: async ({ where }: any = {}) => clone(this.messages.filter((m) => this.matchCondition(m, where))),
    create: async ({ data }: any) => {
      if (data.externalId && this.messages.some((m) => m.externalId === data.externalId)) {
        throw uniqueErr(["externalId"]);
      }
      const row = { id: newCuid(), createdAt: new Date(), ...data };
      this.messages.push(row);
      return clone(row);
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (let i = 0; i < this.messages.length; i++) {
        if (this.matchCondition(this.messages[i], where)) {
          this.messages[i] = { ...this.messages[i], ...data };
          count++;
        }
      }
      return { count };
    },
    deleteMany: async ({ where }: any = {}) => {
      const before = this.messages.length;
      this.messages = this.messages.filter((m) => !this.matchCondition(m, where));
      return { count: before - this.messages.length };
    },
  };

  auditLog = {
    create: async ({ data }: any) => {
      const row = { id: newCuid(), createdAt: new Date(), ...data };
      this.auditLogs.push(row);
      return clone(row);
    },
    findMany: async ({ where }: any = {}) => clone(this.auditLogs.filter((a) => this.matchCondition(a, where))),
  };
}

export function createIsolatedApp(memPrisma: InMemoryPrismaClient) {
  return createApp(memPrisma as any);
}
