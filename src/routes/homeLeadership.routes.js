const { Router } = require('express');

const { getAll, updateSlot } = require('../controllers/homeLeadership.controller');
const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadImage } = require('../middleware/upload');

const router = Router();

router.get('/home/leadership',               globalLimiter, getAll);
router.put('/admin/home-leadership/:slot',   auth, uploadImage('photo'), updateSlot);

module.exports = router;
