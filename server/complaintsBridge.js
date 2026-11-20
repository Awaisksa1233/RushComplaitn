/**
 * RUSH Car Wash (رش واش) - VPS Database Bridge for Complaints
 * 
 * STRICT SAFETY RULE: Connects ONLY to the local MongoDB instance (mongodb://127.0.0.1:27017/rushwash).
 * NEVER connects to live/production MongoDB Atlas.
 * Read-only operations for matching customer washes and orders.
 */

import { MongoClient } from 'mongodb';

const LOCAL_MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rushwash';
const DB_NAME = process.env.DB_NAME || 'rushwash';

export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let cachedClient = null;
let cachedDb = null;

export async function getLocalDb() {
  if (cachedDb) return cachedDb;
  try {
    cachedClient = new MongoClient(LOCAL_MONGO_URI, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    });
    await cachedClient.connect();
    cachedDb = cachedClient.db(DB_NAME);
    return cachedDb;
  } catch (err) {
    console.error('[Complaints Bridge] Error connecting to local MongoDB:', err.message);
    throw err;
  }
}

/**
 * Normalizes phone numbers to standard Saudi formats:
 * Returns object with:
 * - standard: "+9665XXXXXXXX"
 * - local: "05XXXXXXXX"
 * - digits: "9665XXXXXXXX"
 */
export function normalizePhone(raw) {
  if (!raw) return { standard: '', local: '', digits: '' };
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('05') && digits.length === 10) {
    digits = '966' + digits.slice(1);
  } else if (digits.startsWith('5') && digits.length === 9) {
    digits = '966' + digits;
  }
  const standard = '+' + digits;
  const local = digits.startsWith('966') ? '0' + digits.slice(3) : digits;
  return { standard, local, digits };
}

/**
 * Normalizes Arabic and Latin Saudi vehicle license plates
 * Examples: "أ ب ج 1234" -> "1234-ABJ", "1234 ABC" -> "1234-ABC"
 */
export function normalizePlate(raw) {
  if (!raw) return { displayPlate: '', normalizedPlate: '', digits: '', letters: '' };

  const s = String(raw).trim();
  const arabicToLatin = {
    'أ': 'A', 'ا': 'A', 'إ': 'A', 'آ': 'A',
    'ب': 'B',
    'ح': 'J', 'ج': 'G',
    'د': 'D',
    'ر': 'R',
    'س': 'S',
    'ص': 'X',
    'ط': 'T',
    'ع': 'E',
    'ق': 'G',
    'ك': 'K',
    'ل': 'L',
    'م': 'Z',
    'ن': 'N',
    'ه': 'H',
    'و': 'W',
    'ى': 'Y', 'ي': 'Y'
  };

  const arabicDigits = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

  let converted = '';
  for (const ch of s) {
    if (arabicDigits[ch]) converted += arabicDigits[ch];
    else if (arabicToLatin[ch]) converted += arabicToLatin[ch];
    else converted += ch;
  }

  const digits = (converted.match(/\d+/g) || []).join('');
  const letters = (converted.match(/[A-Za-z]+/g) || []).join('').toUpperCase();

  const normalizedPlate = digits && letters ? `${digits}-${letters}` : converted.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return {
    displayPlate: s,
    normalizedPlate,
    digits,
    letters
  };
}

/**
 * Formats a Date object to Riyadh Time (AST / UTC+3) string
 */
export function formatRiyadhAST(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  
  return d.toLocaleString('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }) + ' (AST)';
}

export function formatRiyadhASTArabic(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  
  return d.toLocaleString('ar-SA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }) + ' (توقيت الرياض)';
}

/**
 * Map package name to canonical 4 tiers: Nano, Fresh, Shiny, Interior cleaning
 */
export function getCanonicalPackage(rawName) {
  if (!rawName) return { nameEn: 'Standard Wash', nameAr: 'غسيل قياسي', tier: 'Fresh' };
  const n = String(rawName).toLowerCase();
  if (n.includes('nano') || n.includes('نانو')) {
    return { nameEn: 'Nano Wash', nameAr: 'غسيل نانو', tier: 'Nano' };
  }
  if (n.includes('shiny') || n.includes('شايني')) {
    return { nameEn: 'Shiny Wash', nameAr: 'غسيل شايني', tier: 'Shiny' };
  }
  if (n.includes('interior') || n.includes('داخلي') || n.includes('مقصورة')) {
    return { nameEn: 'Interior Clean', nameAr: 'تنظيف داخلي', tier: 'Interior' };
  }
  return { nameEn: 'Fresh Wash', nameAr: 'غسيل فرش', tier: 'Fresh' };
}

/**
 * Lookup verified washes from rushwash_wash_histories within the last 7 days
 */
export async function lookupVerifiedWashes(phoneRaw, plateRaw) {
  const db = await getLocalDb();
  const phoneInfo = normalizePhone(phoneRaw);
  const plateInfo = normalizePlate(plateRaw);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const queryConditions = [];

  // Plate match conditions
  if (plateInfo.normalizedPlate) {
    queryConditions.push({ normalizedPlate: { $regex: escapeRegex(plateInfo.normalizedPlate).replace('-', '.*'), $options: 'i' } });
    if (plateInfo.digits) queryConditions.push({ plateNumber: { $regex: escapeRegex(plateInfo.digits), $options: 'i' } });
    queryConditions.push({ 'vehicleSnapshot.normalizedPlate': { $regex: escapeRegex(plateInfo.normalizedPlate).replace('-', '.*'), $options: 'i' } });
  }

  // Phone match conditions
  if (phoneInfo.digits) {
    const phoneRegex = new RegExp(escapeRegex(phoneInfo.local || phoneInfo.digits.slice(-9)));
    queryConditions.push({ 'customerSnapshot.phone': { $regex: phoneRegex } });
    queryConditions.push({ 'customerSnapshot.mobileNumber': { $regex: phoneRegex } });
  }

  if (queryConditions.length === 0) {
    return [];
  }

  const filter = {
    $and: [
      {
        $or: [
          { createdAt: { $gte: sevenDaysAgo } },
          { washDate: { $gte: sevenDaysAgo.toISOString().slice(0, 10) } }
        ]
      },
      { $or: queryConditions }
    ]
  };

  const rawWashes = await db.collection('rushwash_wash_histories')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  // Pre-fetch linked subscriptions to resolve exact combo tiers (e.g. Nano + Interior)
  const subCodes = rawWashes.map(w => w.subscriptionReadableCode).filter(Boolean);
  const subMap = new Map();
  if (subCodes.length > 0) {
    try {
      const subs = await db.collection('rushwash_subscriptions')
        .find({ readableCode: { $in: subCodes } })
        .toArray();
      for (const s of subs) {
        if (s.readableCode) subMap.set(s.readableCode, s);
      }
    } catch (e) {
      console.warn('[Complaints Bridge] Subscription lookup warning:', e.message);
    }
  }

  return rawWashes.map(w => {
    const washDateObj = w.createdAt || (w.washDate ? new Date(w.washDate) : new Date());
    const sub = w.subscriptionReadableCode ? subMap.get(w.subscriptionReadableCode) : null;
    
    // Explicit detection for both exterior tunnel wash and interior detailing
    const hasExterior = w.exteriorStatus === 'done' 
      || ['AG-01', 'AG-02', '01', 'CS-01', 'EL-01'].includes(w.laneReadableCode) 
      || w.planType === 'exterior_wash'
      || w.entryPath === 'auto-gate';
    const hasInterior = w.interiorStatus === 'done' 
      || w.planType === 'interior_cleaning' 
      || w.includesInterior === true;

    let tier = 'Fresh';
    let nameEn = '';
    let nameAr = '';

    if (sub && (sub.packageNameEn || sub.packageNameAr)) {
      nameEn = sub.packageNameEn || '';
      nameAr = sub.packageNameAr || nameEn;
      const low = nameEn.toLowerCase();
      if (low.includes('nano') || (nameAr && nameAr.includes('نانو'))) {
        tier = 'Nano';
      } else if (low.includes('shiny') || (nameAr && nameAr.includes('شايني'))) {
        tier = 'Shiny';
      } else if (low.includes('interior') && !hasExterior) {
        tier = 'Interior';
      } else {
        tier = 'Fresh';
      }
    } else if (hasExterior && hasInterior) {
      tier = 'Fresh';
      nameEn = 'Full Wash (Exterior + Interior)';
      nameAr = 'غسيل شامل (خارجي + داخلي)';
    } else if (hasInterior && !hasExterior) {
      tier = 'Interior';
      nameEn = 'Interior Clean';
      nameAr = 'تنظيف داخلي';
    } else {
      const canonicalPkg = getCanonicalPackage(w.planType || w.packageName || 'Fresh');
      tier = canonicalPkg.tier;
      nameEn = canonicalPkg.nameEn;
      nameAr = canonicalPkg.nameAr;
    }

    const displayPlate = w.vehicleSnapshot?.displayPlate || w.plateNumber || plateInfo.displayPlate || 'N/A';
    const normalizedPlate = w.normalizedPlate || w.vehicleSnapshot?.normalizedPlate || plateInfo.normalizedPlate;

    return {
      washId: String(w._id),
      legacyId: w.legacyId || null,
      washDateAST: formatRiyadhAST(washDateObj),
      washDateASTArabic: formatRiyadhASTArabic(washDateObj),
      timestamp: washDateObj.getTime ? washDateObj.getTime() : new Date(washDateObj).getTime(),
      branch: 'Al Kharj', // Strictly single active branch
      branchAr: 'فرع الخرج',
      lane: w.laneReadableCode || 'Tunnel 1',
      laneAr: w.laneReadableCode?.startsWith('AG') ? `مسار النفق (${w.laneReadableCode})` : (w.laneReadableCode || 'مسار النفق'),
      packageTier: tier,
      packageNameEn: nameEn,
      packageNameAr: nameAr,
      hasExterior,
      hasInterior,
      services: [
        ...(hasExterior ? ['exterior'] : []),
        ...(hasInterior ? ['interior'] : [])
      ],
      displayPlate,
      normalizedPlate,
      customerName: 'عميل رش واش' // never return the stored customer name on this unauthenticated endpoint
    };
  });
}

/**
 * Lookup orders from rushwash_sale_orders within the last 14 days
 */
export async function lookupVerifiedOrders(phoneRaw, plateRaw) {
  const db = await getLocalDb();
  const phoneInfo = normalizePhone(phoneRaw);
  const plateInfo = normalizePlate(plateRaw);

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const queryConditions = [];
  if (plateInfo.normalizedPlate) {
    queryConditions.push({ normalizedPlate: { $regex: escapeRegex(plateInfo.normalizedPlate).replace('-', '.*'), $options: 'i' } });
    queryConditions.push({ 'vehicleSnapshot.normalizedPlate': { $regex: escapeRegex(plateInfo.normalizedPlate).replace('-', '.*'), $options: 'i' } });
  }
  if (phoneInfo.digits) {
    const phoneRegex = new RegExp(escapeRegex(phoneInfo.local || phoneInfo.digits.slice(-9)));
    queryConditions.push({ 'customerSnapshot.phone': { $regex: phoneRegex } });
  }

  if (queryConditions.length === 0) return [];

  const filter = {
    $and: [
      { createdAt: { $gte: fourteenDaysAgo } },
      { $or: queryConditions }
    ]
  };

  const rawOrders = await db.collection('rushwash_sale_orders')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  return rawOrders.map(o => {
    const orderDate = o.createdAt ? new Date(o.createdAt) : new Date();
    const pkgName = o.lineSnapshots?.[0]?.name || o.lineSnapshots?.[0]?.serviceName || 'Car Wash Subscription';
    const canonicalPkg = getCanonicalPackage(pkgName);

    return {
      orderId: String(o._id),
      orderCode: o.readableCode || `SO-${String(o._id).slice(-6)}`,
      totalSAR: Number(o.postDiscountTotal ?? o.lineSubtotal ?? 0),
      currency: 'SAR',
      orderDateAST: formatRiyadhAST(orderDate),
      orderDateASTArabic: formatRiyadhASTArabic(orderDate),
      timestamp: orderDate.getTime(),
      branch: 'Al Kharj',
      branchAr: 'فرع الخرج',
      packageNameEn: canonicalPkg.nameEn,
      packageNameAr: canonicalPkg.nameAr,
      status: o.status || 'paid',
      displayPlate: o.vehicleSnapshot?.displayPlate || plateInfo.displayPlate || 'N/A',
      customerName: 'عميل رش واش'
    };
  });
}
