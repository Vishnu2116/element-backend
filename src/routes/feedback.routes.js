const { Router } = require('express');

const {
  getCaptcha, create, getAllAdmin, markRead, remove,
} = require('../controllers/feedback.controller');

const auth = require('../middleware/auth');
const { formLimiter } = require('../middleware/rateLimiter');

const router = Router();

// ── Public ─────────────────────────────────────────────────────
router.get ('/feedback/captcha', formLimiter, getCaptcha);
router.post('/feedback',         formLimiter, create);

// ── Admin ──────────────────────────────────────────────────────
router.get   ('/admin/feedback-messages',          auth, getAllAdmin);
router.put   ('/admin/feedback-messages/:id/read', auth, markRead);
router.delete('/admin/feedback-messages/:id',      auth, remove);

module.exports = router;
