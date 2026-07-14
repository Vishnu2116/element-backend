const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true for port 465, false for 587 (STARTTLS)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail({ to, subject, text, html, replyTo }) {
  const recipient = to || process.env.SMTP_USER;
  return transporter.sendMail({
    from: `"PROJECT ELEMENT Website" <${process.env.SMTP_USER}>`,
    to: recipient,
    replyTo: replyTo || undefined,
    subject,
    text,
    html,
  });
}

module.exports = { sendEmail };
