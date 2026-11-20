/**
 * RUSH Car Wash (رش واش) - Complaints API Router
 * 
 * Endpoints for Customer Complaints WebApp & Branch Supervisor Desk:
 * - POST /api/complaints/verify
 * - POST /api/complaints/upload-url
 * - POST /api/complaints/submit
 * - GET  /api/complaints/:ticketCode
 * - POST /api/complaints/:ticketCode/append
 * - GET  /api/complaints/desk/list
 * - POST /api/complaints/desk/:ticketCode/resolve
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

const router = express.Router();

/**
 * Generate sequential/timestamped ticket code: C-2026-XXXX
 */
async function generateTicketCode(db) {
  const currentYear = 2026;
  try {
    const counterDoc = await db.collection('rushwash_counters').findOneAndUpdate(
      { _id: `complaints_${currentYear}` },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
    const seq = counterDoc?.seq || Math.floor(1000 + Math.random() * 9000);
    return `C-${currentYear}-${String(seq).padStart(4, '0')}`;
  } catch (e) {
    const randomSeq = Math.floor(1000 + Math.random() * 9000);
    return `C-${currentYear}-${randomSeq}`;
  }
}

/**
 * 1. Step 2 & 3: Customer Identification, Wash/Order Verification & Duplicate Prevention
 */
router.post('/verify', async (req, res) => {
  try {
    const { phone, plate } = req.body;
    if (!phone && !plate) {
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
    const activeStatusList = ['new', 'in_review', 'investigating'];
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
    return res.status(500).json({ error: 'Failed to verify customer records', details: err.message });
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
    if (fileSize && fileSize > 15 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds maximum limit of 15MB' });
    }

    const timestamp = Date.now();
    const cleanName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = `evidence/${timestamp}-${cleanName}`;
    const r2PublicDomain = process.env.R2_PUBLIC_DOMAIN || 'https://media.rush.com.sa';
    const r2Url = `${r2PublicDomain}/${fileKey}`;

    return res.json({
      success: true,
      fileKey,
      r2Url,
      uploadMethod: 'PUT',
      // In production Cloudflare Worker, this will be a pre-signed AWS S3 / R2 URL
      uploadUrl: `/api/complaints/upload-file?key=${encodeURIComponent(fileKey)}`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate upload URL', details: err.message });
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
    } = req.body;

    if (!phone || !vehiclePlate || !category || !description) {
      return res.status(400).json({ 
        error: 'Required fields missing: phone, vehiclePlate, category, description' 
      });
    }

    const db = await getLocalDb();
    const phoneInfo = normalizePhone(phone);
    const plateInfo = normalizePlate(vehiclePlate);

    // 1. Double-check for duplicate active complaint
    const activeComplaint = await db.collection('rushwash_complaints').findOne({
      status: { $in: ['new', 'in_review', 'investigating'] },
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
      customerName: customerName || `عميل ${plateInfo.displayPlate}`,
      branch: 'Al Kharj', // strictly single active branch
      bay,
      category, // 'damage' | 'quality' | 'billing' | 'delay' | 'staff'
      affectedParts,
      description,
      washId,
      orderId,
      washDetails,
      status: 'new',
      severity: category === 'damage' ? 'high' : 'normal',
      evidence: evidence.map(e => ({
        fileKey: e.fileKey,
        fileName: e.fileName,
        fileType: e.fileType,
        fileSize: e.fileSize,
        r2Url: e.r2Url,
        createdAt: now.getTime()
      })),
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
    return res.status(500).json({ error: 'Failed to submit complaint', details: err.message });
  }
});

/**
 * 4. Public Ticket Tracking & Status View
 */
router.get('/:ticketCode', async (req, res) => {
  try {
    const { ticketCode } = req.params;
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
        phoneMasked: complaint.phone ? complaint.phone.slice(0, 7) + 'XXXX' : '',
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
    return res.status(500).json({ error: 'Failed to fetch ticket', details: err.message });
  }
});

/**
 * 5. Append Notes / Additional Photos to an Existing Ticket
 */
router.post('/:ticketCode/append', async (req, res) => {
  try {
    const { ticketCode } = req.params;
    const { noteText, newEvidence = [], author = 'customer' } = req.body;

    if (!noteText && newEvidence.length === 0) {
      return res.status(400).json({ error: 'noteText or newEvidence is required' });
    }

    const db = await getLocalDb();
    const complaint = await db.collection('rushwash_complaints').findOne({
      ticketCode: ticketCode.toUpperCase()
    });

    if (!complaint) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const now = new Date();
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
        $each: newEvidence.map(e => ({
          fileKey: e.fileKey,
          fileName: e.fileName,
          fileType: e.fileType,
          fileSize: e.fileSize,
          r2Url: e.r2Url,
          createdAt: now.getTime()
        }))
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
    return res.status(500).json({ error: 'Failed to append note', details: err.message });
  }
});

/**
 * 6. Branch Supervisor Operations Desk: List all complaints
 */
router.get('/desk/list', async (req, res) => {
  try {
    const { status, category, search, limit = 50 } = req.query;
    const db = await getLocalDb();

    const query = {};
    if (status && status !== 'all') {
      query.status = status;
    }
    if (category && category !== 'all') {
      query.category = category;
    }
    if (search) {
      const cleanSearch = String(search).trim();
      query.$or = [
        { ticketCode: { $regex: cleanSearch, $options: 'i' } },
        { normalizedPlate: { $regex: cleanSearch, $options: 'i' } },
        { vehiclePlate: { $regex: cleanSearch, $options: 'i' } },
        { phone: { $regex: cleanSearch } }
      ];
    }

    const complaints = await db.collection('rushwash_complaints')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10))
      .toArray();

    return res.json({
      success: true,
      count: complaints.length,
      complaints
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list complaints', details: err.message });
  }
});

/**
 * 7. Branch Supervisor Operations Desk: Resolve Ticket
 */
router.post('/desk/:ticketCode/resolve', async (req, res) => {
  try {
    const { ticketCode } = req.params;
    const { resolutionType, resolutionNotes, resolvedBy = 'supervisor' } = req.body;

    if (!resolutionType) {
      return res.status(400).json({ error: 'resolutionType is required (rewash | refund | rejected)' });
    }

    const db = await getLocalDb();
    const now = new Date();
    const resolvedAtAST = formatRiyadhAST(now);

    const newStatus = resolutionType === 'rejected' ? 'rejected' : 'resolved';

    const updateRes = await db.collection('rushwash_complaints').findOneAndUpdate(
      { ticketCode: ticketCode.toUpperCase() },
      {
        $set: {
          status: newStatus,
          resolutionType,
          resolutionNotes: resolutionNotes || '',
          resolvedBy,
          resolvedAt: resolvedAtAST,
          updatedAt: now.getTime()
        },
        $push: {
          notes: {
            author: 'staff',
            authorName: 'مشرف الفرع (Supervisor)',
            noteText: `تم اتخاذ القرار: ${resolutionType === 'rewash' ? 'إصدار غسيل تعويضي' : (resolutionType === 'refund' ? 'استرداد مالي' : 'رفض البلاغ')}. التفاصيل: ${resolutionNotes || 'تم التحقق من كاميرات النفق'}`,
            isPrivate: false,
            createdAtAST: resolvedAtAST,
            createdAt: now.getTime()
          }
        }
      },
      { returnDocument: 'after' }
    );

    return res.json({
      success: true,
      ticketCode,
      status: newStatus,
      resolvedAt: resolvedAtAST
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to resolve complaint', details: err.message });
  }
});

export default router;
