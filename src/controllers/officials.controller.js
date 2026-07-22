const fs = require("fs");
const path = require("path");
const { validationResult, body } = require("express-validator");

const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");
const { VALID_DISTRICTS } = require("./gis.controller");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_REGEX = /^[0-9+\-\s()]{7,15}$/;

const OFFICIALS_DIR = path.join(process.cwd(), "uploads", "officials");
fs.mkdirSync(OFFICIALS_DIR, { recursive: true });

function moveToOfficials(file) {
  const dest = path.join(OFFICIALS_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/officials/${file.filename}`;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}

async function bustListCaches() {
  await redis.del("cache:whos-who");
  await redis.del("cache:directory");
}

const BASE_SELECT = `
    SELECT officials.*,
           official_categories.name AS category_name,
           official_categories.is_district_based AS category_is_district_based
    FROM   officials
    LEFT JOIN official_categories ON officials.category_id = official_categories.id
  `;

const LIST_ORDER = `
    ORDER BY official_categories.display_order ASC,
             officials.display_order ASC
  `;

// groupDistricts: when true (directory endpoint), district-based
// categories get a nested `districts` array instead of flat `officials`.
function groupByCategory(rows, { groupDistricts = false } = {}) {
  const map = new Map();
  for (const row of rows) {
    const key = row.category_id ?? "__none__";
    if (!map.has(key)) {
      map.set(key, {
        category_id: row.category_id,
        category_name: row.category_name,
        ...(groupDistricts
          ? { is_district_based: row.category_is_district_based ?? false }
          : {}),
        officials: [],
      });
    }
    const { category_name, category_is_district_based, ...official } = row;
    map.get(key).officials.push(official);
  }

  const groups = [...map.values()];
  if (!groupDistricts) return groups;

  return groups.map((group) => {
    if (!group.is_district_based) return group;

    const districtMap = new Map();
    for (const official of group.officials) {
      const key = official.district?.trim() || "Unassigned";
      if (!districtMap.has(key)) districtMap.set(key, []);
      districtMap.get(key).push(official);
    }
    const districts = [...districtMap.entries()]
      .map(([district, officials]) => ({ district, officials }))
      .sort((a, b) => {
        if (a.district === "Unassigned") return 1;
        if (b.district === "Unassigned") return -1;
        return a.district.localeCompare(b.district);
      });

    const { officials, ...rest } = group;
    return { ...rest, districts };
  });
}

function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return val === "true" || val === true;
}

// ── GET /api/about/whos-who (public, cached) ───────────────────
const getWhosWho = async (req, res) => {
  try {
    const cached = await redis.get("cache:whos-who");
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      `${BASE_SELECT}
         WHERE officials.show_in_whos_who = true
           AND officials.is_active = true
         ${LIST_ORDER}`,
    );
    const grouped = groupByCategory(rows);
    await redis.set("cache:whos-who", JSON.stringify(grouped), { EX: 86400 });
    return res.json(grouped);
  } catch (err) {
    console.error("officials.getWhosWho:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/about/directory (public, cached unless search) ────
const getDirectory = async (req, res) => {
  const search = req.query.search?.trim();
  const isSearch = Boolean(search);

  try {
    if (!isSearch) {
      const cached = await redis.get("cache:directory");
      if (cached) return res.json(JSON.parse(cached));
    }

    const params = [];
    let whereExtra = "";
    if (isSearch) {
      params.push(`%${search}%`);
      whereExtra = `
          AND (officials.name            ILIKE $1
            OR officials.designation     ILIKE $1
            OR officials.division_office ILIKE $1)`;
    }

    const { rows } = await pool.query(
      `${BASE_SELECT}
         WHERE officials.show_in_directory = true
           AND officials.is_active = true
         ${whereExtra}
         ${LIST_ORDER}`,
      params,
    );
    const grouped = groupByCategory(rows, { groupDistricts: true });

    if (!isSearch) {
      await redis.set("cache:directory", JSON.stringify(grouped), {
        EX: 86400,
      });
    }
    return res.json(grouped);
  } catch (err) {
    console.error("officials.getDirectory:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/about/officials/:id (public, cached) ──────────────
const getById = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  const cacheKey = `cache:official:${req.params.id}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      `${BASE_SELECT} WHERE officials.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });

    await redis.set(cacheKey, JSON.stringify(rows[0]), { EX: 86400 });
    return res.json(rows[0]);
  } catch (err) {
    console.error("officials.getById:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/admin/officials (admin — no cache) ────────────────
const getAllAdmin = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${BASE_SELECT}
         ORDER BY officials.display_order ASC, officials.created_at DESC`,
    );
    return res.json(rows);
  } catch (err) {
    console.error("officials.getAllAdmin:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── POST /api/admin/officials ──────────────────────────────────
const create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(422).json({ errors: errors.array() });
  }

  const photoPath = req.file ? moveToOfficials(req.file) : null;

  try {
    const {
      name,
      designation,
      organisation,
      division_office,
      phone,
      mobile,
      email,
      bio,
      category_id,
      district,
      show_in_whos_who,
      show_in_directory,
      display_order,
      is_active,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO officials
           (name, designation, organisation, division_office,
            phone, mobile, email, photo_path, bio, category_id, district,
            show_in_whos_who, show_in_directory, display_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
      [
        name.trim(),
        designation || null,
        organisation || null,
        division_office || null,
        phone || null,
        mobile || null,
        email || null,
        photoPath,
        bio || null,
        category_id || null,
        district || null,
        toBool(show_in_whos_who, false),
        toBool(show_in_directory, false),
        display_order != null ? parseInt(display_order, 10) : 0,
        toBool(is_active, true),
      ],
    );

    await bustListCaches();
    await updateLastUpdated();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("officials.create:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── PUT /api/admin/officials/:id ───────────────────────────────
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
      "SELECT * FROM officials WHERE id = $1",
      [req.params.id],
    );
    if (!existing[0]) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Not found" });
    }

    const prev = existing[0];
    let photoPath = prev.photo_path;
    if (req.file) {
      removeFile(prev.photo_path);
      photoPath = moveToOfficials(req.file);
    }

    const {
      name,
      designation,
      organisation,
      division_office,
      phone,
      mobile,
      email,
      bio,
      category_id,
      district,
      show_in_whos_who,
      show_in_directory,
      display_order,
      is_active,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE officials SET
           name             = $1,
           designation      = $2,
           organisation     = $3,
           division_office  = $4,
           phone            = $5,
           mobile           = $6,
           email            = $7,
           photo_path       = $8,
           bio              = $9,
           category_id      = $10,
           district         = $11,
           show_in_whos_who = $12,
           show_in_directory= $13,
           display_order    = $14,
           is_active        = $15,
           updated_at       = NOW()
         WHERE id = $16
         RETURNING *`,
      [
        name?.trim() ?? prev.name,
        designation !== undefined ? designation || null : prev.designation,
        organisation !== undefined ? organisation || null : prev.organisation,
        division_office !== undefined
          ? division_office || null
          : prev.division_office,
        phone !== undefined ? phone || null : prev.phone,
        mobile !== undefined ? mobile || null : prev.mobile,
        email !== undefined ? email || null : prev.email,
        photoPath,
        bio !== undefined ? bio || null : prev.bio,
        category_id !== undefined ? category_id || null : prev.category_id,
        district !== undefined ? district || null : prev.district,
        show_in_whos_who !== undefined
          ? toBool(show_in_whos_who, prev.show_in_whos_who)
          : prev.show_in_whos_who,
        show_in_directory !== undefined
          ? toBool(show_in_directory, prev.show_in_directory)
          : prev.show_in_directory,
        display_order != null
          ? parseInt(display_order, 10)
          : prev.display_order,
        is_active !== undefined
          ? toBool(is_active, prev.is_active)
          : prev.is_active,
        req.params.id,
      ],
    );

    await bustListCaches();
    await redis.del(`cache:official:${req.params.id}`);
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("officials.update:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── DELETE /api/admin/officials/:id ───────────────────────────
const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  try {
    const { rows } = await pool.query(
      "DELETE FROM officials WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });

    removeFile(rows[0].photo_path);
    await bustListCaches();
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("officials.remove:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const nameRequired = body("name")
  .trim()
  .notEmpty()
  .withMessage("Name is required");

const validators = [
  nameRequired,
  body("email")
    .optional({ nullable: true, checkFalsy: true })
    .isEmail()
    .withMessage("Must be a valid email"),
  body("phone")
    .optional({ nullable: true, checkFalsy: true })
    .matches(PHONE_REGEX)
    .withMessage("Phone must be a valid phone number"),
  body("mobile")
    .optional({ nullable: true, checkFalsy: true })
    .matches(PHONE_REGEX)
    .withMessage("Mobile must be a valid phone number"),
  body("district")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(VALID_DISTRICTS)
    .withMessage("Invalid district"),
];

module.exports = {
  getWhosWho,
  getDirectory,
  getById,
  getAllAdmin,
  create,
  update,
  remove,
  validators,
};
