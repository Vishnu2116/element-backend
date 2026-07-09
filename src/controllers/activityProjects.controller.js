const fs = require("fs");
const path = require("path");

const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGES_DIR = path.join(
  process.cwd(),
  "uploads",
  "activity-projects",
  "images",
);

fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ── helpers ────────────────────────────────────────────────────

function moveToImages(file) {
  const dest = path.join(IMAGES_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/activity-projects/images/${file.filename}`;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}

function safeParseJSON(str, fallback = []) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
}

function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return val === "true" || val === true;
}

async function bustActivityCaches(projectId) {
  const keys = ["cache:activity-projects:list"];
  if (projectId) keys.push(`cache:activity-projects:detail:${projectId}`);
  await Promise.all(keys.map((k) => redis.del(k)));
}

// ── GET /api/activities/projects (public, cached) ───────────────
const getPublicList = async (req, res) => {
  const cacheKey = "cache:activity-projects:list";
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.slug, p.thumbnail_image_path
         FROM projects p
         INNER JOIN activity_projects ap ON ap.project_id = p.id
         WHERE p.is_active = true AND ap.is_active = true
         ORDER BY p.display_order ASC`,
    );
    await redis.set(cacheKey, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error("activityProjects.getPublicList:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/activities/projects/:projectId (public, cached) ───
const getPublicDetail = async (req, res) => {
  if (!UUID_REGEX.test(req.params.projectId))
    return res.status(404).json({ error: "Not found" });

  const cacheKey = `cache:activity-projects:detail:${req.params.projectId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.slug, p.thumbnail_image_path,
                ap.id AS activity_project_id, ap.paragraph,
                ap.bullet_points, ap.stats
         FROM projects p
         INNER JOIN activity_projects ap ON ap.project_id = p.id
         WHERE p.id = $1 AND p.is_active = true AND ap.is_active = true`,
      [req.params.projectId],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });

    const row = rows[0];
    const { rows: images } = await pool.query(
      `SELECT id, image_path, display_order
         FROM activity_project_images
         WHERE activity_project_id = $1
         ORDER BY display_order ASC`,
      [row.activity_project_id],
    );

    const result = {
      project: {
        id: row.id,
        title: row.title,
        slug: row.slug,
        thumbnail_image_path: row.thumbnail_image_path,
      },
      paragraph: row.paragraph,
      bullet_points: row.bullet_points,
      stats: row.stats,
      images,
    };

    await redis.set(cacheKey, JSON.stringify(result), { EX: 86400 });
    return res.json(result);
  } catch (err) {
    console.error("activityProjects.getPublicDetail:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/admin/activity-projects (admin, no cache) ──────────
const getAllAdmin = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.slug, p.thumbnail_image_path, p.component_id,
                ap.id AS activity_project_id, ap.paragraph,
                ap.bullet_points, ap.stats,
                ap.is_active AS activity_is_active,
                (ap.id IS NOT NULL) AS has_activity_content
         FROM projects p
         LEFT JOIN activity_projects ap ON ap.project_id = p.id
         ORDER BY p.display_order ASC`,
    );
    return res.json(rows);
  } catch (err) {
    console.error("activityProjects.getAllAdmin:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/admin/activity-projects/:projectId (admin) ────────
const getAdminDetail = async (req, res) => {
  if (!UUID_REGEX.test(req.params.projectId))
    return res.status(404).json({ error: "Not found" });

  try {
    const { rows: projectRows } = await pool.query(
      "SELECT id, title, slug, thumbnail_image_path, component_id FROM projects WHERE id = $1",
      [req.params.projectId],
    );
    if (!projectRows[0])
      return res.status(404).json({ error: "Project not found" });

    const { rows: activityRows } = await pool.query(
      "SELECT * FROM activity_projects WHERE project_id = $1",
      [req.params.projectId],
    );
    const activity = activityRows[0] || null;

    let images = [];
    if (activity) {
      const { rows } = await pool.query(
        `SELECT id, image_path, display_order
           FROM activity_project_images
           WHERE activity_project_id = $1
           ORDER BY display_order ASC`,
        [activity.id],
      );
      images = rows;
    }

    return res.json({
      project: projectRows[0],
      paragraph: activity ? activity.paragraph : null,
      bullet_points: activity ? activity.bullet_points : [],
      stats: activity ? activity.stats : [],
      is_active: activity ? activity.is_active : true,
      images,
    });
  } catch (err) {
    console.error("activityProjects.getAdminDetail:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── PUT /api/admin/activity-projects/:projectId (admin, upsert) ─
const upsert = async (req, res) => {
  if (!UUID_REGEX.test(req.params.projectId))
    return res.status(404).json({ error: "Not found" });

  try {
    const { rows: projectRows } = await pool.query(
      "SELECT id FROM projects WHERE id = $1",
      [req.params.projectId],
    );
    if (!projectRows[0])
      return res.status(404).json({ error: "Project not found" });

    const { paragraph, is_active } = req.body;
    const bulletPoints = Array.isArray(req.body.bullet_points)
      ? req.body.bullet_points
      : safeParseJSON(req.body.bullet_points, []);
    const stats = Array.isArray(req.body.stats)
      ? req.body.stats
      : safeParseJSON(req.body.stats, []);

    const { rows: existing } = await pool.query(
      "SELECT id FROM activity_projects WHERE project_id = $1",
      [req.params.projectId],
    );

    const { rows } = existing[0]
      ? await pool.query(
          `UPDATE activity_projects SET
               paragraph=$1, bullet_points=$2, stats=$3, is_active=$4, updated_at=NOW()
             WHERE project_id=$5
             RETURNING *`,
          [
            paragraph || null,
            JSON.stringify(bulletPoints),
            JSON.stringify(stats),
            toBool(is_active, true),
            req.params.projectId,
          ],
        )
      : await pool.query(
          `INSERT INTO activity_projects
               (project_id, paragraph, bullet_points, stats, is_active)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING *`,
          [
            req.params.projectId,
            paragraph || null,
            JSON.stringify(bulletPoints),
            JSON.stringify(stats),
            toBool(is_active, true),
          ],
        );

    await bustActivityCaches(req.params.projectId);
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("activityProjects.upsert:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── POST /api/admin/activity-projects/:projectId/images ────────
const addImages = async (req, res) => {
  if (!UUID_REGEX.test(req.params.projectId)) {
    if (req.files) req.files.forEach((f) => fs.unlink(f.path, () => {}));
    return res.status(404).json({ error: "Not found" });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(422).json({ error: "No images uploaded" });
  }

  try {
    let { rows: activityRows } = await pool.query(
      "SELECT id FROM activity_projects WHERE project_id = $1",
      [req.params.projectId],
    );

    if (!activityRows[0]) {
      const { rows: projectRows } = await pool.query(
        "SELECT id FROM projects WHERE id = $1",
        [req.params.projectId],
      );
      if (!projectRows[0]) {
        req.files.forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(404).json({ error: "Project not found" });
      }

      // No activity_projects row yet — auto-create an empty one so
      // images can be uploaded before paragraph/bullet_points/stats exist.
      const { rows: created } = await pool.query(
        `INSERT INTO activity_projects
             (project_id, paragraph, bullet_points, stats, is_active)
           VALUES ($1, NULL, '[]'::jsonb, '[]'::jsonb, true)
           RETURNING id`,
        [req.params.projectId],
      );
      activityRows = created;
    }
    const activityProjectId = activityRows[0].id;

    // Get current max display_order for sequential ordering
    const { rows: maxRows } = await pool.query(
      "SELECT COALESCE(MAX(display_order), -1) AS max_order FROM activity_project_images WHERE activity_project_id = $1",
      [activityProjectId],
    );
    const baseOrder = maxRows[0].max_order + 1;

    // Move files and build batch insert
    const imagePaths = req.files.map((f) => moveToImages(f));
    const values = imagePaths
      .map((_, i) => `($1, $${i + 2}, $${imagePaths.length + i + 2})`)
      .join(", ");
    const params = [
      activityProjectId,
      ...imagePaths,
      ...imagePaths.map((_, i) => baseOrder + i),
    ];

    const { rows } = await pool.query(
      `INSERT INTO activity_project_images (activity_project_id, image_path, display_order)
         VALUES ${values}
         RETURNING *`,
      params,
    );

    await bustActivityCaches(req.params.projectId);
    await updateLastUpdated();
    return res.status(201).json(rows);
  } catch (err) {
    console.error("activityProjects.addImages:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── DELETE /api/admin/activity-projects/images/:imageId ────────
const removeImage = async (req, res) => {
  if (!UUID_REGEX.test(req.params.imageId)) {
    return res.status(404).json({ error: "Image not found" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT api.*, ap.project_id
         FROM activity_project_images api
         JOIN activity_projects ap ON api.activity_project_id = ap.id
         WHERE api.id = $1`,
      [req.params.imageId],
    );
    if (!rows[0]) return res.status(404).json({ error: "Image not found" });

    await pool.query("DELETE FROM activity_project_images WHERE id = $1", [
      req.params.imageId,
    ]);

    removeFile(rows[0].image_path);
    await bustActivityCaches(rows[0].project_id);
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("activityProjects.removeImage:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getPublicList,
  getPublicDetail,
  getAllAdmin,
  getAdminDetail,
  upsert,
  addImages,
  removeImage,
};
