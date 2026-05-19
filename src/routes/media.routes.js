const { Router } = require('express');

const {
  getAll: getGallery, create: createGallery, remove: removeGallery,
} = require('../controllers/gallery.controller');

const {
  getAll: getEvents, getBySlug,
  create: createEvent, update: updateEvent, remove: removeEvent,
  addImages, removeImage, toggleGallery,
  createValidators, updateValidators,
} = require('../controllers/events.controller');

const {
  get: getSocial, updateEmbeds,
  addVideo, updateVideo, removeVideo, videoValidators,
} = require('../controllers/socialMedia.controller');

const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadImage, uploadMultiple } = require('../middleware/upload');

const router = Router();

// ── Public ─────────────────────────────────────────────────────
router.get('/media/gallery',        globalLimiter, getGallery);
router.get('/media/social',         globalLimiter, getSocial);
router.get('/media/events',         globalLimiter, getEvents);
router.get('/media/events/:slug',   globalLimiter, getBySlug);

// ── Admin: gallery ─────────────────────────────────────────────
router.post  ('/admin/gallery',     auth, uploadMultiple('images', 20), createGallery);
router.delete('/admin/gallery/:id', auth, removeGallery);

// ── Admin: events — specific sub-routes BEFORE /:id routes ─────
// images sub-routes (depth > /:id, no conflict, but explicit ordering is clearer)
router.put   ('/admin/events/images/:id/toggle-gallery', auth, toggleGallery);
router.delete('/admin/events/images/:id',                auth, removeImage);

router.post  ('/admin/events',          auth, uploadImage('cover'), createValidators, createEvent);
router.put   ('/admin/events/:id',      auth, uploadImage('cover'), updateValidators, updateEvent);
router.delete('/admin/events/:id',      auth, removeEvent);
router.post  ('/admin/events/:id/images', auth, uploadMultiple('images', 20), addImages);

// ── Admin: social media embeds & videos ────────────────────────
router.put   ('/admin/social-media/embeds',       auth, updateEmbeds);
router.post  ('/admin/social-media/videos',       auth, videoValidators, addVideo);
router.put   ('/admin/social-media/videos/:id',   auth, videoValidators, updateVideo);
router.delete('/admin/social-media/videos/:id',   auth, removeVideo);

module.exports = router;
