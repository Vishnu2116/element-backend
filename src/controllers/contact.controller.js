const pool = require('../config/db');
const { sendEmail } = require('../helpers/mailer');
const { generateCaptcha, verifyCaptcha } = require('../helpers/captcha');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /api/contact/captcha (public) ──────────────────────────
const getCaptcha = (req, res) => {
  return res.json(generateCaptcha());
};

// ── POST /api/contact (public) ─────────────────────────────────
const create = async (req, res) => {
  const {
    name, email, subject, message,
    honeypot, captcha_token, captcha_answer,
  } = req.body;

  // Bots that fill the hidden field get a fake success — no DB write, no email.
  if (honeypot) {
    return res.status(200).json({ message: 'Your message has been sent successfully' });
  }

  if (!verifyCaptcha(captcha_token, captcha_answer)) {
    return res.status(422).json({ error: 'Incorrect answer, please try again' });
  }

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res.status(422).json({ error: 'Name, email, and message are required' });
  }
  if (!EMAIL_REGEX.test(email.trim())) {
    return res.status(422).json({ error: 'Please provide a valid email address' });
  }

  try {
    await pool.query(
      `INSERT INTO contact_messages (name, email, subject, message, ip_address)
       VALUES ($1,$2,$3,$4,$5)`,
      [name.trim(), email.trim(), subject?.trim() || null, message.trim(), req.ip]
    );

    try {
      await sendEmail({
        subject: `New Contact Form Submission: ${subject || 'No subject'}`,
        text: `Name: ${name}\nEmail: ${email}\nSubject: ${subject || 'No subject'}\n\nMessage:\n${message}`,
        replyTo: email.trim(),
      });
    } catch (err) {
      console.error('contact.create sendEmail:', err.message);
    }

    return res.status(201).json({ message: 'Your message has been sent successfully' });
  } catch (err) {
    console.error('contact.create:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/admin/contact-messages (admin) ────────────────────
const getAllAdmin = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM contact_messages ORDER BY created_at DESC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('contact.getAllAdmin:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /api/admin/contact-messages/:id/read (admin) ───────────
const markRead = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await pool.query(
      'UPDATE contact_messages SET is_read = true WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('contact.markRead:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /api/admin/contact-messages/:id (admin) ─────────────
const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await pool.query(
      'DELETE FROM contact_messages WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('contact.remove:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { getCaptcha, create, getAllAdmin, markRead, remove };
