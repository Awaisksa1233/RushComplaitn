const keyQueues = new Map<string, Promise<unknown>>();

/**
 * Serializes async check-then-act operations on a logical key (e.g. customerId:posRecordId)
 * within the current Node process, complementing database-level unique constraints.
 */
export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyQueues.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => current, () => current);
  keyQueues.set(key, chained);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (keyQueues.get(key) === chained) {
      keyQueues.delete(key);
    }
  }
}
