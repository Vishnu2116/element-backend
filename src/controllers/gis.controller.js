const fs = require("fs");
const path = require("path");
const { body, validationResult } = require("express-validator");
const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_DISTRICTS = [
  "Dhalai",
  "Gomati",
  "Khowai",
  "North Tripura",
  "Sepahijala",
  "South Tripura",
  "Unakoti",
  "West Tripura",
];
const GIS_DIR = path.join(process.cwd(), "uploads", "gis");
fs.mkdirSync(GIS_DIR, { recursive: true });

function moveToGis(file) {
  const dest = path.join(GIS_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/gis/${file.filename}`;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}

async function bustSiteCaches(year) {
  const keys = [
    "cache:gis:years",
    `cache:gis:sites:${year}`,
    ...VALID_DISTRICTS.map((d) => `cache:gis:sites:${year}:${d}`),
  ];
  await Promise.all(keys.map((k) => redis.del(k)));
}

const getMapKey = (req, res) => {
  return res.json({ key: process.env.GOOGLE_MAPS_API_KEY || "" });
};

const getYears = async (req, res) => {
  const cacheKey = "cache:gis:years";
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      "SELECT DISTINCT year FROM gis_sites WHERE is_active = true ORDER BY year DESC",
    );
    const years = rows.map((r) => r.year);
    await redis.set(cacheKey, JSON.stringify(years), { EX: 86400 });
    return res.json(years);
  } catch (err) {
    console.error("gis.getYears:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getDistricts = (req, res) => {
  return res.json(VALID_DISTRICTS);
};

const getSites = async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  const district = req.query.district?.trim() || null;
  if (!year || isNaN(year)) {
    return res.status(400).json({ error: "year query parameter is required" });
  }
  const cacheKey = district
    ? `cache:gis:sites:${year}:${district}`
    : `cache:gis:sites:${year}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      `SELECT
         s.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id',            k.id,
               'file_name',     k.file_name,
               'file_path',     k.file_path,
               'file_size',     k.file_size,
               'display_order', k.display_order
             ) ORDER BY k.display_order
           ) FILTER (WHERE k.id IS NOT NULL),
           '[]'
         ) AS kml_files
       FROM gis_sites s
       LEFT JOIN gis_kml_files k ON s.id = k.site_id
       WHERE s.is_active = true
         AND s.year = $1
         AND ($2::text IS NULL OR s.district = $2)
       GROUP BY s.id
       ORDER BY s.display_order ASC, s.name ASC`,
      [year, district],
    );
    await redis.set(cacheKey, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error("gis.getSites:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getAllAdmin = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         s.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id',            k.id,
               'file_name',     k.file_name,
               'file_path',     k.file_path,
               'file_size',     k.file_size,
               'display_order', k.display_order
             ) ORDER BY k.display_order
           ) FILTER (WHERE k.id IS NOT NULL),
           '[]'
         ) AS kml_files
       FROM gis_sites s
       LEFT JOIN gis_kml_files k ON s.id = k.site_id
       GROUP BY s.id
       ORDER BY s.year DESC, s.display_order ASC, s.name ASC`,
    );
    return res.json(rows);
  } catch (err) {
    console.error("gis.getAllAdmin:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ errors: errors.array() });
  try {
    const {
      name,
      district,
      year,
      area_covered,
      species_products,
      description,
      is_active,
      display_order,
    } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO gis_sites
         (name, district, year, area_covered, species_products,
          description, is_active, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        name.trim(),
        district,
        parseInt(year, 10),
        area_covered || null,
        species_products || null,
        description || null,
        is_active !== undefined
          ? is_active === "true" || is_active === true
          : true,
        display_order != null ? parseInt(display_order, 10) : 0,
      ],
    );
    await bustSiteCaches(rows[0].year);
    await updateLastUpdated();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("gis.create:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const update = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ errors: errors.array() });
  try {
    const { rows: existing } = await pool.query(
      "SELECT * FROM gis_sites WHERE id = $1",
      [req.params.id],
    );
    if (!existing[0]) return res.status(404).json({ error: "Not found" });
    const prev = existing[0];
    const {
      name,
      district,
      year,
      area_covered,
      species_products,
      description,
      is_active,
      display_order,
    } = req.body;
    const newYear = year != null ? parseInt(year, 10) : prev.year;
    const { rows } = await pool.query(
      `UPDATE gis_sites SET
         name             = $1,
         district         = $2,
         year             = $3,
         area_covered     = $4,
         species_products = $5,
         description      = $6,
         is_active        = $7,
         display_order    = $8,
         updated_at       = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        name?.trim() ?? prev.name,
        district !== undefined ? district : prev.district,
        newYear,
        area_covered !== undefined ? area_covered || null : prev.area_covered,
        species_products !== undefined
          ? species_products || null
          : prev.species_products,
        description !== undefined ? description || null : prev.description,
        is_active !== undefined
          ? is_active === "true" || is_active === true
          : prev.is_active,
        display_order != null
          ? parseInt(display_order, 10)
          : prev.display_order,
        req.params.id,
      ],
    );
    const cacheOps = [bustSiteCaches(newYear)];
    if (prev.year !== newYear) cacheOps.push(bustSiteCaches(prev.year));
    await Promise.all(cacheOps);
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("gis.update:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  try {
    const { rows: kmlRows } = await pool.query(
      "SELECT file_path FROM gis_kml_files WHERE site_id = $1",
      [req.params.id],
    );
    const { rows } = await pool.query(
      "DELETE FROM gis_sites WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    for (const kml of kmlRows) removeFile(kml.file_path);
    await bustSiteCaches(rows[0].year);
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("gis.remove:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const addKml = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: "Not found" });
  }
  if (!req.file) return res.status(422).json({ error: "No KML file uploaded" });
  try {
    const { rows: siteRows } = await pool.query(
      "SELECT id, year FROM gis_sites WHERE id = $1",
      [req.params.id],
    );
    if (!siteRows[0]) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Site not found" });
    }
    const { rows: maxRows } = await pool.query(
      "SELECT COALESCE(MAX(display_order), -1) AS max_order FROM gis_kml_files WHERE site_id = $1",
      [req.params.id],
    );
    const displayOrder = maxRows[0].max_order + 1;
    const filePath = moveToGis(req.file);
    const fileSizeKB = Math.round(req.file.size / 1024);
    const { rows } = await pool.query(
      `INSERT INTO gis_kml_files (site_id, file_name, file_path, file_size, display_order)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        req.params.id,
        req.file.originalname,
        filePath,
        fileSizeKB,
        displayOrder,
      ],
    );
    await bustSiteCaches(siteRows[0].year);
    await updateLastUpdated();
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error("gis.addKml:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const removeKml = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  try {
    const { rows } = await pool.query(
      `WITH deleted AS (
         DELETE FROM gis_kml_files WHERE id = $1 RETURNING *
       )
       SELECT d.*, s.year
       FROM deleted d
       JOIN gis_sites s ON d.site_id = s.id`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    removeFile(rows[0].file_path);
    await bustSiteCaches(rows[0].year);
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("gis.removeKml:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const createValidators = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("district")
    .notEmpty()
    .withMessage("District is required")
    .isIn(VALID_DISTRICTS)
    .withMessage("Invalid district"),
  body("year")
    .notEmpty()
    .withMessage("Year is required")
    .isInt({ min: 1000, max: 9999 })
    .withMessage("Year must be a valid 4-digit number"),
];

const updateValidators = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("district")
    .optional()
    .isIn(VALID_DISTRICTS)
    .withMessage("Invalid district"),
  body("year")
    .optional()
    .isInt({ min: 1000, max: 9999 })
    .withMessage("Year must be a valid 4-digit number"),
];

module.exports = {
  getMapKey,
  getYears,
  getDistricts,
  getSites,
  getAllAdmin,
  create,
  update,
  remove,
  addKml,
  removeKml,
  createValidators,
  updateValidators,
};
