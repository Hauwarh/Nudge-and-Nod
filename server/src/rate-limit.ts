interface Bucket {
  n: number;
  reset: number;
}

const buckets = new Map<string, Bucket>();

function bucket(key: string, windowMs: number): Bucket {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now > existing.reset) {
    const fresh = { n: 0, reset: now + windowMs };
    buckets.set(key, fresh);
    return fresh;
  }
  return existing;
}

/** True when this key has already reached `limit` inside the window. */
export function tooMany(key: string, limit: number, windowMs: number): boolean {
  if (buckets.size > 2000) {
    const now = Date.now();
    for (const [k, value] of buckets) {
      if (now > value.reset) buckets.delete(k);
    }
  }
  return bucket(key, windowMs).n >= limit;
}

export function hit(key: string, windowMs: number): void {
  bucket(key, windowMs).n += 1;
}

export function clearRate(key: string): void {
  buckets.delete(key);
}

export function resetRates(): void {
  buckets.clear();
}
