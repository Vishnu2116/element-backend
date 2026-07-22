const fs = require("fs");
const path = require("path");
const { validationResult, body } = require("express-validator");
const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");
const { verifyFileSignature } = require("../helpers/verifyFileSignature");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TYPES = new Set(["tender", "rfp"]);
const PROC_DIR = path.join(process.cwd(), "uploads", "procurements");
fs.mkdirSync(PROC_DIR, { recursive: true });

const STATUS_EXPR = `
  CASE
    WHEN status = 'cancelled'                    THEN 'cancelled'
    WHEN deadline > NOW() + INTERVAL '7 days'    THEN 'open'
    WHEN deadline > NOW()                        THEN 'closing_soon'
    ELSE 'closed'
  END AS computed_status`;

function moveToProcurements(file) {
  const dest = path.join(PROC_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/procurements/${file.filename}`;
}
function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}
function applyStatus(rows) {
  return rows.map(({ computed_status, ...row }) => ({
    ...row,
    status: computed_status,
  }));
}
function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return val === "true" || val === true;
}
async function bustCaches(type) {
  const keys = [
    `cache:procurements:${type}:1`,
    "cache:home:tenders",
    "cache:home:whats-new",
  ];
  await Promise.all(keys.map((k) => redis.del(k)));
}

const getByType = async (req, res) => {
  const { type } = req.params;
  if (!VALID_TYPES.has(type))
    return res.status(404).json({ error: "Invalid procurement type" });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
  const offset = (page - 1) * limit;
  const search = req.query.search?.trim() || null;
  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  const noFilters = !search && !year;
  try {
    if (noFilters) {
      const cacheKey = `cache:procurements:${type}:${page}`;
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    }
    const conditions = ["type = $1", "is_active = true"];
    const params = [type];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`title ILIKE $${params.length}`);
    }
    if (year) {
      params.push(year);
      conditions.push(`EXTRACT(YEAR FROM published_date) = $${params.length}`);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM procurements ${where}`, params),
      pool.query(
        `SELECT *, ${STATUS_EXPR}
         FROM procurements ${where}
         ORDER BY published_date DESC NULLS LAST
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    const total = parseInt(countResult.rows[0].count, 10);
    const result = {
      data: applyStatus(dataResult.rows),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
    if (noFilters) {
      await redis.set(
        `cache:procurements:${type}:${page}`,
        JSON.stringify(result),
        { EX: 86400 },
      );
    }
    return res.json(result);
  } catch (err) {
    console.error("procurements.getByType:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getTenders = async (req, res) => {
  const cacheKey = "cache:home:tenders";
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      `SELECT id, title, type AS item_type,
              file_path, published_date, deadline,
              status, created_at
       FROM procurements
       WHERE is_active = true
         AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 10`,
    );
    await redis.set(cacheKey, JSON.stringify(rows), { EX: 3600 });
    return res.json(rows);
  } catch (err) {
    console.error("procurements.getTenders:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getById = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  try {
    const { rows } = await pool.query(
      "SELECT * FROM procurements WHERE id = $1",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    console.error("procurements.getById:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getAllAdmin = async (req, res) => {
  const { type } = req.query;
  try {
    const { rows } =
      type && VALID_TYPES.has(type)
        ? await pool.query(
            "SELECT * FROM procurements WHERE type = $1 ORDER BY created_at DESC",
            [type],
          )
        : await pool.query(
            "SELECT * FROM procurements ORDER BY created_at DESC",
          );
    return res.json(rows);
  } catch (err) {
    console.error("procurements.getAllAdmin:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(422).json({ errors: errors.array() });
  }
  if (req.file) {
    const validSignature = await verifyFileSignature(req.file.path, "pdf");
    if (!validSignature) {
      fs.unlink(req.file.path, () => {});
      return res.status(422).json({ error: "File content does not match its extension" });
    }
  }
  const filePath = req.file ? moveToProcurements(req.file) : null;
  const fileSizeKB = req.file ? Math.round(req.file.size / 1024) : null;
  try {
    const { type, title, published_date, deadline, status, is_active } =
      req.body;
    const { rows } = await pool.query(
      `INSERT INTO procurements
         (type, title, published_date, deadline, status, file_path, file_size, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        type,
        title.trim(),
        published_date || null,
        deadline || null,
        status || "open",
        filePath,
        fileSizeKB,
        toBool(is_active, true),
      ],
    );
    await bustCaches(type);
    await updateLastUpdated();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("procurements.create:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const update = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: "Not found" });
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(422).json({ errors: errors.array() });
  }
  try {
    const { rows: existing } = await pool.query(
      "SELECT * FROM procurements WHERE id = $1",
      [req.params.id],
    );
    if (!existing[0]) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Not found" });
    }
    const prev = existing[0];
    let filePath = prev.file_path;
    let fileSizeKB = prev.file_size;
    if (req.file) {
      const validSignature = await verifyFileSignature(req.file.path, "pdf");
      if (!validSignature) {
        fs.unlink(req.file.path, () => {});
        return res.status(422).json({ error: "File content does not match its extension" });
      }
      removeFile(prev.file_path);
      filePath = moveToProcurements(req.file);
      fileSizeKB = Math.round(req.file.size / 1024);
    }
    const { title, published_date, deadline, status, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE procurements SET
         title          = $1,
         published_date = $2,
         deadline       = $3,
         status         = $4,
         file_path      = $5,
         file_size      = $6,
         is_active      = $7,
         updated_at     = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        title?.trim() ?? prev.title,
        published_date !== undefined
          ? published_date || null
          : prev.published_date,
        deadline !== undefined ? deadline || null : prev.deadline,
        status !== undefined ? status || "open" : prev.status,
        filePath,
        fileSizeKB,
        is_active !== undefined
          ? toBool(is_active, prev.is_active)
          : prev.is_active,
        req.params.id,
      ],
    );
    await bustCaches(prev.type);
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("procurements.update:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  try {
    const { rows } = await pool.query(
      "DELETE FROM procurements WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    removeFile(rows[0].file_path);
    await bustCaches(rows[0].type);
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("procurements.remove:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const validators = [
  body("title").trim().notEmpty().withMessage("Title is required"),
  body("type")
    .notEmpty()
    .withMessage("Type is required")
    .isIn(["tender", "rfp"])
    .withMessage("Type must be tender or rfp"),
];
const updateValidators = [
  body("title").trim().notEmpty().withMessage("Title is required"),
];

module.exports = {
  getByType,
  getTenders,
  getById,
  getAllAdmin,
  create,
  update,
  remove,
  validators,
  updateValidators,
};
