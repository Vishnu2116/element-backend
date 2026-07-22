const { Router } = require('express');

const {
  getWhosWho, getDirectory, getById,
  getAllAdmin, create, update, remove,
  validators: officialValidators,
} = require('../controllers/officials.controller');

const {
  getAll: getCats, create: createCat,
  update: updateCat, remove: removeCat,
  nameRequired: catNameRequired,
} = require('../controllers/officialCategories.controller');

const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadImage } = require('../middleware/upload');

const router = Router();

// ── Public ─────────────────────────────────────────────────────
router.get('/about/whos-who',      globalLimiter, getWhosWho);
router.get('/about/directory',     globalLimiter, getDirectory);
router.get('/about/officials/:id', globalLimiter, getById);

// ── Admin: categories ──────────────────────────────────────────
router.get   ('/admin/official-categories',      auth, getCats);
router.post  ('/admin/official-categories',      auth, catNameRequired,        createCat);
router.put   ('/admin/official-categories/:id',  auth, catNameRequired,        updateCat);
router.delete('/admin/official-categories/:id',  auth,                         removeCat);

// ── Admin: officials ───────────────────────────────────────────
router.get   ('/admin/officials',      auth, getAllAdmin);
router.post  ('/admin/officials',      auth, uploadImage('photo'), officialValidators, create);
router.put   ('/admin/officials/:id',  auth, uploadImage('photo'), officialValidators, update);
router.delete('/admin/officials/:id',  auth, remove);

module.exports = router;
