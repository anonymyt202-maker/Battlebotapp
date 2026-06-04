// Simple in-memory rate limiter (resets on restart — good for Railway)
const store = new Map();

/**
 * Rate limit factory
 * @param {number} windowMs - time window in ms
 * @param {number} max - max requests in window
 * @param {string} key - unique key prefix
 */
function createRateLimit(windowMs, max, keyPrefix = 'rl') {
  return function rateLimitMiddleware(req, res, next) {
    const userId = req.telegramUser?.id;
    if (!userId) return next(); // no user = auth middleware handles it

    const key = `${keyPrefix}:${userId}`;
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return res.status(429).json({
        success: false,
        error: `Juda ko'p so'rov. ${retryAfter} soniyadan keyin qayta urinib ko'ring.`,
        retryAfter,
      });
    }

    entry.count++;
    next();
  };
}

// Battle creation: 1 per 30 seconds per user
const battleCreateLimit = createRateLimit(30 * 1000, 1, 'battle_create');

// Vote: handled by DB UNIQUE constraint, but add IP-level soft limit
const voteLimit = createRateLimit(5 * 1000, 3, 'vote');

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store.entries()) {
    if (now > val.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

module.exports = { createRateLimit, battleCreateLimit, voteLimit };
