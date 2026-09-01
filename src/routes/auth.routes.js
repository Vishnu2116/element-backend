const { Router } = require("express");
const { body } = require("express-validator");
const {
  login,
  verifyMfaLogin,
  confirmLogin,
  setupMfa,
  verifyMfaSetup,
  logout,
  getMe,
  checkSession,
  changePassword,
  forgotPassword,
  resetPassword,
} = require("../controllers/auth.controller");
const auth = require("../middleware/auth");
const { strictLimiter, formLimiter } = require("../middleware/rateLimiter");
const router = Router();
const loginValidators = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Must be a valid email"),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
];
const changePasswordValidators = [
  body("current_password")
    .notEmpty()
    .withMessage("Current password is required"),
  body("new_password")
    .notEmpty()
    .withMessage("New password is required")
    .isLength({ min: 8 })
    .withMessage("New password must be at least 8 characters"),
];
const forgotPasswordValidators = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Must be a valid email"),
];
const resetPasswordValidators = [
  body("token").notEmpty().withMessage("Token is required"),
  body("new_password")
    .notEmpty()
    .withMessage("New password is required")
    .isLength({ min: 8 })
    .withMessage("New password must be at least 8 characters"),
];
const verifyMfaSetupValidators = [
  body("code")
    .notEmpty()
    .withMessage("Code is required")
    .isLength({ min: 6, max: 6 })
    .withMessage("Code must be 6 characters")
    .isNumeric()
    .withMessage("Code must be numeric"),
];
const verifyMfaLoginValidators = [
  body("temp_token").notEmpty().withMessage("temp_token is required"),
  body("code")
    .notEmpty()
    .withMessage("Code is required")
    .isLength({ min: 6, max: 6 })
    .withMessage("Code must be 6 characters")
    .isNumeric()
    .withMessage("Code must be numeric"),
];
router.post("/login", strictLimiter, loginValidators, login);
router.post("/mfa/login", strictLimiter, verifyMfaLoginValidators, verifyMfaLogin);
router.post("/confirm-login", strictLimiter, confirmLogin);
router.post("/logout", auth, logout);
router.get("/me", auth, getMe);
router.get("/session-check", auth, checkSession);
router.put("/change-password", auth, changePasswordValidators, changePassword);
router.post("/mfa/setup", auth, setupMfa);
router.post("/mfa/verify-setup", auth, verifyMfaSetupValidators, verifyMfaSetup);
// Disabled pending SMTP credentials from the department — see auth.controller.js
// router.post('/forgot-password', formLimiter, forgotPasswordValidators, forgotPassword);
// router.post('/reset-password', formLimiter, resetPasswordValidators, resetPassword);
module.exports = router;
