const { Router } = require('express');
const { body } = require('express-validator');

const { login, getMe } = require('../controllers/auth.controller');
const auth = require('../middleware/auth');
const { strictLimiter } = require('../middleware/rateLimiter');

const router = Router();

const loginValidators = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

router.post('/login', strictLimiter, loginValidators, login);
router.get('/me', auth, getMe);

module.exports = router;
