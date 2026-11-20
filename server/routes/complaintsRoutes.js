/**
 * RUSH Car Wash (رش واش) - Complaints API Router
 * 
 * Endpoints for Customer Complaints WebApp:
 * - POST /api/complaints/verify
 * - POST /api/complaints/upload-url
 * - POST /api/complaints/submit
 * - GET  /api/complaints/:ticketCode
 * - POST /api/complaints/:ticketCode/append
 */

import express from 'express';
import { 
  getLocalDb, 
  normalizePhone, 
  normalizePlate, 
  lookupVerifiedWashes, 
  lookupVerifiedOrders,
  formatRiyadhAST,
  formatRiyadhASTArabic
} from '../complaintsBridge.js';
import { dispatchComplaintToChatwoot } from '../chatwootComplaints.js';
import crypto from 'node:crypto';

const ACTIVE_STATUSES = ['new', 'in_review', 'investigating'];
const CATEGORIES = ['damage', 'quality', 'billing', 'delay', 'staff'];
const MAX_EVIDENCE = 10;
const R2_PUBLIC_DOMAIN = (process.env.R2_PUBLIC_DOMAIN || 'https://r2.rush.com.sa').replace(/\/+$/, '');

function isAllowedMediaUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // Allow Cloudflare R2 public domains, custom domains, or configured domain
    return host.endsWith('.r2.dev') ||
           host.endsWith('.r2.cloudflarestorage.com') ||
           host === 'r2.rush.com.sa' ||
           host === 'media.rush.com.sa' ||
           url.startsWith(R2_PUBLIC_DOMAIN + '/');
  } catch {
    return false;
  }
}

/** Never leak internal error messages to clients. */
function fail(res, label, err, message) {
  console.error(`[Complaints API] ${label} error:`, err);
  return res.status(500).json({ error: message });
}

/** Keep only evidence that points at allowed R2 / media domains, with bounded sizes. */
function sanitizeEvidence(list, now) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_EVIDENCE)
    .filter(e => e && typeof e.r2Url === 'string' && isAllowedMediaUrl(e.r2Url))
    .map(e => ({
      fileKey: String(e.fileKey || '').slice(0, 200),
      fileName: String(e.fileName || '').slice(0, 200),
      fileType: String(e.fileType || '').slice(0, 100),
      fileSize: Number(e.fileSize) || 0,
      r2Url: e.r2Url.slice(0, 500),
      createdAt: now.getTime()
    }));
}

const router = express.Router();

/**
 * Generate sequential/timestamped ticket code: C-2026-XXXX
 */
async function generateTicketCode(db) {
  const currentYear = new Date().getFullYear();
  const counterDoc = await db.collection('rushwash_counters').findOneAndUpdate(
    { _id: `complaints_${currentYear}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  // mongodb driver v6+ returns the document directly; older returns { value }
  const seq = counterDoc?.seq ?? counterDoc?.value?.seq;
  if (!seq) throw new Error('Failed to allocate ticket sequence');
  return `C-${currentYear}-${String(seq).padStart(4, '0')}`;
}

/**
 * 1. Step 2 & 3: Customer Identification, Wash/Order Verification & Duplicate Prevention
 */
router.post('/verify', async (req, res) => {
  try {
    const { phone, plate } = req.body || {};
    if (typeof phone === 'object' || typeof plate === 'object' || (!phone && !plate)) {
      return res.status(400).json({ error: 'Phone or vehicle plate is required' });
    }

    const phoneInfo = normalizePhone(phone);
    const plateInfo = normalizePlate(plate);
    const db = await getLocalDb();

    // 1. Query verified washes (last 7 days) and orders (last 14 days)
    const [matchedWashes, matchedOrders] = await Promise.all([
      lookupVerifiedWashes(phone, plate),
      lookupVerifiedOrders(phone, plate)
    ]);

    // 2. Check for existing active complaints (status in ['new', 'in_review', 'investigating'])
    const activeStatusList = ACTIVE_STATUSES;
    const duplicateQuery = {
      status: { $in: activeStatusList },
      $or: []
    };

    if (plateInfo.normalizedPlate) {
      duplicateQuery.$or.push({ normalizedPlate: plateInfo.normalizedPlate });
    }
    if (phoneInfo.standard) {
      duplicateQuery.$or.push({ phone: phoneInfo.standard });
    }

    let activeComplaint = null;
    if (duplicateQuery.$or.length > 0) {
      activeComplaint = await db.collection('rushwash_complaints')
        .findOne(duplicateQuery, { sort: { createdAt: -1 } });
    }

    return res.json({
      success: true,
      verifiedCustomer: {
        phone: phoneInfo.standard,
        localPhone: phoneInfo.local,
        displayPlate: plateInfo.displayPlate,
        normalizedPlate: plateInfo.normalizedPlate
      },
      matchedWashes,
      matchedOrders,
      hasMatchedRecords: matchedWashes.length > 0 || matchedOrders.length > 0,
      duplicateFound: !!activeComplaint,
      existingTicket: activeComplaint ? {
        ticketCode: activeComplaint.ticketCode,
        category: activeComplaint.category,
        status: activeComplaint.status,
        statusAr: activeComplaint.status === 'new' ? 'تم الاستلام' : (activeComplaint.status === 'in_review' ? 'قيد المراجعة' : 'جاري الفحص'),
        createdAtAST: activeComplaint.createdAtAST,
        vehiclePlate: activeComplaint.vehiclePlate,
        branch: activeComplaint.branch || 'Al Kharj'
      } : null
    });
  } catch (err) {
    console.error('[Complaints API] /verify error:', err);
    return fail(res, '/verify', err, 'Failed to verify customer records');
  }
});

/**
 * 2. Step 4: Evidence Upload Pre-signed URL / Multipart Bridge for Cloudflare R2
 */
router.post('/upload-url', async (req, res) => {
  try {
    const { fileName, fileType, fileSize } = req.body;
    if (!fileName || !fileType) {
      return res.status(400).json({ error: 'fileName and fileType are required' });
    }

    // Check size limit: 15MB max
    if (typeof fileName !== 'string' || typeof fileType !== 'string') {
      return res.status(400).json({ error: 'fileName and fileType must be strings' });
    }
    if (!/^(image\/(jpeg|png|webp|heic)|video\/(mp4|quicktime))$/i.test(fileType)) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }
    if (fileSize && fileSize > 15 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds maximum limit of 15MB' });
    }

    const cleanName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_').slice(-80);
    const fileKey = `evidence/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${cleanName}`;
    const r2Url = `${R2_PUBLIC_DOMAIN}/${fileKey}`;

    return res.json({
      success: true,
      fileKey,
      r2Url,
      uploadMethod: 'PUT',
      // In production Cloudflare Worker, this will be a pre-signed AWS S3 / R2 URL
      uploadUrl: `/api/complaints/upload-file?key=${encodeURIComponent(fileKey)}`
    });
  } catch (err) {
    return fail(res, '/upload-url', err, 'Failed to generate upload URL');
  }
});

/**
 * 3. Step 5: Complaint Submission & 2-Way Chatwoot WhatsApp Outbound
 */
router.post('/submit', async (req, res) => {
  try {
    const {
      phone,
      vehiclePlate,
      branch = 'al-kharj',
      bay = 'tunnel-1',
      category,
      affectedParts = [],
      description,
      washId = null,
      orderId = null,
      washDetails = null,
      evidence = [],
      customerName = ''
    } = req.body || {};

    if (!phone || !vehiclePlate || !category || !description) {
      return res.status(400).json({ 
        error: 'Required fields missing: phone, vehiclePlate, category, description' 
      });
    }

    if (![phone, vehiclePlate, category, description].every(v => typeof v === 'string')) {
      return res.status(400).json({ error: 'Invalid field types' });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
    }
    if (description.length > 3000) {
      return res.status(400).json({ error: 'description is too long (max 3000 characters)' });
    }

    const phoneInfo = normalizePhone(phone);
    const plateInfo = normalizePlate(vehiclePlate);
    if (!/^\+9665\d{8}$/.test(phoneInfo.standard) || !plateInfo.normalizedPlate) {
      return res.status(400).json({ error: 'Invalid phone number or vehicle plate' });
    }
    const db = await getLocalDb();

    // 1. Double-check for duplicate active complaint
    const activeComplaint = await db.collection('rushwash_complaints').findOne({
      status: { $in: ACTIVE_STATUSES },
      $or: [
        { normalizedPlate: plateInfo.normalizedPlate },
        { phone: phoneInfo.standard }
      ],
      ...(washId ? { washId } : {})
    });

    if (activeComplaint) {
      return res.status(409).json({
        duplicateFound: true,
        message: 'Active complaint already exists for this vehicle or wash',
        existingTicket: {
          ticketCode: activeComplaint.ticketCode,
          status: activeComplaint.status,
          createdAtAST: activeComplaint.createdAtAST
        }
      });
    }

    // 2. Generate Ticket Code
    const ticketCode = await generateTicketCode(db);
    const now = new Date();
    const createdAtAST = formatRiyadhAST(now);
    const createdAtASTArabic = formatRiyadhASTArabic(now);

    const complaintDoc = {
      ticketCode,
      phone: phoneInfo.standard,
      localPhone: phoneInfo.local,
      vehiclePlate: plateInfo.displayPlate,
      normalizedPlate: plateInfo.normalizedPlate,
      customerName: String(customerName || '').slice(0, 100) || `عميل ${plateInfo.displayPlate}`,
      branch: 'Al Kharj', // strictly single active branch
      bay,
      category, // 'damage' | 'quality' | 'billing' | 'delay' | 'staff'
      affectedParts: Array.isArray(affectedParts) ? affectedParts.slice(0, 20).map(p => String(p).slice(0, 50)) : [],
      description: description.trim(),
      washId,
      orderId,
      washDetails,
      status: 'new',
      severity: category === 'damage' ? 'high' : 'normal',
      evidence: sanitizeEvidence(evidence, now),
      notes: [
        {
          author: 'system',
          authorName: 'النظام الآلي (System)',
          noteText: 'تم استلام البلاغ آلياً وتوثيقه في قاعدة البيانات',
          isPrivate: false,
          createdAtAST,
          createdAt: now.getTime()
        }
      ],
      chatwootConversationId: null,
      chatwootContactId: null,
      createdAtAST,
      createdAtASTArabic,
      createdAt: now.getTime(),
      updatedAt: now.getTime()
    };

    // 3. Save to MongoDB
    const insertResult = await db.collection('rushwash_complaints').insertOne(complaintDoc);
    complaintDoc._id = insertResult.insertedId;

    // 4. Dispatch 2-Way Chatwoot WhatsApp Outbound
    try {
      const chatwootResult = await dispatchComplaintToChatwoot({
        complaint: complaintDoc,
        evidenceList: complaintDoc.evidence
      });

      if (chatwootResult?.conversationId) {
        await db.collection('rushwash_complaints').updateOne(
          { _id: insertResult.insertedId },
          {
            $set: {
              chatwootConversationId: chatwootResult.conversationId,
              chatwootContactId: chatwootResult.contactId,
              updatedAt: Date.now()
            }
          }
        );
        complaintDoc.chatwootConversationId = chatwootResult.conversationId;
      }
    } catch (cwErr) {
      console.warn('[Complaints API] Chatwoot dispatch non-blocking error:', cwErr.message);
    }

    return res.status(201).json({
      success: true,
      ticketCode,
      status: 'new',
      statusAr: 'تم الاستلام بنجاح',
      createdAtAST,
      trackingUrl: `/complaint/${ticketCode}`,
      whatsappSupportUrl: `https://wa.me/966500000000?text=${encodeURIComponent(`مرحباً رش واش، أود الاستفسار عن بلاغي برقم #${ticketCode}`)}`,
      complaint: {
        ticketCode,
        phone: phoneInfo.standard,
        vehiclePlate: plateInfo.displayPlate,
        branch: 'Al Kharj',
        category,
        status: 'new',
        createdAtAST
      }
    });
  } catch (err) {
    console.error('[Complaints API] /submit error:', err);
    return fail(res, '/submit', err, 'Failed to submit complaint');
  }
});

/**
 * 4. Public Ticket Tracking & Status View
 */
router.get('/:ticketCode', async (req, res) => {
  try {
    const { ticketCode } = req.params;
    if (!/^C-\d{4}-\d{4,}$/i.test(ticketCode)) {
      return res.status(404).json({ error: 'Complaint ticket not found' });
    }
    const db = await getLocalDb();

    const complaint = await db.collection('rushwash_complaints').findOne({
      ticketCode: ticketCode.toUpperCase()
    });

    if (!complaint) {
      return res.status(404).json({ error: 'Complaint ticket not found' });
    }

    const publicNotes = (complaint.notes || []).filter(n => !n.isPrivate);

    return res.json({
      success: true,
      complaint: {
        ticketCode: complaint.ticketCode,
        status: complaint.status,
        statusAr: complaint.status === 'new' ? 'تم الاستلام' : 
                  complaint.status === 'in_review' ? 'قيد المراجعة' :
                  complaint.status === 'investigating' ? 'جاري تفريغ الكاميرات' :
                  complaint.status === 'resolved' ? 'تم الحل والتعويض' : 'تم رفض البلاغ',
        category: complaint.category,
        vehiclePlate: complaint.vehiclePlate,
        phoneMasked: complaint.phone ? complaint.phone.slice(0, 4) + 'XXXXX' + complaint.phone.slice(-2) : '',
        branch: complaint.branch || 'Al Kharj',
        bay: complaint.bay,
        affectedParts: complaint.affectedParts,
        description: complaint.description,
        evidence: complaint.evidence || [],
        washDetails: complaint.washDetails,
        resolutionType: complaint.resolutionType,
        resolutionNotes: complaint.resolutionNotes,
        notes: publicNotes,
        createdAtAST: complaint.createdAtAST,
        createdAtASTArabic: complaint.createdAtASTArabic
      }
    });
  } catch (err) {
    return fail(res, 'GET /:ticketCode', err, 'Failed to fetch ticket');
  }
});

/**
 * 5. Append Notes / Additional Photos to an Existing Ticket
 */
router.post('/:ticketCode/append', async (req, res) => {
  try {
    const { ticketCode } = req.params;
    const { noteText: rawNote, newEvidence: rawEvidence = [] } = req.body || {};
    const author = 'customer'; // public endpoint: never trust a client-supplied author
    const noteText = typeof rawNote === 'string' ? rawNote.trim().slice(0, 2000) : '';
    const now = new Date();
    const newEvidence = sanitizeEvidence(rawEvidence, now);

    if (!noteText && newEvidence.length === 0) {
      return res.status(400).json({ error: 'noteText or valid newEvidence is required' });
    }
    if (!/^C-\d{4}-\d{4,}$/i.test(ticketCode)) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const db = await getLocalDb();
    const complaint = await db.collection('rushwash_complaints').findOne({
      ticketCode: ticketCode.toUpperCase()
    });

    if (!complaint) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (!ACTIVE_STATUSES.includes(complaint.status)) {
      return res.status(409).json({ error: 'Ticket is closed' });
    }

    const createdAtAST = formatRiyadhAST(now);

    const updateOps = {
      $set: { updatedAt: now.getTime() }
    };

    if (noteText) {
      updateOps.$push = updateOps.$push || {};
      updateOps.$push.notes = {
        author,
        authorName: author === 'customer' ? 'العميل' : 'المشرف',
        noteText,
        isPrivate: false,
        createdAtAST,
        createdAt: now.getTime()
      };
    }

    if (newEvidence.length > 0) {
      updateOps.$push = updateOps.$push || {};
      updateOps.$push.evidence = {
        $each: newEvidence
      };
    }

    await db.collection('rushwash_complaints').updateOne(
      { ticketCode: ticketCode.toUpperCase() },
      updateOps
    );

    return res.json({
      success: true,
      message: 'Note and evidence appended successfully',
      ticketCode
    });
  } catch (err) {
    return fail(res, '/append', err, 'Failed to append note');
  }
});

export default router;
