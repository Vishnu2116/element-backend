const { validationResult, body } = require("express-validator");
const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_KEY = "cache:media:social";

function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return val === "true" || val === true;
}

const get = async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));
    const [{ rows: embedRows }, { rows: videoRows }] = await Promise.all([
      pool.query("SELECT * FROM social_media_embeds LIMIT 1"),
      pool.query(
        "SELECT * FROM youtube_videos WHERE is_active = true ORDER BY display_order ASC",
      ),
    ]);
    const result = { embeds: embedRows[0] || null, videos: videoRows };
    await redis.set(CACHE_KEY, JSON.stringify(result), { EX: 86400 });
    return res.json(result);
  } catch (err) {
    console.error("socialMedia.get:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const updateEmbeds = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ errors: errors.array() });

  const { facebook_embed_code, twitter_embed_code } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE social_media_embeds
       SET facebook_embed_code = $1,
           twitter_embed_code  = $2,
           updated_at          = NOW()
       WHERE id = (SELECT id FROM social_media_embeds LIMIT 1)
       RETURNING *`,
      [facebook_embed_code || null, twitter_embed_code || null],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Social media record not found" });
    await redis.del(CACHE_KEY);
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("socialMedia.updateEmbeds:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const addVideo = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ errors: errors.array() });
  try {
    const { rows: maxRows } = await pool.query(
      "SELECT COALESCE(MAX(display_order), -1) AS max_order FROM youtube_videos",
    );
    const display_order = maxRows[0].max_order + 1;
    const { title, youtube_url, is_active } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO youtube_videos (title, youtube_url, display_order, is_active)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [
        title || null,
        youtube_url.trim(),
        display_order,
        toBool(is_active, true),
      ],
    );
    await redis.del(CACHE_KEY);
    await updateLastUpdated();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("socialMedia.addVideo:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const updateVideo = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Video not found" });
  try {
    const { rows: existing } = await pool.query(
      "SELECT * FROM youtube_videos WHERE id = $1",
      [req.params.id],
    );
    if (!existing[0]) return res.status(404).json({ error: "Video not found" });
    const prev = existing[0];
    const { title, youtube_url, display_order, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE youtube_videos SET
         title         = $1,
         youtube_url   = $2,
         display_order = $3,
         is_active     = $4
       WHERE id = $5
       RETURNING *`,
      [
        title !== undefined ? title || null : prev.title,
        youtube_url !== undefined ? youtube_url.trim() : prev.youtube_url,
        display_order != null
          ? parseInt(display_order, 10)
          : prev.display_order,
        is_active !== undefined
          ? toBool(is_active, prev.is_active)
          : prev.is_active,
        req.params.id,
      ],
    );
    await redis.del(CACHE_KEY);
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    console.error("socialMedia.updateVideo:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const removeVideo = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id))
    return res.status(404).json({ error: "Video not found" });
  try {
    const { rows } = await pool.query(
      "DELETE FROM youtube_videos WHERE id = $1 RETURNING id",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Video not found" });
    await redis.del(CACHE_KEY);
    await updateLastUpdated();
    return res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("socialMedia.removeVideo:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const videoValidators = [
  body("youtube_url").trim().notEmpty().withMessage("YouTube URL is required"),
];

const embedsValidators = [
  body("facebook_embed_code")
    .optional({ nullable: true, checkFalsy: true })
    .isLength({ max: 5000 })
    .withMessage("Facebook embed code must be 5000 characters or fewer"),
  body("twitter_embed_code")
    .optional({ nullable: true, checkFalsy: true })
    .isLength({ max: 5000 })
    .withMessage("Twitter embed code must be 5000 characters or fewer"),
];

module.exports = {
  get,
  updateEmbeds,
  addVideo,
  updateVideo,
  removeVideo,
  videoValidators,
  embedsValidators,
};
