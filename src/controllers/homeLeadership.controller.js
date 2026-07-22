const fs = require("fs");
const path = require("path");

const pool = require("../config/db");
const redis = require("../config/redis");
const updateLastUpdated = require("../helpers/updateLastUpdated");
const { verifyFileSignature } = require("../helpers/verifyFileSignature");

const CACHE_KEY = "cache:home:leadership";
const LEADERSHIP_DIR = path.join(process.cwd(), "uploads", "home-leadership");

fs.mkdirSync(LEADERSHIP_DIR, { recursive: true });

function moveToLeadership(file) {
  const dest = path.join(LEADERSHIP_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/home-leadership/${file.filename}`;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}

async function bustCache() {
  await redis.del(CACHE_KEY);
}

// ── GET /api/home/leadership (public, cached) ──────────────────
// Always returns 4 rows; empty slots have null fields
const getAll = async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(`
        SELECT
          gs.slot_number,
          hl.id,
          hl.name,
          hl.designation,
          hl.organisation,
          hl.photo_path,
          hl.created_at,
          hl.updated_at
        FROM generate_series(1, 4) AS gs(slot_number)
        LEFT JOIN home_leadership hl ON hl.slot_number = gs.slot_number
        ORDER BY gs.slot_number
      `);

    await redis.set(CACHE_KEY, JSON.stringify(rows), { EX: 86400 });
    return res.json(rows);
  } catch (err) {
    console.error("homeLeadership.getAll:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── PUT /api/admin/home-leadership/:slot ───────────────────────
const updateSlot = async (req, res) => {
  const slotNumber = parseInt(req.params.slot, 10);

  if (isNaN(slotNumber) || slotNumber < 1 || slotNumber > 4) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res
      .status(400)
      .json({ error: "Slot number must be between 1 and 4" });
  }

  const { name, designation, organisation } = req.body;

  if (!name || !name.trim()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(422).json({ error: "name is required" });
  }

  if (req.file) {
    const validSignature = await verifyFileSignature(req.file.path, "image");
    if (!validSignature) {
      fs.unlink(req.file.path, () => {});
      return res.status(422).json({ error: "File content does not match its extension" });
    }
  }

  try {
    // Fetch existing record so we can delete the old photo if replaced
    const { rows: existing } = await pool.query(
      "SELECT photo_path FROM home_leadership WHERE slot_number = $1",
      [slotNumber],
    );

    const oldPhotoPath = existing[0]?.photo_path || null;

    let photoPath = oldPhotoPath;
    if (req.file) {
      photoPath = moveToLeadership(req.file);
    }

    const { rows } = await pool.query(
      `INSERT INTO home_leadership (slot_number, name, designation, organisation, photo_path)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (slot_number) DO UPDATE SET
           name         = EXCLUDED.name,
           designation  = EXCLUDED.designation,
           organisation = EXCLUDED.organisation,
           photo_path   = EXCLUDED.photo_path,
           updated_at   = NOW()
         RETURNING *`,
      [
        slotNumber,
        name.trim(),
        designation || null,
        organisation || null,
        photoPath,
      ],
    );

    if (req.file && oldPhotoPath) removeFile(oldPhotoPath);

    await bustCache();
    await updateLastUpdated();
    return res.json(rows[0]);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error("homeLeadership.updateSlot:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { getAll, updateSlot };
