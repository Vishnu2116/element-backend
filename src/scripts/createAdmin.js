require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const bcrypt = require("bcryptjs");
const pool = require("../config/db");

// ── Edit these before running ─────────────────────────────────
const NAME = "Super Admin";
const EMAIL = "admin@element.gov.in";
const PASSWORD = "Admin@123";
// ─────────────────────────────────────────────────────────────

(async () => {
  try {
    const existing = await pool.query(
      "SELECT id FROM admins WHERE email = $1",
      [EMAIL.toLowerCase()],
    );
    if (existing.rows.length > 0) {
      console.error(`Admin with email "${EMAIL}" already exists.`);
      process.exit(1);
    }

    const password_hash = await bcrypt.hash(PASSWORD, 12);

    const { rows } = await pool.query(
      `INSERT INTO admins (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [NAME, EMAIL.toLowerCase(), password_hash],
    );

    console.log("Admin created successfully:");
    console.table(rows[0]);
  } catch (err) {
    console.error("Failed to create admin:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
