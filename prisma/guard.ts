/**
 * Safety interlock for scripts that delete or overwrite data.
 * Requires BOTH:
 *   ALLOW_DESTRUCTIVE_SEED=yes
 *   CONFIRM_DB_HOST=<the exact database host you are targeting>
 * and refuses to run when NODE_ENV=production.
 */
export function assertSafeToRunDestructive(scriptName: string) {
  const url = process.env.DATABASE_URL || "";
  let host = "";
  try { host = new URL(url).hostname; } catch { /* handled below */ }
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${scriptName}: refusing to run with NODE_ENV=production.`);
  }
  if (process.env.ALLOW_DESTRUCTIVE_SEED !== "yes") {
    throw new Error(`${scriptName}: destructive. Set ALLOW_DESTRUCTIVE_SEED=yes to proceed.`);
  }
  if (!host || process.env.CONFIRM_DB_HOST !== host) {
    throw new Error(`${scriptName}: set CONFIRM_DB_HOST=${host || "<db host>"} to confirm the target database.`);
  }
  console.log(`[guard] ${scriptName} will modify database host: ${host}`);
}
