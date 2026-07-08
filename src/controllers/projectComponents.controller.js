const { validationResult, body } = require("express-validator");
const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_ALL = "cache:project-components";

function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return val === "true" || val === true;
}
function componentFields(body) {
  const {
    component_number,
    label,
    name,
    description,
    icon_name,
    stat1_label,
    stat1_value,
    stat2_label,
    stat2_value,
    stat3_label,
    stat3_value,
    stat4_label,
    stat4_value,
    display_order,
    is_active,
    objectives,
  } = body;
  return [
    parseInt(component_number, 10),
    label || null,
    name.trim(),
    description || null,
    icon_name || null,
    stat1_label || null,
    stat1_value || null,
    stat2_label || null,
    stat2_value || null,
    stat3_label || null,
    stat3_value || null,
    stat4_label || null,
    stat4_value || null,
    objectives || null,
    display_order != null ? parseInt(display_order, 10) : 0,
    toBool(is_active, true),
  ];
}

const getAll = async (req, res) => {
  try {
    const cached = await redis.get(CACHE_ALL);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      "SELECT * FROM project_components WHERE is_active = true ORDER BY display_order ASC",
    );
    await redis.set(CACHE_ALL, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error("projectComponents.getAll:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getById = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  const cacheKey = `cache:project-component:${req.params.id}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const { rows: comps } = await pool.query(
      "SELECT * FROM project_components WHERE id = $1",
      [req.params.id],
    );
    if (!comps[0]) return res.status(404).json({ error: "Not found" });
    const { rows: projects } = await pool.query(
      `SELECT id, title, slug, subtitle, status, thumbnail_image_path, display_order
       FROM projects
       WHERE component_id = $1 AND is_active = true
       ORDER BY display_order ASC`,
      [req.params.id],
    );
    const result = { ...comps[0], projects };
    await redis.set(cacheKey, JSON.stringify(result), { EX: 86400 });
    return res.json(result);
  } catch (err) {
    console.error("projectComponents.getById:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ errors: errors.array() });
  try {
    const { rows } = await pool.query(
      `INSERT INTO project_components
         (component_number, label, name, description, icon_name,
          stat1_label, stat1_value, stat2_label, stat2_value,
          stat3_label, stat3_value, stat4_label, stat4_value,
          objectives, display_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      componentFields(req.body),
    );
    await redis.del(CACHE_ALL);
    await updateLastUpdated();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("projectComponents.create:", err.message);
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
    const { rows } = await pool.query(
      `UPDATE project_components SET
         component_number=$1, label=$2, name=$3, description=$4, icon_name=$5,
         stat1_label=$6, stat1_value=$7, stat2_label=$8, stat2_value=$9,
         stat3_label=$10, stat3_value=$11, stat4_label=$12, stat4_value=$13,
         objectives=$14, display_order=$15, is_active=$16, updated_at=NOW()
       WHERE id=$17
       RETURNING *`,
      [...componentFields(req.body), req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    await Promise.all([
      redis.del(CACHE_ALL),
      redis.del(`cache:project-component:${req.params.id}`),
    ]);
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("projectComponents.update:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });
  try {
    const { rows: assigned } = await pool.query(
      "SELECT COUNT(*) FROM projects WHERE component_id = $1",
      [req.params.id],
    );
    if (parseInt(assigned[0].count, 10) > 0) {
      return res.status(400).json({
        error:
          "Cannot delete component with assigned projects. Reassign or delete them first.",
      });
    }
    const { rows } = await pool.query(
      "DELETE FROM project_components WHERE id = $1 RETURNING id",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    await redis.del(CACHE_ALL);
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("projectComponents.remove:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const validators = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("component_number")
    .notEmpty()
    .withMessage("Component number is required")
    .isInt({ min: 1 })
    .withMessage("Component number must be a positive integer"),
];

module.exports = { getAll, getById, create, update, remove, validators };
