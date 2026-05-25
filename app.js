require("dotenv").config();

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

const { globalLimiter } = require("./src/middleware/rateLimiter");
const routes = require("./src/routes/index");

const app = express();

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
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.use(globalLimiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api", routes);

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
