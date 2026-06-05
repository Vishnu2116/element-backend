const rateLimit = require("express-rate-limit");

const isDev = process.env.NODE_ENV !== "production";

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests on this endpoint, please try again later.",
  },
});

const mapKeyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

module.exports = { globalLimiter, strictLimiter, mapKeyLimiter };
