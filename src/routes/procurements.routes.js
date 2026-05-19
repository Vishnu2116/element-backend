const { Router } = require('express');

const {
  getByType, getTenders, getById, getAllAdmin,
  create, update, remove,
  validators, updateValidators,
} = require('../controllers/procurements.controller');

const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadPdf } = require('../middleware/upload');

const router = Router();

// Inject the DB type value before getByType runs so the controller
// always receives a validated singular form ('tender' | 'rfp')
function setType(type) {
  return (req, res, next) => { req.params.type = type; next(); };
}

// ── Public ─────────────────────────────────────────────────────
// Static paths registered before any /:param routes
router.get('/home/tenders',            globalLimiter, getTenders);
router.get('/procurements/tenders',    globalLimiter, setType('tender'), getByType);
router.get('/procurements/rfps',       globalLimiter, setType('rfp'),    getByType);

// ── Admin ──────────────────────────────────────────────────────
// Specific /admin/procurements routes before /:id
router.get   ('/admin/procurements',      auth, getAllAdmin);
router.post  ('/admin/procurements',      auth, uploadPdf('file'), validators, create);
router.get   ('/admin/procurements/:id',  auth, getById);
router.put   ('/admin/procurements/:id',  auth, uploadPdf('file'), updateValidators, update);
router.delete('/admin/procurements/:id',  auth, remove);

module.exports = router;
