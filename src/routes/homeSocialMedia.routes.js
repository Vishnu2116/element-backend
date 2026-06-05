const { Router } = require('express');
const { body } = require('express-validator');

const { get, update } = require('../controllers/homeSocialMedia.controller');
const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');

const router = Router();

const socialMediaValidators = [
  body('facebook_url').optional({ nullable: true }).isURL().withMessage('Invalid Facebook URL'),
  body('twitter_url').optional({ nullable: true }).isURL().withMessage('Invalid Twitter URL'),
  body('youtube_video_url').optional({ nullable: true }).isURL().withMessage('Invalid YouTube URL'),
  body('facebook_handle').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('twitter_handle').optional({ nullable: true }).trim().isLength({ max: 100 }),
];

router.get('/home/social-media',       globalLimiter, get);
router.put('/admin/home-social-media', auth, socialMediaValidators, update);

module.exports = router;
