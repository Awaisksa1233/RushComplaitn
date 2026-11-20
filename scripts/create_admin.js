#!/usr/bin/env node
/**
 * Create (or reset the password of) a dashboard user.
 *
 *   node scripts/create_admin.js <username> [--role admin|supervisor] [--name "Display Name"]
 *
 * The password is read from a hidden prompt (or ADMIN_PASSWORD for automation).
 * Uses MONGODB_URI / DB_NAME like the server. Run it on the machine that hosts the DB.
 */
import 'dotenv/config';
import readline from 'node:readline';
import { getLocalDb } from '../server/complaintsBridge.js';
import { hashPassword, validatePasswordStrength, ROLES } from '../server/admin/auth.js';

const args = process.argv.slice(2);
const username = (args.find(a => !a.startsWith('--')) || '').toLowerCase();
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const role = opt('role', 'admin');
const displayName = opt('name', username);

if (!/^[a-z0-9._-]{3,32}$/.test(username) || !ROLES.includes(role)) {
  console.error('Usage: node scripts/create_admin.js <username 3-32 chars [a-z0-9._-]> [--role admin|supervisor] [--name "Display Name"]');
  process.exit(1);
}

function promptHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const password = process.env.ADMIN_PASSWORD || await promptHidden('Password (min 10 chars): ');
if (!validatePasswordStrength(password)) { console.error('Password must be at least 10 characters.'); process.exit(1); }
if (!process.env.ADMIN_PASSWORD && password !== await promptHidden('Confirm password: ')) {
  console.error('Passwords do not match.'); process.exit(1);
}

const col = (await getLocalDb()).collection('rushwash_admin_users');
await col.createIndex({ username: 1 }, { unique: true });
const existing = await col.findOne({ username });
if (existing) {
  await col.updateOne({ _id: existing._id }, { $set: { passwordHash: hashPassword(password), role, active: true } });
  console.log(`Updated existing user "${username}" (role: ${role}, active, password reset).`);
} else {
  await col.insertOne({ username, displayName, role, passwordHash: hashPassword(password), active: true, createdAt: Date.now(), createdBy: 'cli' });
  console.log(`Created ${role} "${username}". Sign in at /admin.`);
}
process.exit(0);
