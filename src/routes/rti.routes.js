const { Router } = require('express');

const {
  get,
  createOfficer, updateOfficer, deleteOfficer,
  createDocument, updateDocument, deleteDocument,
  officerCreateValidators, officerUpdateValidators, documentValidators,
} = require('../controllers/rti.controller');

const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadPdf } = require('../middleware/upload');

const router = Router();

// ── Public ─────────────────────────────────────────────────────
router.get('/rti', globalLimiter, get);

// ── Admin: officers ─────────────────────────────────────────────
router.post  ('/admin/rti/officers',     auth, officerCreateValidators, createOfficer);
router.put   ('/admin/rti/officers/:id', auth, officerUpdateValidators, updateOfficer);
router.delete('/admin/rti/officers/:id', auth, deleteOfficer);

// ── Admin: documents ────────────────────────────────────────────
router.post  ('/admin/rti/documents',     auth, uploadPdf('file'), documentValidators, createDocument);
router.put   ('/admin/rti/documents/:id', auth, uploadPdf('file'), documentValidators, updateDocument);
router.delete('/admin/rti/documents/:id', auth, deleteDocument);

module.exports = router;
