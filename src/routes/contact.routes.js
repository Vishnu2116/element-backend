const { Router } = require('express');

const {
  getCaptcha, create, getAllAdmin, markRead, remove,
} = require('../controllers/contact.controller');

const auth = require('../middleware/auth');
const { formLimiter } = require('../middleware/rateLimiter');

const router = Router();

// ── Public ─────────────────────────────────────────────────────
router.get ('/contact/captcha', formLimiter, getCaptcha);
router.post('/contact',         formLimiter, create);

// ── Admin ──────────────────────────────────────────────────────
router.get   ('/admin/contact-messages',          auth, getAllAdmin);
router.put   ('/admin/contact-messages/:id/read', auth, markRead);
router.delete('/admin/contact-messages/:id',      auth, remove);

module.exports = router;
