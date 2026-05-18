const { validationResult, body } = require('express-validator');

const pool  = require('../config/db');
const redis = require('../config/redis');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CACHE_KEY = 'cache:official-categories';

async function bustCache() {
  await redis.del(CACHE_KEY);
}

// ── GET /api/admin/official-categories (admin) ─────────────────
const getAll = async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      'SELECT * FROM official_categories ORDER BY display_order ASC'
    );
    await redis.set(CACHE_KEY, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error('officialCategories.getAll:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /api/admin/official-categories ────────────────────────
const create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, display_order } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO official_categories (name, display_order)
       VALUES ($1, $2)
       RETURNING *`,
      [name.trim(), display_order != null ? parseInt(display_order, 10) : 0]
    );
    await bustCache();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('officialCategories.create:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /api/admin/official-categories/:id ─────────────────────
const update = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Category not found' });
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, display_order } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE official_categories
       SET name = $1, display_order = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [name.trim(), display_order != null ? parseInt(display_order, 10) : 0, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Category not found' });

    await bustCache();
    return res.json(rows[0]);
  } catch (err) {
    console.error('officialCategories.update:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /api/admin/official-categories/:id ──────────────────
const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Category not found' });
  try {
    const { rows: assigned } = await pool.query(
      'SELECT COUNT(*) FROM officials WHERE category_id = $1',
      [req.params.id]
    );
    if (parseInt(assigned[0].count, 10) > 0) {
      return res.status(400).json({
        error: 'Cannot delete category with assigned officials. Reassign them first.',
      });
    }

    const { rows } = await pool.query(
      'DELETE FROM official_categories WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Category not found' });

    await bustCache();
    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('officialCategories.remove:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const nameRequired = body('name').trim().notEmpty().withMessage('Name is required');

module.exports = { getAll, create, update, remove, nameRequired };
