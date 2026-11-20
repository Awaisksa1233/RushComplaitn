/**
 * RUSH Car Wash (رش واش) - Chatwoot Complaints WhatsApp Integration
 * 
 * Automates 2-way WhatsApp communication:
 * 1. Synchronizes contact with plate & branch attributes.
 * 2. Creates a conversation in WhatsApp Inbox (Inbox ID #1).
 * 3. Sends customer an automated Arabic WhatsApp confirmation with ticket # and tracking URL.
 * 4. Posts an internal private note with full damage details, wash reference, and R2 evidence links.
 */

import 'dotenv/config';

const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL || 'https://chatwoot.rush.com.sa';
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || '';
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '1';
const CHATWOOT_INBOX_ID = parseInt(process.env.CHATWOOT_INBOX_ID || '1', 10);
const APP_PUBLIC_URL = process.env.PUBLIC_APP_URL || 'https://whatsapp.rush.com.sa';

if (!CHATWOOT_API_TOKEN) {
  console.warn('[Chatwoot Complaints] CHATWOOT_API_TOKEN is not set; Chatwoot dispatch is disabled');
}

function getHeaders() {
  return {
    'api_access_token': CHATWOOT_API_TOKEN,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RUSH-Complaints/1.0'
  };
}

/**
 * Ensures phone number has +966 international prefix
 */
export function formatChatwootPhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('05') && digits.length === 10) {
    digits = '966' + digits.slice(1);
  } else if (digits.startsWith('5') && digits.length === 9) {
    digits = '966' + digits;
  }
  return `+${digits}`;
}

/**
 * Search or create contact in Chatwoot
 */
export async function findOrCreateContact({ phone, name, plate, branch = 'Al Kharj' }) {
  const formattedPhone = formatChatwootPhone(phone);
  if (!formattedPhone) return null;

  try {
    // 1. Search existing contact
    const searchUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(formattedPhone)}`;
    const searchRes = await fetch(searchUrl, { headers: getHeaders() });
    if (searchRes.ok) {
      const data = await searchRes.json();
      const existing = data.payload?.[0];
      if (existing) {
        // Update custom attributes with latest plate and branch
        try {
          await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${existing.id}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({
              custom_attributes: {
                vehicle_plate: plate || existing.custom_attributes?.vehicle_plate || '',
                branch: branch || 'Al Kharj'
              }
            })
          });
        } catch (e) {
          // ignore update errors
        }
        return existing;
      }
    }

    // 2. Create contact if not found
    const createUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        inbox_id: CHATWOOT_INBOX_ID,
        name: name || `عميل ${plate || formattedPhone}`,
        phone_number: formattedPhone,
        custom_attributes: {
          vehicle_plate: plate || '',
          branch: branch || 'Al Kharj'
        }
      })
    });

    if (createRes.ok) {
      const created = await createRes.json();
      return created.payload?.contact || created;
    }
  } catch (err) {
    console.error('[Chatwoot Complaints] findOrCreateContact error:', err.message);
  }
  return null;
}

/**
 * Creates a conversation in WhatsApp Inbox
 */
export async function createComplaintConversation({ contactId, sourceId, ticketCode }) {
  try {
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`;
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        inbox_id: CHATWOOT_INBOX_ID,
        contact_id: contactId,
        source_id: sourceId,
        custom_attributes: {
          ticket_code: ticketCode,
          issue_type: 'customer_complaint'
        }
      })
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    } else {
      const errText = await res.text();
      console.warn('[Chatwoot Complaints] Conversation create warning:', errText);
    }
  } catch (err) {
    console.error('[Chatwoot Complaints] createComplaintConversation error:', err.message);
  }
  return null;
}

/**
 * Sends outbound automated WhatsApp confirmation message to customer
 */
export async function sendWhatsAppConfirmation({ conversationId, ticketCode, plate, trackingUrl, customerName }) {
  if (!conversationId) return false;

  const messageText = `مرحباً بك في *رش واش* 🚗
تم استلام بلاغكم بنجاح برقم: *#${ticketCode}*
بخصوص المركبة (لوحة: *${plate}*).

فريق خدمة العملاء ومشرف الفرع يقومون حالياً بفحص تفاصيل البلاغ ومراجعة كاميرات النفق بدقة.

يمكنكم متابعة حالة البلاغ لحظياً عبر الرابط:
🔗 ${trackingUrl}

إذا كان لديكم أي تفاصيل إضافية أو صور، يمكنكم الرد مباشرة على هذه المحادثة.`;

  try {
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        content: messageText,
        message_type: 'outgoing',
        private: false
      })
    });
    return res.ok;
  } catch (err) {
    console.error('[Chatwoot Complaints] sendWhatsAppConfirmation error:', err.message);
    return false;
  }
}

/**
 * Posts private internal staff note with complete incident and evidence links
 */
export async function postPrivateStaffNote({ conversationId, complaint, evidenceList = [] }) {
  if (!conversationId) return false;

  const categoryNames = {
    damage: 'مركبة متضررة (Vehicle Damage)',
    quality: 'جودة الغسيل (Wash Quality)',
    billing: 'مشاكل اشتراك ومبالغ (Billing / Refund)',
    delay: 'تأخير بالخدمة (Service Delay)',
    staff: 'تعامل موظفين / أمن وسلامة (Staff & Safety)'
  };

  const partsText = Array.isArray(complaint.affectedParts)
    ? complaint.affectedParts.join(', ')
    : complaint.affectedParts || 'غير محدد';

  let evidenceSection = 'لا توجد مرفقات';
  if (evidenceList.length > 0) {
    evidenceSection = evidenceList.map((e, idx) => `  ${idx + 1}. [${e.fileName || 'ملف مرفق'}](${e.r2Url}) (${e.fileType})`).join('\n');
  }

  const noteContent = `📋 **تفاصيل بلاغ جديد من العميل (#${complaint.ticketCode})**
------------------------------------------------
- **الفرع:** فرع الخرج (${complaint.branch || 'Al Kharj'})
- **رقم اللوحة:** ${complaint.vehiclePlate} (${complaint.normalizedPlate || ''})
- **رقم الجوال:** ${complaint.phone}
- **نوع البلاغ:** ${categoryNames[complaint.category] || complaint.category}
- **الأجزاء المتضررة:** ${partsText}
- **تفاصيل الغسلة المرتبطة:** ${complaint.washDetails ? JSON.stringify(complaint.washDetails) : 'إدخال يدوي'}
- **وصف المشكلة:**
${complaint.description}

📷 **المرفقات وأدلة الضرر:**
${evidenceSection}

⏰ **توقيت التسجيل:** ${complaint.createdAtAST || new Date().toISOString()}`;

  try {
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        content: noteContent,
        message_type: 'outgoing',
        private: true // strictly internal private note
      })
    });
    return res.ok;
  } catch (err) {
    console.error('[Chatwoot Complaints] postPrivateStaffNote error:', err.message);
    return false;
  }
}

/**
 * End-to-end Chatwoot dispatch runner for newly submitted complaints
 */
export async function dispatchComplaintToChatwoot({ complaint, evidenceList = [] }) {
  if (!CHATWOOT_API_TOKEN) return { success: false };
  try {
    const contact = await findOrCreateContact({
      phone: complaint.phone,
      name: complaint.customerName || `عميل ${complaint.vehiclePlate}`,
      plate: complaint.vehiclePlate,
      branch: complaint.branch || 'Al Kharj'
    });

    const contactId = contact?.id;
    const conversation = await createComplaintConversation({
      contactId,
      sourceId: contact?.source_id,
      ticketCode: complaint.ticketCode
    });

    const conversationId = conversation?.id;

    if (conversationId) {
      const trackingUrl = `${APP_PUBLIC_URL}/complaint/${complaint.ticketCode}`;

      // 1. Send outbound WhatsApp to customer
      await sendWhatsAppConfirmation({
        conversationId,
        ticketCode: complaint.ticketCode,
        plate: complaint.vehiclePlate,
        trackingUrl,
        customerName: complaint.customerName
      });

      // 2. Post internal staff note
      await postPrivateStaffNote({
        conversationId,
        complaint,
        evidenceList
      });

      return {
        contactId,
        conversationId,
        success: true
      };
    }
  } catch (err) {
    console.error('[Chatwoot Complaints] dispatchComplaintToChatwoot error:', err.message);
  }

  return { success: false };
}
