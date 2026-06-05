const { Router } = require('express');
const { body } = require('express-validator');

const { get, getAdmin, update } = require('../controllers/settings.controller');
const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');

const router = Router();

const settingsValidators = [
  body('website_title').optional({ nullable: true }).trim().isLength({ max: 300 }),
  body('office_address').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('contact_email').optional({ nullable: true }).isEmail().withMessage('Invalid email'),
  body('contact_phone').optional({ nullable: true }).trim().isLength({ max: 50 }),
  body('helpline_number').optional({ nullable: true }).trim().isLength({ max: 50 }),
];

// ── Public ─────────────────────────────────────────────────────
router.get('/settings', globalLimiter, get);

// ── Admin ───────────────────────────────────────────────────────
router.get('/admin/settings', auth, getAdmin);
router.put('/admin/settings', auth, settingsValidators, update);

module.exports = router;
