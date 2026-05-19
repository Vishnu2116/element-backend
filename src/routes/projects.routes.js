const { Router } = require('express');

const {
  getAll: getAllComponents, getById: getComponentById,
  create: createComponent, update: updateComponent,
  remove: removeComponent, validators: componentValidators,
} = require('../controllers/projectComponents.controller');

const {
  getAll: getAllProjects, getBySlug, getHighlights,
  getAllAdmin, create, update, remove,
  addGalleryImage, removeGalleryImage,
  titleRequired, componentRequired,
} = require('../controllers/projects.controller');

const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadImage, uploadMultiple } = require('../middleware/upload');

const router = Router();

// ── Public: project components ─────────────────────────────────
router.get('/project-components',     globalLimiter, getAllComponents);
router.get('/project-components/:id', globalLimiter, getComponentById);

// ── Public: projects ───────────────────────────────────────────
router.get('/home/project-highlights', globalLimiter, getHighlights);
router.get('/projects',               globalLimiter, getAllProjects);
router.get('/projects/:slug',         globalLimiter, getBySlug);

// ── Admin: project components ──────────────────────────────────
router.get   ('/admin/project-components',      auth, getAllComponents);
router.post  ('/admin/project-components',      auth, componentValidators, createComponent);
router.put   ('/admin/project-components/:id',  auth, componentValidators, updateComponent);
router.delete('/admin/project-components/:id',  auth, removeComponent);

// ── Admin: projects ────────────────────────────────────────────
router.get   ('/admin/projects',      auth, getAllAdmin);
router.post  ('/admin/projects',      auth, uploadImage('thumbnail'), [titleRequired, componentRequired], create);

// gallery routes before /:id to prevent "gallery" matching as a project id
router.delete('/admin/projects/gallery/:imageId', auth, removeGalleryImage);

router.put   ('/admin/projects/:id',          auth, uploadImage('thumbnail'), titleRequired, update);
router.delete('/admin/projects/:id',          auth, remove);
router.post  ('/admin/projects/:id/gallery',  auth, uploadMultiple('images', 10), addGalleryImage);

module.exports = router;
