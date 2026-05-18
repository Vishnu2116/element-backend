const { Router } = require('express');

const router = Router();

router.use('/auth', require('./auth.routes'));
router.use('/',     require('./heroSlides.routes'));
router.use('/',     require('./homeLeadership.routes'));
router.use('/',     require('./homeSocialMedia.routes'));
router.use('/',     require('./officials.routes'));

router.get('/health', (req, res) => res.json({ status: 'ok' }));

module.exports = router;
