/**
 * Admin & Supervisor API (/api/admin/*)
 *  - supervisor: work the complaint queue (assign, status, notes, resolve)
 *  - admin: everything above + KPIs across history + user management
 */
import express from 'express';
import { ObjectId } from 'mongodb';
import { getLocalDb, formatRiyadhAST, escapeRegex } from '../complaintsBridge.js';
import {
  ROLES, hashPassword, verifyPassword, validatePasswordStrength,
  signToken, requireAuth, usersCollection, ensureBootstrapAdmin
} from './auth.js';
import { computeStats, ACTIVE } from './stats.js';

const router = express.Router();
const both = requireAuth('admin', 'supervisor');
const adminOnly = requireAuth('admin');
const COMPLAINTS = 'rushwash_complaints';
const CODE_RE = /^C-\d{4}-\d{4,}$/i;
const STATUSES = [...ACTIVE, 'resolved', 'rejected'];
const RESOLUTIONS = ['rewash', 'refund', 'rejected'];
const SLA_HOURS = Number(process.env.COMPLAINTS_SLA_HOURS) || 24;

ensureBootstrapAdmin().catch(e => console.warn('[Admin] bootstrap skipped:', e.message));

const fail = (res, label, err) => {
  console.error(`[Admin API] ${label}:`, err);
  return res.status(500).json({ error: 'Internal error' });
};
const publicUser = u => ({ id: String(u._id), username: u.username, displayName: u.displayName, role: u.role, active: u.active });

// ---- Login (in-memory throttle: 8 failures / 15 min per ip+username) ----
const attempts = new Map();
const throttled = key => {
  const rec = attempts.get(key);
  return rec && rec.count >= 8 && Date.now() - rec.first < 15 * 60 * 1000;
};
const noteFailure = key => {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > 15 * 60 * 1000) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count++;
};

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (throttled(key)) return res.status(429).json({ error: 'Too many attempts, try again later' });

    const user = await (await usersCollection()).findOne({ username: username.toLowerCase() });
    const ok = user && user.active && verifyPassword(password, user.passwordHash);
    if (!ok) {
      noteFailure(key);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    attempts.delete(key);
    await (await usersCollection()).updateOne({ _id: user._id }, { $set: { lastLoginAt: Date.now() } });
    res.json({ success: true, token: signToken(user), user: publicUser(user) });
  } catch (err) { fail(res, 'login', err); }
});

router.get('/me', both, (req, res) => res.json({ success: true, user: req.user }));

// ---- KPIs ----
router.get('/stats', both, async (req, res) => {
  try {
    const db = await getLocalDb();
    const since = Date.now() - 90 * 24 * 3600 * 1000;
    const docs = await db.collection(COMPLAINTS)
      .find({ createdAt: { $gte: since } }, { projection: { status: 1, category: 1, createdAt: 1, updatedAt: 1, resolvedAtMs: 1, resolutionType: 1, assignedTo: 1 } })
      .limit(5000).toArray();
    res.json({ success: true, stats: computeStats(docs, { slaHours: SLA_HOURS }), windowDays: 90 });
  } catch (err) { fail(res, 'stats', err); }
});

// ---- Complaint queue ----
router.get('/complaints', both, async (req, res) => {
  try {
    const { status, category, assignee, search, overdue } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const q = {};
    if (status && status !== 'all') {
      if (status === 'active') q.status = { $in: ACTIVE };
      else if (STATUSES.includes(String(status))) q.status = String(status);
      else return res.status(400).json({ error: 'Invalid status' });
    }
    if (category && category !== 'all') q.category = String(category);
    if (assignee === 'me') q.assignedTo = req.user.id;
    else if (assignee === 'none') q.assignedTo = null;
    else if (assignee && assignee !== 'all') q.assignedTo = String(assignee);
    if (overdue === '1') {
      q.status = { $in: ACTIVE };
      q.createdAt = { $lt: Date.now() - SLA_HOURS * 3600 * 1000 };
    }
    if (search) {
      const s = escapeRegex(String(search).trim().slice(0, 50));
      q.$or = [{ ticketCode: { $regex: s, $options: 'i' } }, { normalizedPlate: { $regex: s, $options: 'i' } },
               { vehiclePlate: { $regex: s, $options: 'i' } }, { phone: { $regex: s } }];
    }
    const items = await (await getLocalDb()).collection(COMPLAINTS)
      .find(q, { projection: { notes: 0, evidence: 0, washDetails: 0 } })
      .sort({ createdAt: -1 }).limit(limit).toArray();
    res.json({ success: true, count: items.length, slaHours: SLA_HOURS, complaints: items });
  } catch (err) { fail(res, 'list', err); }
});

router.get('/complaints/:code', both, async (req, res) => {
  try {
    if (!CODE_RE.test(req.params.code)) return res.status(404).json({ error: 'Not found' });
    const c = await (await getLocalDb()).collection(COMPLAINTS).findOne({ ticketCode: req.params.code.toUpperCase() });
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, complaint: c });
  } catch (err) { fail(res, 'detail', err); }
});

/** Shared helper: update an existing ticket and append an audit note. */
async function mutate(req, res, { filter = {}, set = {}, noteText, isPrivate = true }) {
  if (!CODE_RE.test(req.params.code)) return res.status(404).json({ error: 'Not found' });
  const now = Date.now();
  const note = noteText ? {
    author: 'staff', authorId: req.user.id, authorName: req.user.displayName,
    noteText, isPrivate, createdAtAST: formatRiyadhAST(new Date(now)), createdAt: now
  } : null;
  const result = await (await getLocalDb()).collection(COMPLAINTS).findOneAndUpdate(
    { ticketCode: req.params.code.toUpperCase(), ...filter },
    { $set: { ...set, updatedAt: now }, ...(note ? { $push: { notes: note } } : {}) },
    { returnDocument: 'after' }
  );
  const doc = result?.ticketCode ? result : result?.value;
  if (!doc) return res.status(404).json({ error: 'Ticket not found or not in a valid state for this action' });
  return res.json({ success: true, complaint: doc });
}

router.post('/complaints/:code/assign', both, async (req, res) => {
  try {
    const { userId } = req.body || {};
    let name = null;
    if (userId) {
      if (!ObjectId.isValid(userId)) return res.status(400).json({ error: 'Invalid userId' });
      const u = await (await usersCollection()).findOne({ _id: new ObjectId(userId), active: true });
      if (!u) return res.status(400).json({ error: 'User not found' });
      name = u.displayName;
    }
    await mutate(req, res, {
      filter: { status: { $in: ACTIVE } },
      set: { assignedTo: userId || null, assignedToName: name },
      noteText: name ? `تم إسناد البلاغ إلى ${name}` : 'تم إلغاء إسناد البلاغ'
    });
  } catch (err) { fail(res, 'assign', err); }
});

router.post('/complaints/:code/status', both, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!ACTIVE.includes(status)) return res.status(400).json({ error: `status must be one of: ${ACTIVE.join(', ')}` });
    await mutate(req, res, {
      filter: { status: { $in: ACTIVE } },
      set: { status },
      noteText: `تم تغيير الحالة إلى: ${status}`
    });
  } catch (err) { fail(res, 'status', err); }
});

router.post('/complaints/:code/note', both, async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 2000) : '';
    if (!text) return res.status(400).json({ error: 'text is required' });
    await mutate(req, res, { noteText: text, isPrivate: req.body.isPrivate !== false });
  } catch (err) { fail(res, 'note', err); }
});

router.post('/complaints/:code/resolve', both, async (req, res) => {
  try {
    const { resolutionType } = req.body || {};
    const notes = String(req.body?.notes || '').slice(0, 2000);
    if (!RESOLUTIONS.includes(resolutionType)) return res.status(400).json({ error: `resolutionType must be one of: ${RESOLUTIONS.join(', ')}` });
    const now = Date.now();
    await mutate(req, res, {
      filter: { status: { $in: ACTIVE } },
      set: {
        status: resolutionType === 'rejected' ? 'rejected' : 'resolved',
        resolutionType, resolutionNotes: notes,
        resolvedBy: req.user.displayName, resolvedById: req.user.id,
        resolvedAt: formatRiyadhAST(new Date(now)), resolvedAtMs: now
      },
      noteText: `القرار: ${resolutionType}. ${notes}`.trim(),
      isPrivate: false
    });
  } catch (err) { fail(res, 'resolve', err); }
});

/** Admin only: reopen a closed ticket. */
router.post('/complaints/:code/reopen', adminOnly, async (req, res) => {
  try {
    await mutate(req, res, {
      filter: { status: { $in: ['resolved', 'rejected'] } },
      set: { status: 'in_review', resolvedAtMs: null },
      noteText: 'أُعيد فتح البلاغ'
    });
  } catch (err) { fail(res, 'reopen', err); }
});

// ---- Staff directory (for assignment dropdown) ----
router.get('/staff', both, async (req, res) => {
  try {
    const users = await (await usersCollection()).find({ active: true }).project({ displayName: 1, role: 1 }).toArray();
    res.json({ success: true, staff: users.map(u => ({ id: String(u._id), displayName: u.displayName, role: u.role })) });
  } catch (err) { fail(res, 'staff', err); }
});

// ---- User management (admin) ----
router.get('/users', adminOnly, async (req, res) => {
  try {
    const users = await (await usersCollection()).find({}).sort({ createdAt: 1 }).toArray();
    res.json({ success: true, users: users.map(u => ({ ...publicUser(u), lastLoginAt: u.lastLoginAt || null })) });
  } catch (err) { fail(res, 'users', err); }
});

router.post('/users', adminOnly, async (req, res) => {
  try {
    const { username, displayName, role, password } = req.body || {};
    if (typeof username !== 'string' || !/^[a-z0-9._-]{3,32}$/i.test(username)) {
      return res.status(400).json({ error: 'username must be 3-32 chars (letters, digits, . _ -)' });
    }
    if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
    if (!validatePasswordStrength(password)) return res.status(400).json({ error: 'password must be at least 10 characters' });
    const col = await usersCollection();
    await col.createIndex({ username: 1 }, { unique: true });
    try {
      const r = await col.insertOne({
        username: username.toLowerCase(), displayName: String(displayName || username).slice(0, 80), role,
        passwordHash: hashPassword(password), active: true, createdAt: Date.now(), createdBy: req.user.id
      });
      res.status(201).json({ success: true, id: String(r.insertedId) });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'Username already exists' });
      throw e;
    }
  } catch (err) { fail(res, 'create user', err); }
});

router.patch('/users/:id', adminOnly, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { role, active, password, displayName } = req.body || {};
    const set = {};
    if (role !== undefined) { if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' }); set.role = role; }
    if (active !== undefined) set.active = !!active;
    if (displayName !== undefined) set.displayName = String(displayName).slice(0, 80);
    if (password !== undefined) {
      if (!validatePasswordStrength(password)) return res.status(400).json({ error: 'password must be at least 10 characters' });
      set.passwordHash = hashPassword(password);
    }
    if (req.params.id === req.user.id && (set.active === false || (set.role && set.role !== 'admin'))) {
      return res.status(400).json({ error: 'You cannot deactivate or demote yourself' });
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to update' });
    const r = await (await usersCollection()).updateOne({ _id: new ObjectId(req.params.id) }, { $set: set });
    if (!r.matchedCount) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  } catch (err) { fail(res, 'update user', err); }
});

export default router;
