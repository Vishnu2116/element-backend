const pool = require("../config/db");
const redis = require("../config/redis");

const CACHE_KEY = "cache:home:social-media";

async function bustCache() {
  await redis.del(CACHE_KEY);
}

const get = async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));
    const { rows } = await pool.query(
      "SELECT * FROM home_social_media LIMIT 1",
    );
    const record = rows[0] || null;
    await redis.set(CACHE_KEY, JSON.stringify(record), { EX: 86400 });
    return res.json(record);
  } catch (err) {
    console.error("homeSocialMedia.get:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const update = async (req, res) => {
  const {
    facebook_handle,
    facebook_url,
    twitter_handle,
    twitter_url,
    youtube_video_url,
    youtube_video_title,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE home_social_media SET
         facebook_handle     = $1,
         facebook_url        = $2,
         twitter_handle      = $3,
         twitter_url         = $4,
         youtube_video_url   = $5,
         youtube_video_title = $6,
         updated_at          = NOW()
       WHERE id = (SELECT id FROM home_social_media LIMIT 1)
       RETURNING *`,
      [
        facebook_handle || null,
        facebook_url || null,
        twitter_handle || null,
        twitter_url || null,
        youtube_video_url || null,
        youtube_video_title || null,
      ],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Social media record not found" });
    await bustCache();
    return res.json(rows[0]);
  } catch (err) {
    console.error("homeSocialMedia.update:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { get, update };
