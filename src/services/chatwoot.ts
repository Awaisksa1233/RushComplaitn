/**
 * RUSH Car Wash (رش واش) - Chatwoot Complaints & WhatsApp Integration
 * 
 * Synchronizes complaints with Chatwoot:
 * 1. Finds or creates Contact with license plate and branch metadata.
 * 2. Creates a Conversation in the WhatsApp Inbox (Inbox ID #1).
 * 3. Sends an automated Arabic WhatsApp confirmation with ticket ID and live tracking URL.
 * 4. Posts an internal private note with all damage/complaint details and R2 evidence links.
 * 5. Forwards customer messages from the web portal into Chatwoot.
 */

const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || "https://chatwoot.rush.com.sa").replace(/\/+$/, "");
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || "";
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "1";
const CHATWOOT_INBOX_ID = parseInt(process.env.CHATWOOT_INBOX_ID || "1", 10);
const PORTAL_PUBLIC_URL = (process.env.PUBLIC_PORTAL_URL || "https://crm.rush.com.sa").replace(/\/+$/, "");

function getHeaders() {
  return {
    "api_access_token": CHATWOOT_API_TOKEN,
    "Content-Type": "application/json",
    "User-Agent": "RUSH-Customer-Portal/1.0",
  };
}

export function formatChatwootPhone(phone: string): string {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("05") && digits.length === 10) {
    digits = "966" + digits.slice(1);
  } else if (digits.startsWith("5") && digits.length === 9) {
    digits = "966" + digits;
  }
  return `+${digits}`;
}

export async function findOrCreateContact(params: {
  phone: string;
  name?: string;
  licensePlate?: string;
  branch?: string;
}): Promise<any> {
  const formattedPhone = formatChatwootPhone(params.phone);
  if (!formattedPhone || !CHATWOOT_API_TOKEN) return null;

  try {
    // 1. Search existing contact
    const searchUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(formattedPhone)}`;
    const searchRes = await fetch(searchUrl, { headers: getHeaders() });
    if (searchRes.ok) {
      const data: any = await searchRes.json();
      const existing = data.payload?.[0];
      if (existing) {
        // Update custom attributes with latest plate and branch
        try {
          await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${existing.id}`, {
            method: "PUT",
            headers: getHeaders(),
            body: JSON.stringify({
              custom_attributes: {
                vehicle_plate: params.licensePlate || existing.custom_attributes?.vehicle_plate || "",
                branch: params.branch || "Al Kharj",
              },
            }),
          });
        } catch {}
        return existing;
      }
    }

    // 2. Create contact if not found
    const createUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`;
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        inbox_id: CHATWOOT_INBOX_ID,
        name: params.name || `عميل ${params.licensePlate || formattedPhone}`,
        phone_number: formattedPhone,
        custom_attributes: {
          vehicle_plate: params.licensePlate || "",
          branch: params.branch || "Al Kharj",
        },
      }),
    });

    if (createRes.ok) {
      const created: any = await createRes.json();
      return created.payload?.contact || created;
    }
  } catch (err: any) {
    console.warn("[Chatwoot] findOrCreateContact error:", err?.message || err);
  }
  return null;
}

export async function createComplaintConversation(params: {
  contactId: number;
  ticketId: string;
  issueType: string;
}): Promise<any> {
  try {
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`;
    const res = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        inbox_id: CHATWOOT_INBOX_ID,
        contact_id: params.contactId,
        custom_attributes: {
          ticket_code: params.ticketId,
          issue_type: params.issueType,
        },
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err: any) {
    console.warn("[Chatwoot] createComplaintConversation error:", err?.message || err);
  }
  return null;
}

export async function sendWhatsAppConfirmation(params: {
  conversationId: number;
  ticketId: string;
  licensePlate: string;
  trackingUrl: string;
}): Promise<boolean> {
  const messageText = `مرحباً بك في *رش واش* 🚗\nتم استلام بلاغكم بنجاح برقم: *#${params.ticketId}*\nبخصوص المركبة (لوحة: *${params.licensePlate}*).\n\nفريق خدمة العملاء ومشرف الفرع يقومون حالياً بفحص تفاصيل البلاغ ومراجعة كاميرات النفق بدقة.\n\nيمكنكم متابعة حالة البلاغ لحظياً عبر الرابط:\n🔗 ${params.trackingUrl}\n\nإذا كان لديكم أي تفاصيل إضافية أو صور، يمكنكم الرد مباشرة على هذه المحادثة.`;

  try {
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${params.conversationId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        content: messageText,
        message_type: "outgoing",
        private: false,
      }),
    });
    return res.ok;
  } catch (err: any) {
    console.warn("[Chatwoot] sendWhatsAppConfirmation error:", err?.message || err);
    return false;
  }
}

export async function postPrivateStaffNote(params: {
  conversationId: number;
  ticket: any;
}): Promise<boolean> {
  const t = params.ticket;
  const zonesText = Array.isArray(t.vehicleZones) && t.vehicleZones.length
    ? t.vehicleZones.join(", ")
    : "غير محدد";

  let evidenceText = "لا توجد مرفقات";
  if (Array.isArray(t.mediaUrls) && t.mediaUrls.length) {
    evidenceText = t.mediaUrls.map((u: string, idx: number) => `  ${idx + 1}. [مرفق ${idx + 1}](${u})`).join("\n");
  }

  const noteContent = `📋 **تفاصيل بلاغ جديد من العميل (#${t.id})**\n------------------------------------------------\n- **الفرع:** فرع الخرج (${t.site || "Al Kharj"})\n- **المركبة:** ${t.customer?.vehicleModel || "—"} (لوحة: ${t.customer?.licensePlate || "—"})\n- **جوال العميل:** ${t.customer?.phone || "—"}\n- **نوع البلاغ:** ${t.type}\n- **الزيارة / الفاتورة:** ${t.posRecordLabel || t.posRecordId || "—"}\n- **الأجزاء المتضررة (Zones):** ${zonesText}\n- **شرح المشكلة:** ${t.summary || "لا يوجد"}\n\n📎 **مرفقات وصور المعاينة:**\n${evidenceText}\n\n🔗 [عرض ومتابعة البلاغ في لوحة الإدارة](${PORTAL_PUBLIC_URL}/admin)`;

  try {
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${params.conversationId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        content: noteContent,
        message_type: "outgoing",
        private: true,
      }),
    });
    return res.ok;
  } catch (err: any) {
    console.warn("[Chatwoot] postPrivateStaffNote error:", err?.message || err);
    return false;
  }
}

export async function forwardCustomerMessageToChatwoot(params: {
  ticketId: string;
  phone: string;
  text: string;
}): Promise<boolean> {
  if (!CHATWOOT_API_TOKEN) return false;
  try {
    const contact = await findOrCreateContact({ phone: params.phone });
    if (!contact?.id) return false;

    // Search conversation for this contact
    const convsUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${contact.id}/conversations`;
    const res = await fetch(convsUrl, { headers: getHeaders() });
    if (!res.ok) return false;
    const data: any = await res.json();
    const conv = (data.payload || [])[0];
    if (!conv?.id) return false;

    const msgUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conv.id}/messages`;
    const msgRes = await fetch(msgUrl, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        content: params.text,
        message_type: "incoming",
        private: false,
      }),
    });
    return msgRes.ok;
  } catch (err: any) {
    console.warn("[Chatwoot] forwardCustomerMessageToChatwoot error:", err?.message || err);
    return false;
  }
}

/**
 * High-level background task: Orchestrates full Chatwoot dispatch upon new complaint submission
 */
export async function syncComplaintToChatwoot(ticket: any): Promise<void> {
  if (!CHATWOOT_API_TOKEN) return;
  try {
    const phone = ticket.customer?.phone;
    if (!phone) return;

    const contact = await findOrCreateContact({
      phone,
      name: ticket.customer?.name,
      licensePlate: ticket.customer?.licensePlate,
      branch: ticket.site || "Al Kharj",
    });

    if (!contact?.id) return;

    const conv = await createComplaintConversation({
      contactId: contact.id,
      ticketId: ticket.id,
      issueType: ticket.type,
    });

    const conversationId = conv?.id || conv?.payload?.id;
    if (!conversationId) return;

    const trackingUrl = `${PORTAL_PUBLIC_URL}/?ticket=${ticket.id}&phone=${phone}`;

    // Send confirmation to customer via WhatsApp
    await sendWhatsAppConfirmation({
      conversationId,
      ticketId: ticket.id,
      licensePlate: ticket.customer?.licensePlate || "",
      trackingUrl,
    });

    // Post internal staff note for agents
    await postPrivateStaffNote({
      conversationId,
      ticket,
    });

    console.log(`[Chatwoot] Successfully synced complaint #${ticket.id} to conversation #${conversationId}`);
  } catch (err: any) {
    console.warn(`[Chatwoot] syncComplaintToChatwoot failed for #${ticket.id}:`, err?.message || err);
  }
}
