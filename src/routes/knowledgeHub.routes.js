const { Router } = require('express');

const {
  getByType, getById, getNotifications, getWhatsNew,
  getAllAdmin, create, update, remove,
  validators, updateValidators,
} = require('../controllers/knowledgeHub.controller');

const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadFields } = require('../middleware/upload');

const router = Router();

const docUpload = uploadFields([
  { name: 'file',      maxCount: 1, type: 'pdf'   },
  { name: 'thumbnail', maxCount: 1, type: 'image' },
]);

// ── Public ─────────────────────────────────────────────────────
// doc/:id MUST be registered before /:type — otherwise Express
// matches the literal segment "doc" as a :type param value
router.get('/home/notifications',     globalLimiter, getNotifications);
router.get('/home/whats-new',         globalLimiter, getWhatsNew);
router.get('/knowledge-hub/doc/:id',  globalLimiter, getById);
router.get('/knowledge-hub/:type',    globalLimiter, getByType);

// ── Admin ──────────────────────────────────────────────────────
router.get   ('/admin/knowledge-hub',      auth, getAllAdmin);
router.post  ('/admin/knowledge-hub',      auth, docUpload, validators, create);
router.put   ('/admin/knowledge-hub/:id',  auth, docUpload, updateValidators, update);
router.delete('/admin/knowledge-hub/:id',  auth, remove);

module.exports = router;
