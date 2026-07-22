const { Router } = require('express');
const { body } = require('express-validator');

const {
  getAll, getById, create, update, remove, reorder,
} = require('../controllers/heroSlides.controller');
const auth = require('../middleware/auth');
const { globalLimiter } = require('../middleware/rateLimiter');
const { uploadImage } = require('../middleware/upload');

const router = Router();

const titleRequired = body('title').trim().notEmpty().withMessage('Title is required');

// Public
router.get('/hero-slides', globalLimiter, getAll);

// Admin — reorder must be declared before /:id to avoid being swallowed as a param
router.put('/admin/hero-slides/reorder', auth, reorder);

router.get   ('/admin/hero-slides/:id', auth, getById);
router.post  ('/admin/hero-slides',     auth, uploadImage('image'), titleRequired, create);
router.put   ('/admin/hero-slides/:id', auth, uploadImage('image'), titleRequired, update);
router.delete('/admin/hero-slides/:id', auth, remove);

module.exports = router;
