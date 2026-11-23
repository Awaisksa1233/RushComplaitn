import dotenv from "dotenv";
dotenv.config();

import { PrismaClient, ComplaintType, TicketStatus, ResolutionStatus, StaffRole, MessageChannel } from "@prisma/client";

import { assertSafeToRunDestructive } from "./guard";

const prisma = new PrismaClient();

async function main() {
  assertSafeToRunDestructive("seed.ts");
  console.log("Seeding RUSH Customer Care Portal demo data into Supabase...");

  // Clean existing demo records
  await prisma.message.deleteMany();
  await prisma.complaint.deleteMany();
  await prisma.otpSession.deleteMany();
  await prisma.washVisit.deleteMany();
  await prisma.posOrder.deleteMany();
  await prisma.customer.deleteMany();

  // 1. Create Primary Demo Customer: Mohammed Al-Qahtani
  const customer1 = await prisma.customer.create({
    data: {
      name: "Mohammed Al-Qahtani",
      phone: "553914420",
      licensePlate: "8821KSA",
      vehicleModel: "Toyota Land Cruiser 2024",
      email: "m.alqahtani@example.com",
    },
  });

  // 2. Create Second Demo Customer: Fahad Al-Subaie
  const customer2 = await prisma.customer.create({
    data: {
      name: "Fahad Al-Subaie",
      phone: "501234567",
      licensePlate: "7412ZXR",
      vehicleModel: "Toyota Camry 2023",
      email: "f.subaie@example.com",
    },
  });

  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
  const twelveDaysAgo = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000);

  // 3. Create Wash Visits (2 within 7 days, 1 older)
  await prisma.washVisit.createMany({
    data: [
      {
        id: "POS-94102",
        customerId: customer1.id,
        site: "Al Kharj Main",
        lane: "Tunnel Lane 2",
        packageName: "Nano Ceramic + Interior Clean",
        washedAt: twoDaysAgo,
      },
      {
        id: "POS-93881",
        customerId: customer1.id,
        site: "Al Kharj Main",
        lane: "Express Lane 1",
        packageName: "Fresh Wash",
        washedAt: fourDaysAgo,
      },
      {
        id: "POS-91400",
        customerId: customer1.id,
        site: "Al Kharj Main",
        lane: "Tunnel Lane 1",
        packageName: "Shiny Wash",
        washedAt: twelveDaysAgo, // > 7 days ago
      },
      {
        id: "POS-94210",
        customerId: customer2.id,
        site: "Al Kharj Main",
        lane: "Tunnel Lane 2",
        packageName: "Fresh Wash",
        washedAt: twoDaysAgo,
      },
    ],
  });

  // 4. Create POS Orders for Billing / Refund
  await prisma.posOrder.createMany({
    data: [
      {
        id: "ORD-88241",
        customerId: customer1.id,
        site: "Al Kharj Main",
        itemName: "Annual Nano Subscription Renewal",
        amountSar: 189.0,
        paymentMethod: "Mada (•••• 4192)",
        orderedAt: twoDaysAgo,
      },
      {
        id: "ORD-87102",
        customerId: customer1.id,
        site: "Al Kharj Main",
        itemName: "Interior Deep Detail Package",
        amountSar: 120.0,
        paymentMethod: "Apple Pay",
        orderedAt: fourDaysAgo,
      },
    ],
  });

  // 5. Create Demo Complaints
  // Ticket C-1041: Unsatisfied & Approved with Rewash QR Code
  await prisma.complaint.create({
    data: {
      id: "C-1041",
      customerId: customer1.id,
      type: ComplaintType.UNSATISFIED,
      status: TicketStatus.RESOLVED,
      resolutionStatus: ResolutionStatus.APPROVED,
      resolutionNote: "Apology accepted. Complimentary rewash code issued.",
      assignedRole: StaffRole.ADMIN,
      site: "Al Kharj Main",
      posRecordId: "POS-93881",
      posRecordLabel: "Fresh Wash · Express Lane 1",
      summary: "Water spots remaining on front windshield and side mirrors.",
      qualityTags: ["Windshield Spots", "Side Mirrors"],
      rewashCode: "RW-8821",
      csatRating: 5,
      messages: {
        create: [
          {
            sender: "Customer",
            channel: MessageChannel.WEB_PORTAL,
            body: "Water spots remaining on front windshield and side mirrors.",
            createdAt: fourDaysAgo,
          },
          {
            sender: "Customer Care",
            channel: MessageChannel.WEB_PORTAL,
            body: "We apologize for the inconvenience! We have approved a complimentary rewash for your vehicle.",
            createdAt: twoDaysAgo,
          },
        ],
      },
    },
  });

  // Ticket C-1042: Damage with Step 1 Approved (Ready for Step 2 Tax Invoice + IBAN)
  await prisma.complaint.create({
    data: {
      id: "C-1042",
      customerId: customer1.id,
      type: ComplaintType.DAMAGE,
      status: TicketStatus.INVESTIGATING,
      resolutionStatus: ResolutionStatus.PENDING,
      assignedRole: StaffRole.OPS_MANAGER,
      site: "Al Kharj Main",
      posRecordId: "POS-94102",
      posRecordLabel: "Nano Ceramic · Tunnel Lane 2",
      summary: "Scratch detected along passenger side front door panel.",
      vehicleZones: ["Passenger Front Door"],
      quotationUrl: "https://rush.com.sa/samples/quotation_workshop_sample.pdf",
      waiverSigned: true,
      waiverSignature: "data:image/png;base64,sample_signature_data_url_here",
      quotationApproved: true, // Management approved quotation, now ready for tax invoice!
      messages: {
        create: [
          {
            sender: "Customer",
            channel: MessageChannel.WEB_PORTAL,
            body: "Scratch detected along passenger side front door panel after exiting the wash.",
            createdAt: twoDaysAgo,
          },
          {
            sender: "Operations Manager",
            channel: MessageChannel.WEB_PORTAL,
            body: "Your repair quotation has been reviewed and approved by management. Please proceed with repairs and upload your official tax invoice and Saudi IBAN.",
            createdAt: now,
          },
        ],
      },
    },
  });

  console.log("Seeding successfully completed!");
  console.log("Demo Credentials:");
  console.log("- License Plate: 8821KSA | Mobile: 0553914420 (Customer: Mohammed Al-Qahtani)");
  console.log("- Active Tickets: C-1041 (Resolved Unsatisfied), C-1042 (Approved Quotation Damage)");
  console.log("- License Plate: 7412ZXR | Mobile: 0501234567 (Customer: Fahad Al-Subaie)");
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
