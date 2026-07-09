const { Router } = require('express');

const {
  getPublicList, getPublicDetail,
  getAllAdmin, getAdminDetail,
  upsert, addImages, removeImage,
} = require('../controllers/activityProjects.controller');

const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadMultiple } = require('../middleware/upload');

const router = Router();

// ── Public: activity projects ──────────────────────────────────
router.get('/activities/projects',            globalLimiter, getPublicList);
router.get('/activities/projects/:projectId', globalLimiter, getPublicDetail);

// ── Admin: activity projects ───────────────────────────────────
router.get   ('/admin/activity-projects',      auth, getAllAdmin);

// image routes before /:projectId to prevent "images" matching as a project id
router.delete('/admin/activity-projects/images/:imageId', auth, removeImage);

router.get   ('/admin/activity-projects/:projectId',        auth, getAdminDetail);
router.put   ('/admin/activity-projects/:projectId',        auth, upsert);
router.post  ('/admin/activity-projects/:projectId/images', auth, uploadMultiple('images', 10), addImages);

module.exports = router;
