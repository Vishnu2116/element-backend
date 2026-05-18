const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const pool = require('../config/db');

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
      expiresIn: process.env.JWT_EXPIRES_IN || '2h',
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

module.exports = { login, getMe };
