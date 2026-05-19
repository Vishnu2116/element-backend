const fs   = require('fs');
const path = require('path');

const pool  = require('../config/db');
const redis = require('../config/redis');

const UUID_REGEX  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_KEY   = 'cache:media:gallery';
const GALLERY_DIR = path.join(process.cwd(), 'uploads', 'gallery');

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

// ── GET /api/media/gallery (public, cached) ────────────────────
const getAll = async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(`
      SELECT id, image_path, caption, display_order, created_at,
             NULL::uuid AS event_id,
             NULL::text AS event_title
      FROM gallery_images
      WHERE is_active = true
      UNION ALL
      SELECT ei.id, ei.image_path, ei.caption, ei.display_order, ei.created_at,
             e.id  AS event_id,
             e.title AS event_title
      FROM event_images ei
      JOIN events e ON ei.event_id = e.id
      WHERE ei.show_in_gallery = true
        AND e.is_active = true
      ORDER BY created_at DESC
    `);

    await redis.set(CACHE_KEY, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error('gallery.getAll:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /api/admin/gallery (admin) ────────────────────────────
const create = async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(422).json({ error: 'No images uploaded' });
  }

  try {
    const { rows: maxRows } = await pool.query(
      'SELECT COALESCE(MAX(display_order), -1) AS max_order FROM gallery_images'
    );
    const baseOrder = maxRows[0].max_order + 1;

    const imagePaths = req.files.map(f => moveToGallery(f));
    const values = imagePaths.map((_, i) => `($${i + 1}, $${imagePaths.length + i + 1})`).join(', ');
    const params = [...imagePaths, ...imagePaths.map((_, i) => baseOrder + i)];

    const { rows } = await pool.query(
      `INSERT INTO gallery_images (image_path, display_order) VALUES ${values} RETURNING *`,
      params
    );

    await redis.del(CACHE_KEY);
    return res.status(201).json(rows);
  } catch (err) {
    console.error('gallery.create:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /api/admin/gallery/:id (admin) ──────────────────────
const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await pool.query(
      'DELETE FROM gallery_images WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    removeFile(rows[0].image_path);
    await redis.del(CACHE_KEY);
    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('gallery.remove:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { getAll, create, remove };
