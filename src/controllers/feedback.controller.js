const pool = require('../config/db');
const { sendEmail } = require('../helpers/mailer');
const { generateCaptcha, verifyCaptcha } = require('../helpers/captcha');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_CATEGORIES = [
  'general', 'website_issue', 'content_suggestion',
  'accessibility', 'project_information', 'other',
];

// ── GET /api/feedback/captcha (public) ─────────────────────────
const getCaptcha = (req, res) => {
  return res.json(generateCaptcha());
};

// ── POST /api/feedback (public) ────────────────────────────────
const create = async (req, res) => {
  const {
    name, email, mobile, category, message,
    honeypot, captcha_token, captcha_answer,
  } = req.body;

  // Bots that fill the hidden field get a fake success — no DB write, no email.
  if (honeypot) {
    return res.status(200).json({ message: 'Your message has been sent successfully' });
  }

  if (!verifyCaptcha(captcha_token, captcha_answer)) {
    return res.status(422).json({ error: 'Incorrect answer, please try again' });
  }

  if (!name?.trim() || !email?.trim() || !category?.trim() || !message?.trim()) {
    return res.status(422).json({ error: 'Name, email, category, and message are required' });
  }
  if (!EMAIL_REGEX.test(email.trim())) {
    return res.status(422).json({ error: 'Please provide a valid email address' });
  }
  if (!VALID_CATEGORIES.includes(category.trim())) {
    return res.status(422).json({ error: 'Invalid category' });
  }

  try {
    await pool.query(
      `INSERT INTO feedback_messages (name, email, mobile, category, message, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [name.trim(), email.trim(), mobile?.trim() || null, category.trim(), message.trim(), req.ip]
    );

    try {
      await sendEmail({
        subject: `New Feedback Submission: ${category}`,
        text: `Name: ${name}\nEmail: ${email}\nMobile: ${mobile || 'N/A'}\nCategory: ${category}\n\nMessage:\n${message}`,
        replyTo: email.trim(),
      });
    } catch (err) {
      console.error('feedback.create sendEmail:', err.message);
    }

    return res.status(201).json({ message: 'Your message has been sent successfully' });
  } catch (err) {
    console.error('feedback.create:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/admin/feedback-messages (admin) ───────────────────
const getAllAdmin = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM feedback_messages ORDER BY created_at DESC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('feedback.getAllAdmin:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /api/admin/feedback-messages/:id/read (admin) ──────────
const markRead = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await pool.query(
      'UPDATE feedback_messages SET is_read = true WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('feedback.markRead:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /api/admin/feedback-messages/:id (admin) ────────────
const remove = async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await pool.query(
      'DELETE FROM feedback_messages WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('feedback.remove:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { getCaptcha, create, getAllAdmin, markRead, remove };
