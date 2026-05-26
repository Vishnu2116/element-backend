const pool  = require('../config/db');
const redis = require('../config/redis');

const SESSION_MINUTES = parseInt(process.env.VISITOR_SESSION_MINUTES || '15', 10);
const MAX_AGE_SECONDS = SESSION_MINUTES * 60;
const CACHE_KEY = 'cache:visitor:count';

const track = async (req, res) => {
  try {
    const hasVisited = req.cookies && req.cookies.element_visitor;

    if (hasVisited) {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return res.json({ count: parseInt(cached, 10) });

      const { rows } = await pool.query(
        'SELECT total_count FROM visitor_stats LIMIT 1'
      );
      const count = rows[0] ? parseInt(rows[0].total_count, 10) : 0;
      await redis.set(CACHE_KEY, count.toString(), { EX: MAX_AGE_SECONDS });
      return res.json({ count });
    }

    const { rows } = await pool.query(
      `UPDATE visitor_stats
       SET total_count = total_count + 1,
           updated_at = NOW()
       WHERE id = (SELECT id FROM visitor_stats LIMIT 1)
       RETURNING total_count`
    );
    const count = rows[0] ? parseInt(rows[0].total_count, 10) : 0;

    await redis.set(CACHE_KEY, count.toString(), { EX: MAX_AGE_SECONDS });

    res.cookie('element_visitor', '1', {
      maxAge: MAX_AGE_SECONDS * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    });

    return res.json({ count });
  } catch (err) {
    console.error('visitor.track:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getCount = async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.json({ count: parseInt(cached, 10) });

    const { rows } = await pool.query(
      'SELECT total_count FROM visitor_stats LIMIT 1'
    );
    const count = rows[0] ? parseInt(rows[0].total_count, 10) : 0;
    await redis.set(CACHE_KEY, count.toString(), { EX: MAX_AGE_SECONDS });
    return res.json({ count });
  } catch (err) {
    console.error('visitor.getCount:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { track, getCount };
