-- CreateEnum
CREATE TYPE "ComplaintType" AS ENUM ('UNSATISFIED', 'BILLING_REFUND', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('SUBMITTED', 'INVESTIGATING', 'PENDING_PAYOUT', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('PENDING', 'APPROVED', 'REFUSED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING_REVIEW', 'AWAITING_QUOTE_APPROVAL', 'AWAITING_INVOICE_IBAN', 'PENDING_BANK_TRANSFER', 'PAID', 'PAID_RRN', 'REWASH_ISSUED', 'DECLINED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('BUSINESS_OWNER', 'ADMIN', 'OPS_MANAGER', 'CSM', 'FINANCE');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WEB_PORTAL', 'WHATSAPP', 'SMS', 'EMAIL', 'INTERNAL');

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "damageApprovalCapSar" DECIMAL(10,2) NOT NULL DEFAULT 200.00,
    "maxSlaHours" INTEGER NOT NULL DEFAULT 48,
    "companyName" TEXT NOT NULL DEFAULT 'شركة رَش للتجارة المتقدمة',
    "vatNumber" TEXT NOT NULL DEFAULT '311949083200003',
    "crNumber" TEXT NOT NULL DEFAULT '1011154912',
    "unifiedNationalNumber" TEXT NOT NULL DEFAULT '7037475576',
    "whatsappNumber" TEXT NOT NULL DEFAULT '966503444958',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "role" "StaffRole" NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'All Branches',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "signatureUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT,
    "staffId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "licensePlate" TEXT NOT NULL,
    "vehicleModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WashVisit" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "washedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WashVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "amountSar" DECIMAL(10,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpSession" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "ComplaintType" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'SUBMITTED',
    "resolutionStatus" "ResolutionStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionNote" TEXT,
    "assignedRole" "StaffRole" NOT NULL,
    "assignedStaffName" TEXT,
    "site" TEXT NOT NULL,
    "posRecordId" TEXT NOT NULL,
    "posRecordLabel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "callbackWindow" TEXT NOT NULL DEFAULT 'Anytime',
    "qualityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vehicleZones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "billingReason" TEXT,
    "requestedAmount" DECIMAL(10,2),
    "approvedAmount" DECIMAL(10,2),
    "cardLast4" TEXT,
    "bankSmsText" TEXT,
    "bankSmsUrl" TEXT,
    "rewashCode" TEXT,
    "rrn" TEXT,
    "quotedAmount" DECIMAL(10,2),
    "quotationUrl" TEXT,
    "waiverSigned" BOOLEAN NOT NULL DEFAULT false,
    "waiverSignature" TEXT,
    "quotationApproved" BOOLEAN NOT NULL DEFAULT false,
    "invoiceUrl" TEXT,
    "bankName" TEXT,
    "accountHolder" TEXT,
    "iban" TEXT,
    "techSignatureUrl" TEXT,
    "techSignedBy" TEXT,
    "opsSignatureUrl" TEXT,
    "opsSignedBy" TEXT,
    "financeSignatureUrl" TEXT,
    "financeSignedBy" TEXT,
    "initialAssessment" TEXT,
    "vehicleColor" TEXT,
    "wafeqJournalNo" TEXT,
    "workshopName" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TEXT,
    "invoiceIssuedTo" TEXT,
    "invoiceTotalSar" DECIMAL(10,2),
    "invoiceVatSar" DECIMAL(10,2),
    "invoiceItems" TEXT,
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "transferRef" TEXT,
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "slaBreachedNotified" BOOLEAN NOT NULL DEFAULT false,
    "csatRating" INTEGER,
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE INDEX "AuditLog_complaintId_createdAt_idx" ON "AuditLog"("complaintId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_licensePlate_phone_key" ON "Customer"("licensePlate", "phone");

-- CreateIndex
CREATE INDEX "WashVisit_customerId_washedAt_idx" ON "WashVisit"("customerId", "washedAt");

-- CreateIndex
CREATE INDEX "PosOrder_customerId_orderedAt_idx" ON "PosOrder"("customerId", "orderedAt");

-- CreateIndex
CREATE INDEX "OtpSession_phone_licensePlate_idx" ON "OtpSession"("phone", "licensePlate");

-- CreateIndex
CREATE INDEX "OtpSession_createdAt_idx" ON "OtpSession"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_rewashCode_key" ON "Complaint"("rewashCode");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_rrn_key" ON "Complaint"("rrn");

-- CreateIndex
CREATE INDEX "Complaint_customerId_idx" ON "Complaint"("customerId");

-- CreateIndex
CREATE INDEX "Complaint_posRecordId_idx" ON "Complaint"("posRecordId");

-- CreateIndex
CREATE INDEX "Complaint_customerId_posRecordId_idx" ON "Complaint"("customerId", "posRecordId");

-- CreateIndex
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_site_status_createdAt_idx" ON "Complaint"("site", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_payoutStatus_updatedAt_idx" ON "Complaint"("payoutStatus", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_externalId_key" ON "Message"("externalId");

-- CreateIndex
CREATE INDEX "Message_complaintId_createdAt_idx" ON "Message"("complaintId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WashVisit" ADD CONSTRAINT "WashVisit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index preventing concurrent duplicate listed complaints (REM-007)
CREATE UNIQUE INDEX IF NOT EXISTS "Complaint_customerId_listed_posRecordId_key" ON "Complaint"("customerId", "posRecordId") WHERE "posRecordId" NOT IN ('ORD-UNLISTED', 'VISIT-GENERAL', 'VISIT-UNLISTED');

-- Enable PostgreSQL Row-Level Security (RLS) on all public tables
-- Prevents PostgREST (anon / authenticated) from reading or mutating CRM data directly.
-- The Express backend connects via the privileged Prisma role, which bypasses RLS safely.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'SystemConfig',
    'StaffUser',
    'AuditLog',
    'Customer',
    'WashVisit',
    'PosOrder',
    'OtpSession',
    'Complaint',
    'Message',
    '_prisma_migrations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon;', t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated;', t);
      END IF;
    END IF;
  END LOOP;
END $$;
