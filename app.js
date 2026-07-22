require("dotenv").config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  console.error('FATAL: JWT_SECRET is not set in .env');
  process.exit(1);
}

const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const dirs = [
  "uploads/hero",
  "uploads/officials",
  "uploads/home-leadership",
  "uploads/knowledge-hub/files",
  "uploads/knowledge-hub/thumbnails",
  "uploads/projects/thumbnails",
  "uploads/projects/gallery",
  "uploads/gallery",
  "uploads/events/covers",
  "uploads/events/gallery",
  "uploads/procurements",
  "uploads/gis",
  "uploads/rti",
];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const cookieParser = require("cookie-parser");
const { globalLimiter } = require("./src/middleware/rateLimiter");
const routes = require("./src/routes/index");

const app = express();

// Trust exactly one hop (the reverse proxy in front of this app in production).
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:", "*"],
        styleSrc: ["'self'", "https:", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'", "http://localhost:3000"],
      },
    },
  }),
);
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
  : [];

if (allowedOrigins.length === 0) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: FRONTEND_URL is not set in .env');
    process.exit(1);
  }
  console.warn('WARNING: FRONTEND_URL not set — CORS is open to all origins');
}

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.use(globalLimiter);

app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api", routes);

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
