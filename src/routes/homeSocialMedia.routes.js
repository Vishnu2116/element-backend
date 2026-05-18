const { Router } = require('express');

const { get, update } = require('../controllers/homeSocialMedia.controller');
const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');

const router = Router();

router.get('/home/social-media',       globalLimiter, get);
router.put('/admin/home-social-media', auth, update);

module.exports = router;
