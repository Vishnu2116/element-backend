const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const pool = require('../config/db');
const { sendEmail } = require('../helpers/mailer');

const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT id, email, name, password_hash FROM admins WHERE email = $1',
      [email.toLowerCase()]
    );

    const admin = rows[0];
    const valid = admin && (await bcrypt.compare(password, admin.password_hash));

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const payload = { id: admin.id, email: admin.email, name: admin.name };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      algorithm: 'HS256',
    });

    return res.json({ token, admin: payload });
  } catch (err) {
    console.error('login error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getMe = (req, res) => {
  const { id, email, name } = req.user;
  return res.json({ id, email, name });
};

const changePassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  const { current_password, new_password } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT password_hash FROM admins WHERE id = $1',
      [req.user.id]
    );

    const admin = rows[0];
    const valid = admin && (await bcrypt.compare(current_password, admin.password_hash));

    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const password_hash = await bcrypt.hash(new_password, 12);

    await pool.query(
      'UPDATE admins SET password_hash = $1 WHERE id = $2',
      [password_hash, req.user.id]
    );

    return res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('changePassword error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const forgotPassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  const { email } = req.body;
  const genericResponse = {
    message: 'If this email is registered, a password reset link has been sent.',
  };

  try {
    const { rows } = await pool.query(
      'SELECT id, email, name FROM admins WHERE email = $1',
      [email.toLowerCase()]
    );

    const admin = rows[0];
    if (admin) {
      const token = jwt.sign(
        { id: admin.id, purpose: 'password_reset' },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '30m' }
      );

      const resetLink = `${process.env.FRONTEND_URL}/admin/reset-password?token=${token}`;

      try {
        await sendEmail({
          to: process.env.PASSWORD_RESET_RECIPIENT_EMAIL || process.env.SMTP_USER,
          subject: 'PROJECT ELEMENT Admin — Password Reset Request',
          text: `A password reset was requested for ${admin.name} (${admin.email}).\n\nReset link (valid for 30 minutes):\n${resetLink}\n\nIf you did not request this, you can ignore this email.`,
          html: `<p>A password reset was requested for <strong>${admin.name}</strong> (${admin.email}).</p><p><a href="${resetLink}">Reset password</a> (valid for 30 minutes)</p><p>If you did not request this, you can ignore this email.</p>`,
        });
      } catch (err) {
        console.error('forgotPassword sendEmail:', err.message);
      }
    }

    return res.json(genericResponse);
  } catch (err) {
    console.error('forgotPassword error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const resetPassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  const { token, new_password } = req.body;

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }

  if (decoded.purpose !== 'password_reset') {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }

  try {
    const password_hash = await bcrypt.hash(new_password, 12);

    await pool.query(
      'UPDATE admins SET password_hash = $1 WHERE id = $2',
      [password_hash, decoded.id]
    );

    return res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('resetPassword error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { login, getMe, changePassword, forgotPassword, resetPassword };
