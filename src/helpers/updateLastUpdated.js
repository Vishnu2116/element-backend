const pool = require('../config/db');

const updateLastUpdated = async () => {
  try {
    await pool.query(
      `UPDATE site_settings
       SET last_updated_at = NOW()
       WHERE id = (SELECT id FROM site_settings LIMIT 1)`
    );
  } catch (err) {
    console.error('updateLastUpdated error:', err.message);
  }
};

module.exports = updateLastUpdated;
