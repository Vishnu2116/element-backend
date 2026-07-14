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

async function bustSiteCaches() {
  const keys = [
    "cache:gis:sites",
    ...VALID_DISTRICTS.map((d) => `cache:gis:sites:${d}`),
  ];
  await Promise.all(keys.map((k) => redis.del(k)));
}

const getMapKey = (req, res) => {
  return res.json({ key: process.env.GOOGLE_MAPS_API_KEY || "" });
};

const getDistricts = (req, res) => {
  return res.json(VALID_DISTRICTS);
};

const getSites = async (req, res) => {
  const district = req.query.district?.trim() || null;
  const cacheKey = district
    ? `cache:gis:sites:${district}`
    : "cache:gis:sites";
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      `SELECT
         s.id, s.sl_no, s.district, s.sub_division, s.range, s.beat,
         s.jfmc_name, s.area_sanction, s.area_kobo, s.remarks,
         s.overlapping_area, s.display_order,
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
         AND ($1::text IS NULL OR s.district = $1)
       GROUP BY s.id
       ORDER BY s.district ASC, s.display_order ASC`,
      [district],
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
         s.id, s.sl_no, s.district, s.sub_division, s.range, s.beat,
         s.jfmc_name, s.area_sanction, s.area_kobo, s.remarks,
         s.overlapping_area, s.display_order, s.is_active,
         s.created_at, s.updated_at,
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
       ORDER BY s.district ASC, s.display_order ASC`,
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
      sl_no,
      district,
      sub_division,
      range,
      beat,
      jfmc_name,
      area_sanction,
      area_kobo,
      remarks,
      overlapping_area,
      display_order,
      is_active,
    } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO gis_sites
         (sl_no, district, sub_division, range, beat, jfmc_name,
          area_sanction, area_kobo, remarks, overlapping_area,
          display_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        sl_no != null && sl_no !== "" ? parseInt(sl_no, 10) : null,
        district,
        sub_division || null,
        range || null,
        beat || null,
        jfmc_name.trim(),
        area_sanction != null && area_sanction !== "" ? area_sanction : null,
        area_kobo != null && area_kobo !== "" ? area_kobo : null,
        remarks || null,
        overlapping_area || null,
        display_order != null ? parseInt(display_order, 10) : 0,
        is_active !== undefined
          ? is_active === "true" || is_active === true
          : true,
      ],
    );
    await bustSiteCaches();
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
      sl_no,
      district,
      sub_division,
      range,
      beat,
      jfmc_name,
      area_sanction,
      area_kobo,
      remarks,
      overlapping_area,
      display_order,
      is_active,
    } = req.body;
    const { rows } = await pool.query(
      `UPDATE gis_sites SET
         sl_no            = $1,
         district         = $2,
         sub_division     = $3,
         range            = $4,
         beat             = $5,
         jfmc_name        = $6,
         area_sanction    = $7,
         area_kobo        = $8,
         remarks          = $9,
         overlapping_area = $10,
         display_order    = $11,
         is_active        = $12,
         updated_at       = NOW()
       WHERE id = $13
       RETURNING *`,
      [
        sl_no !== undefined
          ? sl_no != null && sl_no !== ""
            ? parseInt(sl_no, 10)
            : null
          : prev.sl_no,
        district !== undefined ? district : prev.district,
        sub_division !== undefined ? sub_division || null : prev.sub_division,
        range !== undefined ? range || null : prev.range,
        beat !== undefined ? beat || null : prev.beat,
        jfmc_name?.trim() ?? prev.jfmc_name,
        area_sanction !== undefined
          ? area_sanction === ""
            ? null
            : area_sanction
          : prev.area_sanction,
        area_kobo !== undefined
          ? area_kobo === ""
            ? null
            : area_kobo
          : prev.area_kobo,
        remarks !== undefined ? remarks || null : prev.remarks,
        overlapping_area !== undefined
          ? overlapping_area || null
          : prev.overlapping_area,
        display_order != null
          ? parseInt(display_order, 10)
          : prev.display_order,
        is_active !== undefined
          ? is_active === "true" || is_active === true
          : prev.is_active,
        req.params.id,
      ],
    );
    await bustSiteCaches();
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
    await bustSiteCaches();
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
      "SELECT id FROM gis_sites WHERE id = $1",
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
    const safeName = req.file.originalname
      .replace(/[^a-zA-Z0-9._\- ]/g, '')
      .trim() || 'kml-file.kml';
    const { rows } = await pool.query(
      `INSERT INTO gis_kml_files (site_id, file_name, file_path, file_size, display_order)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        req.params.id,
        safeName,
        filePath,
        fileSizeKB,
        displayOrder,
      ],
    );
    await bustSiteCaches();
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
      "DELETE FROM gis_kml_files WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    removeFile(rows[0].file_path);
    await bustSiteCaches();
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("gis.removeKml:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const createValidators = [
  body("jfmc_name").trim().notEmpty().withMessage("JFMC name is required"),
  body("district")
    .notEmpty()
    .withMessage("District is required")
    .isIn(VALID_DISTRICTS)
    .withMessage("Invalid district"),
  body("area_sanction")
    .optional({ nullable: true, checkFalsy: true })
    .isNumeric()
    .withMessage("Area sanction must be numeric"),
  body("area_kobo")
    .optional({ nullable: true, checkFalsy: true })
    .isNumeric()
    .withMessage("Area kobo must be numeric"),
];

const updateValidators = [
  body("jfmc_name").trim().notEmpty().withMessage("JFMC name is required"),
  body("district")
    .optional()
    .isIn(VALID_DISTRICTS)
    .withMessage("Invalid district"),
  body("area_sanction")
    .optional({ nullable: true, checkFalsy: true })
    .isNumeric()
    .withMessage("Area sanction must be numeric"),
  body("area_kobo")
    .optional({ nullable: true, checkFalsy: true })
    .isNumeric()
    .withMessage("Area kobo must be numeric"),
];

module.exports = {
  getMapKey,
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
