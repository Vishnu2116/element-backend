const fs = require("fs");
const path = require("path");
const { validationResult } = require("express-validator");

const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CACHE_KEY = "cache:hero-slides";
const HERO_DIR = path.join(process.cwd(), "uploads", "hero");

fs.mkdirSync(HERO_DIR, { recursive: true });

function moveToHero(file) {
  const dest = path.join(HERO_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/hero/${file.filename}`;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}

async function bustCache() {
  await redis.del(CACHE_KEY);
}

// ── GET /api/hero-slides (public, cached) ──────────────────────
const getAll = async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      "SELECT * FROM hero_slides WHERE is_active = true ORDER BY display_order ASC",
    );
    await redis.set(CACHE_KEY, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error("heroSlides.getAll:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/admin/hero-slides/:id ─────────────────────────────
const getById = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  try {
    const { rows } = await pool.query(
      "SELECT * FROM hero_slides WHERE id = $1",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    console.error("heroSlides.getById:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── POST /api/admin/hero-slides ────────────────────────────────
const create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(422).json({ errors: errors.array() });
  }

  const imagePath = req.file ? moveToHero(req.file) : null;

  try {
    const {
      title,
      subtitle,
      badge_text,
      cta1_label,
      cta1_link,
      cta2_label,
      cta2_link,
      display_order,
      is_active,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO hero_slides
           (title, subtitle, badge_text, cta1_label, cta1_link,
            cta2_label, cta2_link, image_path, display_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
      [
        title,
        subtitle || null,
        badge_text || null,
        cta1_label || null,
        cta1_link || null,
        cta2_label || null,
        cta2_link || null,
        imagePath,
        display_order != null ? parseInt(display_order, 10) : 0,
        is_active !== undefined
          ? is_active === "true" || is_active === true
          : true,
      ],
    );

    await bustCache();
    await updateLastUpdated();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("heroSlides.create:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── PUT /api/admin/hero-slides/:id ─────────────────────────────
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
      "SELECT * FROM hero_slides WHERE id = $1",
      [req.params.id],
    );
    if (!existing[0]) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Not found" });
    }

    const prev = existing[0];
    let imagePath = prev.image_path;
    if (req.file) {
      removeFile(prev.image_path);
      imagePath = moveToHero(req.file);
    }

    const {
      title,
      subtitle,
      badge_text,
      cta1_label,
      cta1_link,
      cta2_label,
      cta2_link,
      display_order,
      is_active,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE hero_slides SET
           title=$1, subtitle=$2, badge_text=$3,
           cta1_label=$4, cta1_link=$5, cta2_label=$6, cta2_link=$7,
           image_path=$8, display_order=$9, is_active=$10,
           updated_at=NOW()
         WHERE id=$11
         RETURNING *`,
      [
        title,
        subtitle ?? prev.subtitle,
        badge_text ?? prev.badge_text,
        cta1_label ?? prev.cta1_label,
        cta1_link ?? prev.cta1_link,
        cta2_label ?? prev.cta2_label,
        cta2_link ?? prev.cta2_link,
        imagePath,
        display_order != null
          ? parseInt(display_order, 10)
          : prev.display_order,
        is_active !== undefined
          ? is_active === "true" || is_active === true
          : prev.is_active,
        req.params.id,
      ],
    );

    await bustCache();
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("heroSlides.update:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── DELETE /api/admin/hero-slides/:id ──────────────────────────
const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  try {
    const { rows } = await pool.query(
      "DELETE FROM hero_slides WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });

    removeFile(rows[0].image_path);
    await bustCache();
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("heroSlides.remove:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── PUT /api/admin/hero-slides/reorder ─────────────────────────
const reorder = async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res
      .status(422)
      .json({
        error: "items must be a non-empty array of { id, display_order }",
      });
  }

  for (const { id } of items) {
    if (!UUID_REGEX.test(id)) {
      return res.status(422).json({ error: `Invalid UUID: ${id}` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { id, display_order } of items) {
      await client.query(
        "UPDATE hero_slides SET display_order=$1, updated_at=NOW() WHERE id=$2",
        [display_order, id],
      );
    }
    await client.query("COMMIT");
    await bustCache();
    await updateLastUpdated();
    return res.json({ message: "Reordered successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("heroSlides.reorder:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
};

module.exports = { getAll, getById, create, update, remove, reorder };
