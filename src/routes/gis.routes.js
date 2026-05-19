const { Router } = require('express');

const {
  getMapKey, getYears, getDistricts, getSites,
  getAllAdmin, create, update, remove,
  addKml, removeKml,
  createValidators, updateValidators,
} = require('../controllers/gis.controller');

const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadKml } = require('../middleware/upload');

const router = Router();

// ── Public ─────────────────────────────────────────────────────
router.get('/gis/map-key',   globalLimiter, getMapKey);
router.get('/gis/years',     globalLimiter, getYears);
router.get('/gis/districts', globalLimiter, getDistricts);
router.get('/gis/sites',     globalLimiter, getSites);

// ── Admin ───────────────────────────────────────────────────────
// /kml/:id before /sites/:id to prevent "kml" matching as a site id
router.delete('/admin/gis/kml/:id',           auth, removeKml);

router.get   ('/admin/gis/sites',             auth, getAllAdmin);
router.post  ('/admin/gis/sites',             auth, createValidators, create);
router.put   ('/admin/gis/sites/:id',         auth, updateValidators, update);
router.delete('/admin/gis/sites/:id',         auth, remove);
router.post  ('/admin/gis/sites/:id/kml',     auth, uploadKml('file'), addKml);

module.exports = router;
