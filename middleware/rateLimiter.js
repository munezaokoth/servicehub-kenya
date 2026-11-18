// middleware/rateLimiter.js
// ServiceHub Kenya - Rate Limiting
// Kenyan mobile networks put many users behind the same public IP (CGNAT),
// so limits are generous per IP; auth also keys on the email being tried.

const rateLimit = require("express-rate-limit");

const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down and try again." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 15,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String((req.body && req.body.email) || "").toLowerCase()}`,
  message: { success: false, message: "Too many failed sign-in attempts for this account. Try again in 15 minutes or reset your password." },
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many contact submissions. Please wait an hour." },
});

const mpesaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many payment attempts. Please wait 5 minutes." },
});

module.exports = { apiLimiter, authLimiter, contactLimiter, mpesaLimiter };
