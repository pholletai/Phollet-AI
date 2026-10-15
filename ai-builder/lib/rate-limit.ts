type WindowCounter = {
  count: number;
  expiresAt: number;
};

const counters = new Map<string, WindowCounter>();

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  let counter = counters.get(key);

  if (!counter || counter.expiresAt <= now) {
    counter = { count: 0, expiresAt: now + windowMs };
    counters.set(key, counter);
  }

  counter.count += 1;
  if (counters.size > 10_000) {
    for (const [entryKey, entry] of counters) {
      if (entry.expiresAt <= now) counters.delete(entryKey);
    }
  }

  return {
    allowed: counter.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((counter.expiresAt - now) / 1000)),
  };
}
