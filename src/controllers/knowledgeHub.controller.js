const fs = require("fs");
const path = require("path");
const { validationResult, body } = require("express-validator");
const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");
const { verifyFileSignature } = require("../helpers/verifyFileSignature");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TYPES = new Set([
  "publication",
  "report",
  "iec_material",
  "newsletter",
  "success_story",
  "thematic_study",
  "documentation",
  "case_study",
  "notification",
  "lessons_learned",
]);
const FILES_DIR = path.join(process.cwd(), "uploads", "knowledge-hub", "files");
const THUMBNAILS_DIR = path.join(
  process.cwd(),
  "uploads",
  "knowledge-hub",
  "thumbnails",
);
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

function moveToFiles(file) {
  const dest = path.join(FILES_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/knowledge-hub/files/${file.filename}`;
}
function moveToThumbnails(file) {
  const dest = path.join(THUMBNAILS_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/knowledge-hub/thumbnails/${file.filename}`;
}
function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}
function cleanupReqFiles(files) {
  if (!files) return;
  for (const fieldFiles of Object.values(files)) {
    for (const f of fieldFiles) fs.unlink(f.path, () => {});
  }
}
function getFileType(mimetype) {
  const map = {
    "application/pdf": "PDF",
    "image/jpeg": "JPG",
    "image/png": "PNG",
    "image/webp": "WEBP",
  };
  return map[mimetype] ?? mimetype.split("/")[1]?.toUpperCase() ?? "FILE";
}
function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return val === "true" || val === true;
}
async function bustTypeCaches(type) {
  const keys = [`cache:knowledge-hub:${type}:1`, "cache:home:whats-new"];
  if (type === "notification") keys.push("cache:home:notifications");
  await Promise.all(keys.map((k) => redis.del(k)));
}

const getByType = async (req, res) => {
  const { type } = req.params;
  if (!VALID_TYPES.has(type))
    return res.status(404).json({ error: "Invalid document type" });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
  const offset = (page - 1) * limit;
  const search = req.query.search?.trim() || null;
  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  const noFilters = !search && !year;
  try {
    if (noFilters) {
      const cacheKey = `cache:knowledge-hub:${type}:${page}`;
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
      pool.query(
        `SELECT COUNT(*) FROM knowledge_hub_documents ${where}`,
        params,
      ),
      pool.query(
        `SELECT * FROM knowledge_hub_documents ${where}
         ORDER BY published_date DESC NULLS LAST
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    const total = parseInt(countResult.rows[0].count, 10);
    const result = {
      data: dataResult.rows,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
    if (noFilters) {
      await redis.set(
        `cache:knowledge-hub:${type}:${page}`,
        JSON.stringify(result),
        { EX: 86400 },
      );
    }
    return res.json(result);
  } catch (err) {
    console.error("knowledgeHub.getByType:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getById = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Document not found" });
  const cacheKey = `cache:knowledge-hub-doc:${req.params.id}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      "SELECT * FROM knowledge_hub_documents WHERE id = $1",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Document not found" });
    await redis.set(cacheKey, JSON.stringify(rows[0]), { EX: 86400 });
    return res.json(rows[0]);
  } catch (err) {
    console.error("knowledgeHub.getById:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getNotifications = async (req, res) => {
  const cacheKey = "cache:home:notifications";
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      `SELECT * FROM knowledge_hub_documents
       WHERE type = 'notification'
         AND is_active = true
         AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 10`,
    );
    await redis.set(cacheKey, JSON.stringify(rows), { EX: 3600 });
    return res.json(rows);
  } catch (err) {
    console.error("knowledgeHub.getNotifications:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getWhatsNew = async (req, res) => {
  const cacheKey = "cache:home:whats-new";
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      `SELECT id, title, 'knowledge_hub' AS source,
              type AS item_type, file_path, created_at,
              NULL AS slug
       FROM knowledge_hub_documents
       WHERE is_active = true
         AND created_at >= NOW() - INTERVAL '30 days'
       UNION ALL
       SELECT id, title, 'event' AS source,
              'event' AS item_type, NULL AS file_path,
              created_at, slug
       FROM events
       WHERE is_active = true
         AND created_at >= NOW() - INTERVAL '30 days'
       UNION ALL
       SELECT id, title, 'procurement' AS source,
              type AS item_type, file_path, created_at,
              NULL AS slug
       FROM procurements
       WHERE is_active = true
         AND created_at >= NOW() - INTERVAL '30 days'
       UNION ALL
       SELECT id, title, 'project' AS source,
              'project' AS item_type, NULL AS file_path,
              created_at, slug
       FROM projects
       WHERE is_active = true
         AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 20`,
    );
    await redis.set(cacheKey, JSON.stringify(rows), { EX: 3600 });
    return res.json(rows);
  } catch (err) {
    console.error("knowledgeHub.getWhatsNew:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getAllAdmin = async (req, res) => {
  const { type } = req.query;
  try {
    const { rows } = type
      ? await pool.query(
          "SELECT * FROM knowledge_hub_documents WHERE type = $1 ORDER BY created_at DESC",
          [type],
        )
      : await pool.query(
          "SELECT * FROM knowledge_hub_documents ORDER BY created_at DESC",
        );
    return res.json(rows);
  } catch (err) {
    console.error("knowledgeHub.getAllAdmin:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    cleanupReqFiles(req.files);
    return res.status(422).json({ errors: errors.array() });
  }
  const docFile = req.files?.file?.[0] || null;
  const thumbFile = req.files?.thumbnail?.[0] || null;

  if (docFile && !(await verifyFileSignature(docFile.path, "pdf"))) {
    cleanupReqFiles(req.files);
    return res.status(422).json({ error: "File content does not match its extension" });
  }
  if (thumbFile && !(await verifyFileSignature(thumbFile.path, "image"))) {
    cleanupReqFiles(req.files);
    return res.status(422).json({ error: "File content does not match its extension" });
  }

  const filePath = docFile ? moveToFiles(docFile) : null;
  const thumbnailPath = thumbFile ? moveToThumbnails(thumbFile) : null;
  const fileSizeKB = docFile ? Math.round(docFile.size / 1024) : null;
  const fileTypeStr = docFile ? getFileType(docFile.mimetype) : null;
  try {
    const { type, title, description, language, published_date, is_active } =
      req.body;
    const { rows } = await pool.query(
      `INSERT INTO knowledge_hub_documents
         (type, title, description, file_path, file_size, file_type,
          language, thumbnail_path, published_date, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        type,
        title.trim(),
        description || null,
        filePath,
        fileSizeKB,
        fileTypeStr,
        language || "English",
        thumbnailPath,
        published_date || null,
        toBool(is_active, true),
      ],
    );
    await bustTypeCaches(type);
    await updateLastUpdated();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("knowledgeHub.create:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const update = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) {
    cleanupReqFiles(req.files);
    return res.status(404).json({ error: "Document not found" });
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    cleanupReqFiles(req.files);
    return res.status(422).json({ errors: errors.array() });
  }
  try {
    const { rows: existing } = await pool.query(
      "SELECT * FROM knowledge_hub_documents WHERE id = $1",
      [req.params.id],
    );
    if (!existing[0]) {
      cleanupReqFiles(req.files);
      return res.status(404).json({ error: "Document not found" });
    }
    const prev = existing[0];
    const docFile = req.files?.file?.[0] || null;
    const thumbFile = req.files?.thumbnail?.[0] || null;

    if (docFile && !(await verifyFileSignature(docFile.path, "pdf"))) {
      cleanupReqFiles(req.files);
      return res.status(422).json({ error: "File content does not match its extension" });
    }
    if (thumbFile && !(await verifyFileSignature(thumbFile.path, "image"))) {
      cleanupReqFiles(req.files);
      return res.status(422).json({ error: "File content does not match its extension" });
    }

    let filePath = prev.file_path;
    let thumbnailPath = prev.thumbnail_path;
    let fileSizeKB = prev.file_size;
    let fileTypeStr = prev.file_type;
    if (docFile) {
      removeFile(prev.file_path);
      filePath = moveToFiles(docFile);
      fileSizeKB = Math.round(docFile.size / 1024);
      fileTypeStr = getFileType(docFile.mimetype);
    }
    if (thumbFile) {
      removeFile(prev.thumbnail_path);
      thumbnailPath = moveToThumbnails(thumbFile);
    }
    const { title, description, language, published_date, is_active } =
      req.body;
    const { rows } = await pool.query(
      `UPDATE knowledge_hub_documents SET
         title          = $1,
         description    = $2,
         file_path      = $3,
         file_size      = $4,
         file_type      = $5,
         language       = $6,
         thumbnail_path = $7,
         published_date = $8,
         is_active      = $9,
         updated_at     = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        title?.trim() ?? prev.title,
        description !== undefined ? description || null : prev.description,
        filePath,
        fileSizeKB,
        fileTypeStr,
        language !== undefined ? language || "English" : prev.language,
        thumbnailPath,
        published_date !== undefined
          ? published_date || null
          : prev.published_date,
        is_active !== undefined
          ? toBool(is_active, prev.is_active)
          : prev.is_active,
        req.params.id,
      ],
    );
    await Promise.all([
      bustTypeCaches(prev.type),
      redis.del(`cache:knowledge-hub-doc:${req.params.id}`),
    ]);
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("knowledgeHub.update:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Document not found" });
  try {
    const { rows } = await pool.query(
      "DELETE FROM knowledge_hub_documents WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Document not found" });
    removeFile(rows[0].file_path);
    removeFile(rows[0].thumbnail_path);
    await Promise.all([
      bustTypeCaches(rows[0].type),
      redis.del(`cache:knowledge-hub-doc:${req.params.id}`),
    ]);
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("knowledgeHub.remove:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const validators = [
  body("title").trim().notEmpty().withMessage("Title is required"),
  body("type")
    .notEmpty()
    .withMessage("Type is required")
    .isIn([...VALID_TYPES])
    .withMessage("Invalid document type"),
];
const updateValidators = [
  body("title").trim().notEmpty().withMessage("Title is required"),
];

module.exports = {
  getByType,
  getById,
  getNotifications,
  getWhatsNew,
  getAllAdmin,
  create,
  update,
  remove,
  validators,
  updateValidators,
};
