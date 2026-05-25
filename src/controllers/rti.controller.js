const fs   = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');

const pool  = require('../config/db');
const redis = require('../config/redis');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_OFFICER_TYPES = [
  'public_information_officer',
  'first_appellate_officer',
];

const RTI_DIR = path.join(process.cwd(), 'uploads', 'rti');
fs.mkdirSync(RTI_DIR, { recursive: true });

function moveToRti(file) {
  const dest = path.join(RTI_DIR, file.filename);
  fs.renameSync(file.path, dest);
  return `/uploads/rti/${file.filename}`;
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(path.join(process.cwd(), filePath), () => {});
}

function toBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return val === 'true' || val === true;
}

async function bustCache() {
  await redis.del('cache:rti');
}

// ── GET /api/rti (public, cached) ──────────────────────────────
const get = async (req, res) => {
  const cacheKey = 'cache:rti';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [officersResult, documentsResult] = await Promise.all([
      pool.query(
        `SELECT * FROM rti_officers
         WHERE is_active = true
         ORDER BY officer_type ASC, display_order ASC`
      ),
      pool.query(
        `SELECT * FROM rti_documents
         WHERE is_active = true
         ORDER BY display_order ASC`
      ),
    ]);

    const result = {
      officers:  officersResult.rows,
      documents: documentsResult.rows,
    };

    await redis.set(cacheKey, JSON.stringify(result), { EX: 86400 });
    return res.json(result);
  } catch (err) {
    console.error('rti.get:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /api/admin/rti/officers (admin) ───────────────────────
const createOfficer = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  try {
    const {
      officer_type, name, designation, address,
      phone, email, display_order, is_active,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO rti_officers
         (officer_type, name, designation, address,
          phone, email, display_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        officer_type,
        name.trim(),
        designation   || null,
        address       || null,
        phone         || null,
        email         || null,
        display_order != null ? parseInt(display_order, 10) : 0,
        toBool(is_active, true),
      ]
    );

    await bustCache();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('rti.createOfficer:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /api/admin/rti/officers/:id (admin) ────────────────────
const updateOfficer = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM rti_officers WHERE id = $1',
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    const prev = existing[0];
    const {
      name, designation, address, phone,
      email, display_order, is_active,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE rti_officers SET
         name          = $1,
         designation   = $2,
         address       = $3,
         phone         = $4,
         email         = $5,
         display_order = $6,
         is_active     = $7,
         updated_at    = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        name?.trim()  ?? prev.name,
        designation   !== undefined ? (designation || null) : prev.designation,
        address       !== undefined ? (address     || null) : prev.address,
        phone         !== undefined ? (phone       || null) : prev.phone,
        email         !== undefined ? (email       || null) : prev.email,
        display_order != null ? parseInt(display_order, 10) : prev.display_order,
        is_active !== undefined ? toBool(is_active, prev.is_active) : prev.is_active,
        req.params.id,
      ]
    );

    await bustCache();
    return res.json(rows[0]);
  } catch (err) {
    console.error('rti.updateOfficer:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /api/admin/rti/officers/:id (admin) ─────────────────
const deleteOfficer = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await pool.query(
      'DELETE FROM rti_officers WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    await bustCache();
    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('rti.deleteOfficer:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /api/admin/rti/documents (admin) ──────────────────────
const createDocument = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(422).json({ errors: errors.array() });
  }

  const filePath   = req.file ? moveToRti(req.file) : null;
  const fileSizeKB = req.file ? Math.round(req.file.size / 1024) : null;

  try {
    const { title, display_order, is_active } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO rti_documents
         (title, file_path, file_size, file_type, display_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        title.trim(),
        filePath,
        fileSizeKB,
        filePath ? 'PDF' : null,
        display_order != null ? parseInt(display_order, 10) : 0,
        toBool(is_active, true),
      ]
    );

    await bustCache();
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('rti.createDocument:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /api/admin/rti/documents/:id (admin) ───────────────────
const updateDocument = async (req, res) => {
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
      'SELECT * FROM rti_documents WHERE id = $1',
      [req.params.id]
    );
    if (!existing[0]) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Not found' });
    }

    const prev = existing[0];
    let filePath   = prev.file_path;
    let fileSizeKB = prev.file_size;
    let fileType   = prev.file_type;

    if (req.file) {
      removeFile(prev.file_path);
      filePath   = moveToRti(req.file);
      fileSizeKB = Math.round(req.file.size / 1024);
      fileType   = 'PDF';
    }

    const { title, display_order, is_active } = req.body;

    const { rows } = await pool.query(
      `UPDATE rti_documents SET
         title         = $1,
         file_path     = $2,
         file_size     = $3,
         file_type     = $4,
         display_order = $5,
         is_active     = $6,
         updated_at    = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        title?.trim()  ?? prev.title,
        filePath,
        fileSizeKB,
        fileType,
        display_order != null ? parseInt(display_order, 10) : prev.display_order,
        is_active !== undefined ? toBool(is_active, prev.is_active) : prev.is_active,
        req.params.id,
      ]
    );

    await bustCache();
    return res.json(rows[0]);
  } catch (err) {
    console.error('rti.updateDocument:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /api/admin/rti/documents/:id (admin) ────────────────
const deleteDocument = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await pool.query(
      'DELETE FROM rti_documents WHERE id = $1 RETURNING file_path',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    removeFile(rows[0].file_path);
    await bustCache();
    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('rti.deleteDocument:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const officerCreateValidators = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('officer_type')
    .notEmpty().withMessage('Officer type is required')
    .isIn(VALID_OFFICER_TYPES)
    .withMessage('officer_type must be public_information_officer or first_appellate_officer'),
];

const officerUpdateValidators = [
  body('name').trim().notEmpty().withMessage('Name is required'),
];

const documentValidators = [
  body('title').trim().notEmpty().withMessage('Title is required'),
];

module.exports = {
  get,
  createOfficer, updateOfficer, deleteOfficer,
  createDocument, updateDocument, deleteDocument,
  officerCreateValidators, officerUpdateValidators, documentValidators,
};
