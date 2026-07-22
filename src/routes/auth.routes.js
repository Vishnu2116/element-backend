const { Router } = require('express');
const { body } = require('express-validator');

const {
  login, getMe, changePassword, forgotPassword, resetPassword,
} = require('../controllers/auth.controller');
const auth = require('../middleware/auth');
const { strictLimiter, formLimiter } = require('../middleware/rateLimiter');

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

const changePasswordValidators = [
  body('current_password')
    .notEmpty().withMessage('Current password is required'),
  body('new_password')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
];

const forgotPasswordValidators = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email'),
];

const resetPasswordValidators = [
  body('token')
    .notEmpty().withMessage('Token is required'),
  body('new_password')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
];

router.post('/login', strictLimiter, loginValidators, login);
router.get('/me', auth, getMe);
router.put('/change-password', auth, changePasswordValidators, changePassword);
// Disabled pending SMTP credentials from the department — see auth.controller.js
// router.post('/forgot-password', formLimiter, forgotPasswordValidators, forgotPassword);
// router.post('/reset-password', formLimiter, resetPasswordValidators, resetPassword);

module.exports = router;
