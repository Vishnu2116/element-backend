const fs   = require('fs');
const path = require('path');
const { validationResult, body } = require('express-validator');

const pool  = require('../config/db');
const redis = require('../config/redis');

const UUID_REGEX    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COVERS_DIR    = path.join(process.cwd(), 'uploads', 'events', 'covers');
const EVENT_GAL_DIR = path.join(process.cwd(), 'uploads', 'events', 'gallery');

fs.mkdirSync(COVERS_DIR,    { recursive: true });
fs.mkdirSync(EVENT_GAL_DIR, { recursive: true });

// ── helpers ────────────────────────────────────────────────────

function moveToCover(file) {
  const dest = path.join(COVERS_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/events/covers/${file.filename}`;
}

function moveToEventGallery(file) {
  const dest = path.join(EVENT_GAL_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/events/gallery/${file.filename}`;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

async function ensureUniqueSlug(base, excludeId = null) {
  let slug = base;
  let n = 2;
  while (true) {
    const { rows } = excludeId
      ? await pool.query('SELECT id FROM events WHERE slug = $1 AND id != $2', [slug, excludeId])
      : await pool.query('SELECT id FROM events WHERE slug = $1', [slug]);
    if (!rows[0]) return slug;
    slug = `${base}-${n++}`;
  }
}

function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return val === 'true' || val === true;
}

// ── GET /api/media/events (public, cached) ─────────────────────
const getAll = async (req, res) => {
  try {
    const cached = await redis.get('cache:media:events');
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      'SELECT * FROM events WHERE is_active = true ORDER BY event_date DESC'
    );
    await redis.set('cache:media:events', JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error('events.getAll:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/media/events/:slug (public, cached) ───────────────
const getBySlug = async (req, res) => {
  const { slug } = req.params;
  if (!slug) return res.status(400).json({ error: 'Slug is required' });

  const cacheKey = `cache:media:event:${slug}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      `SELECT e.*,
              COALESCE(
                json_agg(ei.* ORDER BY ei.display_order)
                FILTER (WHERE ei.id IS NOT NULL),
                '[]'::json
              ) AS images
       FROM events e
       LEFT JOIN event_images ei ON e.id = ei.event_id
       WHERE e.slug = $1 AND e.is_active = true
       GROUP BY e.id`,
      [slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Event not found' });

    await redis.set(cacheKey, JSON.stringify(rows[0]), { EX: 86400 });
    return res.json(rows[0]);
  } catch (err) {
    console.error('events.getBySlug:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /api/admin/events (admin) ─────────────────────────────
const create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(422).json({ errors: errors.array() });
  }

  const coverPath = req.file ? moveToCover(req.file) : null;

  try {
    const { title, description, event_date, is_active } = req.body;
    const slug = await ensureUniqueSlug(generateSlug(title));

    const { rows } = await pool.query(
      `INSERT INTO events (title, slug, description, event_date, cover_image_path, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [title.trim(), slug, description || null, event_date, coverPath, toBool(is_active, true)]
    );

    await redis.del('cache:media:events');
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('events.create:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /api/admin/events/:id (admin) ──────────────────────────
const update = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Not found' });
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(422).json({ errors: errors.array() });
  }

  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM events WHERE id = $1',
      [req.params.id]
    );
    if (!existing[0]) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Not found' });
    }

    const prev = existing[0];
    let coverPath = prev.cover_image_path;
    if (req.file) {
      removeFile(prev.cover_image_path);
      coverPath = moveToCover(req.file);
    }

    const { title, description, event_date, is_active } = req.body;

    let slug = prev.slug;
    if (title && title.trim() !== prev.title) {
      slug = await ensureUniqueSlug(generateSlug(title), req.params.id);
    }

    const { rows } = await pool.query(
      `UPDATE events SET
         title             = $1,
         slug              = $2,
         description       = $3,
         event_date        = $4,
         cover_image_path  = $5,
         is_active         = $6,
         updated_at        = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        title?.trim()       ?? prev.title,
        slug,
        description !== undefined ? (description || null) : prev.description,
        event_date  !== undefined ? (event_date  || null) : prev.event_date,
        coverPath,
        is_active   !== undefined ? toBool(is_active, prev.is_active) : prev.is_active,
        req.params.id,
      ]
    );

    await Promise.all([
      redis.del('cache:media:events'),
      redis.del(`cache:media:event:${prev.slug}`),
      prev.slug !== slug ? redis.del(`cache:media:event:${slug}`) : Promise.resolve(),
    ]);
    return res.json(rows[0]);
  } catch (err) {
    console.error('events.update:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /api/admin/events/:id (admin) ───────────────────────
const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows: eventRows } = await pool.query(
      'SELECT * FROM events WHERE id = $1',
      [req.params.id]
    );
    if (!eventRows[0]) return res.status(404).json({ error: 'Not found' });

    const { rows: imageRows } = await pool.query(
      'SELECT image_path FROM event_images WHERE event_id = $1',
      [req.params.id]
    );

    // CASCADE handles DB rows; we handle disk
    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);

    removeFile(eventRows[0].cover_image_path);
    for (const img of imageRows) removeFile(img.image_path);

    await Promise.all([
      redis.del('cache:media:events'),
      redis.del(`cache:media:event:${eventRows[0].slug}`),
      redis.del('cache:media:gallery'),
    ]);
    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('events.remove:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /api/admin/events/:id/images (admin) ──────────────────
const addImages = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) {
    if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
    return res.status(404).json({ error: 'Not found' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(422).json({ error: 'No images uploaded' });
  }

  try {
    const { rows: eventRows } = await pool.query(
      'SELECT id, slug FROM events WHERE id = $1',
      [req.params.id]
    );
    if (!eventRows[0]) {
      req.files.forEach(f => fs.unlink(f.path, () => {}));
      return res.status(404).json({ error: 'Event not found' });
    }

    const { rows: maxRows } = await pool.query(
      'SELECT COALESCE(MAX(display_order), -1) AS max_order FROM event_images WHERE event_id = $1',
      [req.params.id]
    );
    const baseOrder  = maxRows[0].max_order + 1;
    const imagePaths = req.files.map(f => moveToEventGallery(f));

    const values = imagePaths.map((_, i) => `($1, $${i + 2}, $${imagePaths.length + i + 2})`).join(', ');
    const params = [req.params.id, ...imagePaths, ...imagePaths.map((_, i) => baseOrder + i)];

    const { rows } = await pool.query(
      `INSERT INTO event_images (event_id, image_path, display_order) VALUES ${values} RETURNING *`,
      params
    );

    await Promise.all([
      redis.del(`cache:media:event:${eventRows[0].slug}`),
      redis.del('cache:media:gallery'),
    ]);
    return res.status(201).json(rows);
  } catch (err) {
    console.error('events.addImages:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /api/admin/events/images/:id (admin) ────────────────
const removeImage = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await pool.query(
      `SELECT ei.*, e.slug
       FROM event_images ei
       JOIN events e ON ei.event_id = e.id
       WHERE ei.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Image not found' });

    await pool.query('DELETE FROM event_images WHERE id = $1', [req.params.id]);
    removeFile(rows[0].image_path);

    const cacheOps = [redis.del(`cache:media:event:${rows[0].slug}`)];
    if (rows[0].show_in_gallery) cacheOps.push(redis.del('cache:media:gallery'));
    await Promise.all(cacheOps);

    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('events.removeImage:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /api/admin/events/images/:id/toggle-gallery (admin) ────
const toggleGallery = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await pool.query(
      `WITH updated AS (
         UPDATE event_images
         SET show_in_gallery = NOT show_in_gallery
         WHERE id = $1
         RETURNING *
       )
       SELECT u.*, e.slug
       FROM updated u
       JOIN events e ON u.event_id = e.id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Image not found' });

    await Promise.all([
      redis.del(`cache:media:event:${rows[0].slug}`),
      redis.del('cache:media:gallery'),
    ]);

    const { slug, ...imageRecord } = rows[0];
    return res.json(imageRecord);
  } catch (err) {
    console.error('events.toggleGallery:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const createValidators = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('event_date').notEmpty().withMessage('Event date is required').isDate().withMessage('Invalid date'),
];
const updateValidators = [
  body('title').trim().notEmpty().withMessage('Title is required'),
];

module.exports = {
  getAll, getBySlug, create, update, remove,
  addImages, removeImage, toggleGallery,
  createValidators, updateValidators,
};
