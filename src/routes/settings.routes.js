const { Router } = require('express');

const { get, getAdmin, update } = require('../controllers/settings.controller');
const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');

const router = Router();

// ── Public ─────────────────────────────────────────────────────
router.get('/settings', globalLimiter, get);

// ── Admin ───────────────────────────────────────────────────────
router.get('/admin/settings', auth, getAdmin);
router.put('/admin/settings', auth, update);

module.exports = router;
