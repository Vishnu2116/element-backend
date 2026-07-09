const fs = require("fs");
const path = require("path");
const { validationResult, body } = require("express-validator");

const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THUMBNAILS_DIR = path.join(
  process.cwd(),
  "uploads",
  "projects",
  "thumbnails",
);
const GALLERY_DIR = path.join(process.cwd(), "uploads", "projects", "gallery");

fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
fs.mkdirSync(GALLERY_DIR, { recursive: true });

// ── helpers ────────────────────────────────────────────────────

function moveToThumbnails(file) {
  const dest = path.join(THUMBNAILS_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/projects/thumbnails/${file.filename}`;
}

function moveToGallery(file) {
  const dest = path.join(GALLERY_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/projects/gallery/${file.filename}`;
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

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

async function ensureUniqueSlug(base, excludeId = null) {
  let slug = base;
  let n = 2;
  while (true) {
    const { rows } = excludeId
      ? await pool.query(
          "SELECT id FROM projects WHERE slug = $1 AND id != $2",
          [slug, excludeId],
        )
      : await pool.query("SELECT id FROM projects WHERE slug = $1", [slug]);
    if (!rows[0]) return slug;
    slug = `${base}-${n++}`;
  }
}

function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return val === "true" || val === true;
}

async function bustProjectCaches(slug, componentId) {
  const keys = [
    "cache:projects",
    "cache:home:project-highlights",
    "cache:home:whats-new",
  ];
  if (slug) keys.push(`cache:project:${slug}`);
  if (componentId) keys.push(`cache:project-component:${componentId}`);
  await Promise.all(keys.map((k) => redis.del(k)));
}

// ── GET /api/projects (public, cached when no limit) ───────────
const getAll = async (req, res) => {
  const limitRaw = req.query.limit ? parseInt(req.query.limit, 10) : null;
  const useLimit = limitRaw !== null && !isNaN(limitRaw) && limitRaw > 0;

  try {
    if (!useLimit) {
      const cached = await redis.get("cache:projects");
      if (cached) return res.json(JSON.parse(cached));
    }

    const { rows } = await pool.query(
      `SELECT id, component_id, title, slug, thumbnail_image_path,
                description, bullet_points, display_order, is_active,
                created_at, updated_at
         FROM projects
         WHERE is_active = true
         ORDER BY created_at DESC
         ${useLimit ? "LIMIT $1" : ""}`,
      useLimit ? [limitRaw] : [],
    );

    if (!useLimit) {
      await redis.set("cache:projects", JSON.stringify(rows), { EX: 86400 });
    }
    return res.json(rows);
  } catch (err) {
    console.error("projects.getAll:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/projects/:slug (public, cached) ───────────────────
const getBySlug = async (req, res) => {
  const { slug } = req.params;
  if (!slug) return res.status(400).json({ error: "Slug is required" });

  const cacheKey = `cache:project:${slug}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const { rows: projectRows } = await pool.query(
      `SELECT id, component_id, title, slug, thumbnail_image_path,
                description, bullet_points, display_order, is_active,
                created_at, updated_at
         FROM projects
         WHERE slug = $1 AND is_active = true`,
      [slug],
    );
    if (!projectRows[0])
      return res.status(404).json({ error: "Project not found" });

    const project = projectRows[0];

    const [{ rows: galleryRows }, { rows: componentRows }] = await Promise.all([
      pool.query(
        "SELECT * FROM project_gallery WHERE project_id = $1 ORDER BY display_order ASC",
        [project.id],
      ),
      project.component_id
        ? pool.query(
            "SELECT id, name, label, component_number FROM project_components WHERE id = $1",
            [project.component_id],
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const result = {
      ...project,
      gallery: galleryRows,
      component: componentRows[0] || null,
    };
    await redis.set(cacheKey, JSON.stringify(result), { EX: 86400 });
    return res.json(result);
  } catch (err) {
    console.error("projects.getBySlug:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/home/project-highlights (public, cached) ──────────
const getHighlights = async (req, res) => {
  const cacheKey = "cache:home:project-highlights";
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      `SELECT p.id, p.component_id, p.title, p.slug, p.thumbnail_image_path,
                p.description, p.bullet_points, p.display_order, p.is_active,
                p.created_at, p.updated_at,
                pc.label AS component_label,
                pc.name  AS component_name
         FROM projects p
         LEFT JOIN project_components pc ON p.component_id = pc.id
         WHERE p.is_active = true
         ORDER BY p.created_at DESC
         LIMIT 5`,
    );
    await redis.set(cacheKey, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error("projects.getHighlights:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── GET /api/admin/projects (admin, no cache) ──────────────────
const getAllAdmin = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.component_id, p.title, p.slug, p.thumbnail_image_path,
                p.description, p.bullet_points, p.display_order, p.is_active,
                p.created_at, p.updated_at,
                pc.name AS component_name, pc.label AS component_label
         FROM projects p
         LEFT JOIN project_components pc ON p.component_id = pc.id
         ORDER BY p.created_at DESC`,
    );
    return res.json(rows);
  } catch (err) {
    console.error("projects.getAllAdmin:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── POST /api/admin/projects ───────────────────────────────────
const create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(422).json({ errors: errors.array() });
  }

  const thumbnailPath = req.file ? moveToThumbnails(req.file) : null;

  try {
    const {
      title,
      component_id,
      description,
      display_order,
      is_active,
      // Removed (dropped in migration 011_simplify_projects.sql):
      // subtitle, status, objective, beneficiaries, timeline_start,
      // timeline_end, coverage, about, community_impact,
      // livelihood_opportunities, landscape_development_benefits,
      // area_covered, households, districts
    } = req.body;

    const baseSlug = generateSlug(title);
    const slug = await ensureUniqueSlug(baseSlug);
    const bulletPoints = Array.isArray(req.body.bullet_points)
      ? req.body.bullet_points
      : safeParseJSON(req.body.bullet_points, []);
    // const keyActivities = safeParseJSON(req.body.key_activities, []);
    // const expectedOutcomes = safeParseJSON(req.body.expected_outcomes, []);

    const { rows } = await pool.query(
      `INSERT INTO projects
           (component_id, title, slug, thumbnail_image_path,
            description, bullet_points, display_order, is_active)
         VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
      [
        component_id || null,
        title.trim(),
        slug,
        thumbnailPath,
        description || null,
        JSON.stringify(bulletPoints),
        display_order != null ? parseInt(display_order, 10) : 0,
        toBool(is_active, true),
      ],
    );

    await bustProjectCaches(null, component_id || null);
    await updateLastUpdated();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("projects.create:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── PUT /api/admin/projects/:id ────────────────────────────────
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
      "SELECT * FROM projects WHERE id = $1",
      [req.params.id],
    );
    if (!existing[0]) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Not found" });
    }

    const prev = existing[0];

    let thumbnailPath = prev.thumbnail_image_path;
    if (req.file) {
      removeFile(prev.thumbnail_image_path);
      thumbnailPath = moveToThumbnails(req.file);
    }

    const {
      title,
      component_id,
      description,
      display_order,
      is_active,
      // Removed (dropped in migration 011_simplify_projects.sql):
      // subtitle, status, objective, beneficiaries, timeline_start,
      // timeline_end, coverage, about, community_impact,
      // livelihood_opportunities, landscape_development_benefits,
      // area_covered, households, districts
    } = req.body;

    // Regenerate slug only when title changes
    let slug = prev.slug;
    if (title && title.trim() !== prev.title) {
      slug = await ensureUniqueSlug(generateSlug(title), req.params.id);
    }

    const bulletPoints =
      req.body.bullet_points !== undefined
        ? Array.isArray(req.body.bullet_points)
          ? req.body.bullet_points
          : safeParseJSON(req.body.bullet_points, [])
        : prev.bullet_points;
    // const keyActivities =
    //   req.body.key_activities !== undefined
    //     ? safeParseJSON(req.body.key_activities, [])
    //     : prev.key_activities;
    // const expectedOutcomes =
    //   req.body.expected_outcomes !== undefined
    //     ? safeParseJSON(req.body.expected_outcomes, [])
    //     : prev.expected_outcomes;

    const finalComponentId =
      component_id !== undefined ? component_id || null : prev.component_id;

    const { rows } = await pool.query(
      `UPDATE projects SET
           component_id=$1, title=$2, slug=$3, thumbnail_image_path=$4,
           description=$5, bullet_points=$6, display_order=$7,
           is_active=$8, updated_at=NOW()
         WHERE id=$9
         RETURNING *`,
      [
        finalComponentId,
        title?.trim() ?? prev.title,
        slug,
        thumbnailPath,
        description !== undefined ? description || null : prev.description,
        JSON.stringify(bulletPoints),
        display_order != null
          ? parseInt(display_order, 10)
          : prev.display_order,
        is_active !== undefined
          ? toBool(is_active, prev.is_active)
          : prev.is_active,
        req.params.id,
      ],
    );

    // Invalidate old and new cache keys (handles slug change + component change)
    const affectedComponents = new Set(
      [prev.component_id, finalComponentId].filter(Boolean),
    );
    const keys = [
      "cache:projects",
      "cache:home:project-highlights",
      "cache:home:whats-new",
      `cache:project:${prev.slug}`,
      `cache:project:${slug}`,
      ...[...affectedComponents].map((cid) => `cache:project-component:${cid}`),
    ];
    await Promise.all(keys.map((k) => redis.del(k)));
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("projects.update:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── DELETE /api/admin/projects/:id ─────────────────────────────
const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Not found" });

  try {
    const { rows: projectRows } = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [req.params.id],
    );
    if (!projectRows[0]) return res.status(404).json({ error: "Not found" });

    const project = projectRows[0];

    const { rows: galleryRows } = await pool.query(
      "SELECT image_path FROM project_gallery WHERE project_id = $1",
      [req.params.id],
    );

    // DB delete (ON DELETE CASCADE removes gallery rows automatically)
    await pool.query("DELETE FROM projects WHERE id = $1", [req.params.id]);

    // Disk cleanup
    removeFile(project.thumbnail_image_path);
    for (const img of galleryRows) removeFile(img.image_path);

    // Cache invalidation
    const keys = [
      "cache:projects",
      "cache:home:project-highlights",
      "cache:home:whats-new",
      `cache:project:${project.slug}`,
    ];
    if (project.component_id)
      keys.push(`cache:project-component:${project.component_id}`);
    await Promise.all(keys.map((k) => redis.del(k)));
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("projects.remove:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── POST /api/admin/projects/:id/gallery ───────────────────────
const addGalleryImage = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) {
    if (req.files) req.files.forEach((f) => fs.unlink(f.path, () => {}));
    return res.status(404).json({ error: "Not found" });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(422).json({ error: "No images uploaded" });
  }

  try {
    const { rows: projectRows } = await pool.query(
      "SELECT id, slug FROM projects WHERE id = $1",
      [req.params.id],
    );
    if (!projectRows[0]) {
      req.files.forEach((f) => fs.unlink(f.path, () => {}));
      return res.status(404).json({ error: "Project not found" });
    }

    // Get current max display_order for sequential ordering
    const { rows: maxRows } = await pool.query(
      "SELECT COALESCE(MAX(display_order), -1) AS max_order FROM project_gallery WHERE project_id = $1",
      [req.params.id],
    );
    const baseOrder = maxRows[0].max_order + 1;

    // Move files and build batch insert
    const imagePaths = req.files.map((f) => moveToGallery(f));
    const values = imagePaths
      .map((_, i) => `($1, $${i + 2}, $${imagePaths.length + i + 2})`)
      .join(", ");
    const params = [
      req.params.id,
      ...imagePaths,
      ...imagePaths.map((_, i) => baseOrder + i),
    ];

    const { rows } = await pool.query(
      `INSERT INTO project_gallery (project_id, image_path, display_order)
         VALUES ${values}
         RETURNING *`,
      params,
    );

    await redis.del(`cache:project:${projectRows[0].slug}`);
    await updateLastUpdated();
    return res.status(201).json(rows);
  } catch (err) {
    console.error("projects.addGalleryImage:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── DELETE /api/admin/projects/gallery/:imageId ────────────────
const removeGalleryImage = async (req, res) => {
  if (!UUID_REGEX.test(req.params.imageId)) {
    return res.status(404).json({ error: "Gallery image not found" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT pg.*, p.slug
         FROM project_gallery pg
         JOIN projects p ON pg.project_id = p.id
         WHERE pg.id = $1`,
      [req.params.imageId],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Gallery image not found" });

    await pool.query("DELETE FROM project_gallery WHERE id = $1", [
      req.params.imageId,
    ]);

    removeFile(rows[0].image_path);
    await redis.del(`cache:project:${rows[0].slug}`);
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("projects.removeGalleryImage:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const titleRequired = body("title")
  .trim()
  .notEmpty()
  .withMessage("Title is required");
const componentRequired = body("component_id")
  .notEmpty()
  .withMessage("Component ID is required");
const descriptionOptional = body("description")
  .optional({ nullable: true, checkFalsy: true })
  .isString()
  .withMessage("Description must be a string");
const bulletPointsOptional = body("bullet_points")
  .optional({ nullable: true, checkFalsy: true })
  .custom((value) => {
    let arr = value;
    if (typeof arr === "string") {
      try {
        arr = JSON.parse(arr);
      } catch {
        throw new Error("Bullet points must be a valid JSON array");
      }
    }
    if (!Array.isArray(arr)) {
      throw new Error("Bullet points must be an array");
    }
    if (!arr.every((item) => typeof item === "string" && item.trim() !== "")) {
      throw new Error("Each bullet point must be a non-empty string");
    }
    return true;
  });

module.exports = {
  getAll,
  getBySlug,
  getHighlights,
  getAllAdmin,
  create,
  update,
  remove,
  addGalleryImage,
  removeGalleryImage,
  titleRequired,
  componentRequired,
  descriptionOptional,
  bulletPointsOptional,
};
