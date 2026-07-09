const fs = require("fs");
const path = require("path");
const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISTRICTS_CACHE_KEY = "cache:gallery:districts";
const DISTRICT_CACHE_PREFIX = "cache:gallery:district:";
const GALLERY_DIR = path.join(process.cwd(), "uploads", "gallery");

fs.mkdirSync(GALLERY_DIR, { recursive: true });

function moveToGallery(file) {
  const dest = path.join(GALLERY_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/gallery/${file.filename}`;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}

const getDistricts = async (req, res) => {
  try {
    const cached = await redis.get(DISTRICTS_CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(`
      SELECT district, COUNT(*) as image_count
      FROM gallery_images
      WHERE is_active = true
      AND district IS NOT NULL
      GROUP BY district
      ORDER BY district ASC
    `);
    await redis.set(DISTRICTS_CACHE_KEY, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error("gallery.getDistricts:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getByDistrict = async (req, res) => {
  const { district } = req.params;
  const cacheKey = DISTRICT_CACHE_PREFIX + district;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      `SELECT * FROM gallery_images
       WHERE is_active = true
       AND district = $1
       ORDER BY created_at DESC`,
      [district],
    );
    await redis.set(cacheKey, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error("gallery.getByDistrict:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const create = async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(422).json({ error: "No images uploaded" });
  }
  try {
    const district = req.body.district || null;
    const { rows: maxRows } = await pool.query(
      "SELECT COALESCE(MAX(display_order), -1) AS max_order FROM gallery_images",
    );
    const baseOrder = maxRows[0].max_order + 1;
    const imagePaths = req.files.map((f) => moveToGallery(f));
    const values = imagePaths
      .map(
        (_, i) =>
          `($${i + 1}, $${imagePaths.length + i + 1}, $${imagePaths.length * 2 + 1})`,
      )
      .join(", ");
    const params = [
      ...imagePaths,
      ...imagePaths.map((_, i) => baseOrder + i),
      district,
    ];
    const { rows } = await pool.query(
      `INSERT INTO gallery_images (image_path, display_order, district) VALUES ${values} RETURNING *`,
      params,
    );
    await Promise.all([
      redis.del(DISTRICTS_CACHE_KEY),
      redis.del(DISTRICT_CACHE_PREFIX + district),
    ]);
    await updateLastUpdated();
    return res.status(201).json(rows);
  } catch (err) {
    console.error("gallery.create:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  try {
    const { rows } = await pool.query(
      "DELETE FROM gallery_images WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    removeFile(rows[0].image_path);
    await Promise.all([
      redis.del(DISTRICTS_CACHE_KEY),
      redis.del(DISTRICT_CACHE_PREFIX + rows[0].district),
    ]);
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("gallery.remove:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { getDistricts, getByDistrict, create, remove };
