const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { validationResult } = require("express-validator");
const { generateSecret, verify, generateURI } = require("otplib");
const QRCode = require("qrcode");
const pool = require("../config/db");
const redis = require("../config/redis");
const { sendEmail } = require("../helpers/mailer");
const createSessionAndRespond = async (admin, res, { skipActiveCheck = false } = {}) => {
  if (!skipActiveCheck) {
    const existingSession = await redis.get(`session_active:${admin.id}`);
    if (existingSession) {
      const tempToken = jwt.sign(
        { id: admin.id, purpose: "login_confirm" },
        process.env.JWT_SECRET,
        { expiresIn: "5m", algorithm: "HS256" },
      );
      return res.json({ already_active: true, temp_token: tempToken });
    }
  }
  const sessionId = crypto.randomUUID();
  const payload = {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    sid: sessionId,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    algorithm: "HS256",
  });
  await redis.set(`session_active:${admin.id}`, sessionId, { EX: 15 * 60 });
  return res.json({ token, admin: payload });
};
const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, password_hash, mfa_enabled FROM admins WHERE email = $1",
      [email.toLowerCase()],
    );
    const admin = rows[0];
    const valid =
      admin && (await bcrypt.compare(password, admin.password_hash));
    if (!valid) {
      console.warn(
        `Failed login attempt: email="${email}" at ${new Date().toISOString()}`,
      );
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (admin.mfa_enabled) {
      const tempToken = jwt.sign(
        { id: admin.id, purpose: "mfa_pending" },
        process.env.JWT_SECRET,
        { expiresIn: "5m", algorithm: "HS256" },
      );
      return res.json({ mfa_required: true, temp_token: tempToken });
    }
    return await createSessionAndRespond(admin, res);
  } catch (err) {
    console.error("login error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
const verifyMfaLogin = async (req, res) => {
  const { temp_token, code } = req.body;
  let decoded;
  try {
    decoded = jwt.verify(temp_token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch (err) {
    return res.status(400).json({ error: "Invalid or expired session" });
  }
  if (decoded.purpose !== "mfa_pending") {
    return res.status(400).json({ error: "Invalid or expired session" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, mfa_secret FROM admins WHERE id = $1",
      [decoded.id],
    );
    const admin = rows[0];
    let isValid = false;
    if (admin) {
      const result = await verify({
        token: code,
        secret: admin.mfa_secret,
        epochTolerance: 30,
      });
      isValid = result.valid;
    }
    if (!isValid) {
      return res.status(401).json({ error: "Invalid code" });
    }
    return await createSessionAndRespond(admin, res);
  } catch (err) {
    console.error("verifyMfaLogin error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
const confirmLogin = async (req, res) => {
  const { temp_token } = req.body;
  let decoded;
  try {
    decoded = jwt.verify(temp_token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch (err) {
    return res.status(400).json({ error: "Invalid or expired confirmation" });
  }
  if (decoded.purpose !== "login_confirm") {
    return res.status(400).json({ error: "Invalid or expired confirmation" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name FROM admins WHERE id = $1",
      [decoded.id],
    );
    const admin = rows[0];
    if (!admin) {
      return res.status(400).json({ error: "Invalid or expired confirmation" });
    }
    return await createSessionAndRespond(admin, res, { skipActiveCheck: true });
  } catch (err) {
    console.error("confirmLogin error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
const setupMfa = async (req, res) => {
  try {
    const secret = generateSecret();
    await pool.query("UPDATE admins SET mfa_secret = $1 WHERE id = $2", [
      secret,
      req.user.id,
    ]);
    const otpauthUrl = generateURI({
      secret,
      issuer: "PROJECT ELEMENT Admin",
      label: req.user.email,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    return res.json({ qrCode: qrCodeDataUrl, secret });
  } catch (err) {
    console.error("setupMfa error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
const verifyMfaSetup = async (req, res) => {
  const { code } = req.body;
  try {
    const { rows } = await pool.query(
      "SELECT mfa_secret FROM admins WHERE id = $1",
      [req.user.id],
    );
    const admin = rows[0];
    if (!admin || !admin.mfa_secret) {
      return res.status(400).json({ error: "MFA setup has not been initiated" });
    }
    const result = await verify({
      token: code,
      secret: admin.mfa_secret,
      epochTolerance: 30,
    });
    const isValid = result.valid;
    if (!isValid) {
      return res.status(400).json({ error: "Invalid code. Please try again." });
    }
    await pool.query("UPDATE admins SET mfa_enabled = true WHERE id = $1", [
      req.user.id,
    ]);
    return res.json({ message: "MFA enabled successfully" });
  } catch (err) {
    console.error("verifyMfaSetup error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
const logout = async (req, res) => {
  try {
    await redis.del(`session_active:${req.user.id}`);
    return res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("logout error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
const getMe = (req, res) => {
  const { id, email, name } = req.user;
  return res.json({ id, email, name });
};
const checkSession = (req, res) => {
  return res.json({ valid: true });
};
const changePassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }
  const { current_password, new_password } = req.body;
  try {
    const { rows } = await pool.query(
      "SELECT password_hash FROM admins WHERE id = $1",
      [req.user.id],
    );
    const admin = rows[0];
    const valid =
      admin && (await bcrypt.compare(current_password, admin.password_hash));
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const { rows: historyRows } = await pool.query(
      "SELECT password_hash FROM admin_password_history WHERE admin_id = $1 ORDER BY created_at DESC LIMIT 5",
      [req.user.id],
    );
    const previousHashes = [
      admin.password_hash,
      ...historyRows.map((row) => row.password_hash),
    ];
    for (const previousHash of previousHashes) {
      if (await bcrypt.compare(new_password, previousHash)) {
        return res.status(400).json({
          error: "New password must be different from your last 5 passwords.",
        });
      }
    }
    const password_hash = await bcrypt.hash(new_password, 12);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE admins SET password_hash = $1 WHERE id = $2", [
        password_hash,
        req.user.id,
      ]);
      await client.query(
        "INSERT INTO admin_password_history (admin_id, password_hash) VALUES ($1, $2)",
        [req.user.id, admin.password_hash],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("changePassword error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
// Disabled pending SMTP credentials from the department; route is commented out in auth.routes.js
const forgotPassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }
  const { email } = req.body;
  const genericResponse = {
    message:
      "If this email is registered, a password reset link has been sent.",
  };
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, token_version FROM admins WHERE email = $1",
      [email.toLowerCase()],
    );
    const admin = rows[0];
    if (admin) {
      const token = jwt.sign(
        {
          id: admin.id,
          purpose: "password_reset",
          token_version: admin.token_version,
        },
        process.env.JWT_SECRET,
        { algorithm: "HS256", expiresIn: "30m" },
      );
      const resetLink = `${process.env.FRONTEND_URL}/admin/reset-password?token=${token}`;
      try {
        await sendEmail({
          to:
            process.env.PASSWORD_RESET_RECIPIENT_EMAIL || process.env.SMTP_USER,
          subject: "PROJECT ELEMENT Admin — Password Reset Request",
          text: `A password reset was requested for ${admin.name} (${admin.email}).\n\nReset link (valid for 30 minutes):\n${resetLink}\n\nIf you did not request this, you can ignore this email.`,
          html: `<p>A password reset was requested for <strong>${admin.name}</strong> (${admin.email}).</p><p><a href="${resetLink}">Reset password</a> (valid for 30 minutes)</p><p>If you did not request this, you can ignore this email.</p>`,
        });
      } catch (err) {
        console.error("forgotPassword sendEmail:", err.message);
      }
    }
    return res.json(genericResponse);
  } catch (err) {
    console.error("forgotPassword error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
// Disabled pending SMTP credentials from the department; route is commented out in auth.routes.js
const resetPassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }
  const { token, new_password } = req.body;
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch (err) {
    return res.status(400).json({ error: "Invalid or expired reset link" });
  }
  if (decoded.purpose !== "password_reset") {
    return res.status(400).json({ error: "Invalid or expired reset link" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT token_version FROM admins WHERE id = $1",
      [decoded.id],
    );
    const admin = rows[0];
    if (!admin || admin.token_version !== decoded.token_version) {
      return res.status(401).json({ error: "Invalid or expired reset link" });
    }
    const password_hash = await bcrypt.hash(new_password, 12);
    await pool.query(
      "UPDATE admins SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
      [password_hash, decoded.id],
    );
    return res.json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("resetPassword error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
module.exports = {
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
};
