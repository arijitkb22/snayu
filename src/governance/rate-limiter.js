/**
 * Rate Limiter — Token bucket per agent/connection/tool.
 */

const buckets = new Map(); // key → { tokens, lastRefill, limit, refillRate }

const DEFAULTS = {
  tokensPerMinute: 60,
  burstSize: 10,       // max burst above rate
};

/**
 * Check if a request is allowed under rate limits.
 * @param {string} key - Rate limit key (e.g. "agent:pr_review" or "conn:abc123" or "tool:query")
 * @param {object} opts - { tokensPerMinute, burstSize }
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs?: number }}
 */
export function checkRate(key, opts = {}) {
  const limit = opts.tokensPerMinute || DEFAULTS.tokensPerMinute;
  const burst = opts.burstSize || DEFAULTS.burstSize;
  const maxTokens = limit + burst;
  const refillPerMs = limit / 60000;

  let bucket = buckets.get(key);
  const now = Date.now();

  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now, limit, maxTokens };
    buckets.set(key, bucket);
  }

  // Refill tokens
  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillPerMs);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }

  const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillPerMs);
  return { allowed: false, remaining: 0, retryAfterMs };
}

/**
 * Get all active bucket stats.
 */
export function getBucketStats() {
  const stats = {};
  for (const [key, b] of buckets) {
    stats[key] = { tokens: Math.floor(b.tokens), limit: b.limit, maxTokens: b.maxTokens };
  }
  return stats;
}

/**
 * Reset a specific bucket or all buckets.
 */
export function resetBucket(key) {
  if (key) { buckets.delete(key); } else { buckets.clear(); }
}
