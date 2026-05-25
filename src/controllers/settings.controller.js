const pool  = require('../config/db');
const redis = require('../config/redis');

const CACHE_KEY = 'cache:site-settings';

async function bustCache() {
  await Promise.all([
    redis.del(CACHE_KEY),
    redis.del('cache:home:last-updated'),
  ]);
}

// ── GET /api/settings (public, cached) ────────────────────────
const get = async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query('SELECT * FROM site_settings LIMIT 1');
    const record = rows[0] || null;

    await redis.set(CACHE_KEY, JSON.stringify(record), { EX: 86400 });
    return res.json(record);
  } catch (err) {
    console.error('settings.get:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/admin/settings (admin, no cache) ──────────────────
const getAdmin = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM site_settings LIMIT 1');
    return res.json(rows[0] || null);
  } catch (err) {
    console.error('settings.getAdmin:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /api/admin/settings (admin) ───────────────────────────
const update = async (req, res) => {
  const {
    website_title,
    office_address,
    contact_email,
    contact_phone,
    helpline_number,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE site_settings SET
         website_title   = COALESCE($1, website_title),
         office_address  = COALESCE($2, office_address),
         contact_email   = COALESCE($3, contact_email),
         contact_phone   = COALESCE($4, contact_phone),
         helpline_number = COALESCE($5, helpline_number),
         updated_at      = NOW()
       WHERE id = (SELECT id FROM site_settings LIMIT 1)
       RETURNING *`,
      [
        website_title   || null,
        office_address  || null,
        contact_email   || null,
        contact_phone   || null,
        helpline_number || null,
      ]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Settings record not found' });

    await bustCache();
    return res.json(rows[0]);
  } catch (err) {
    console.error('settings.update:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { get, getAdmin, update };
