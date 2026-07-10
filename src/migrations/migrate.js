require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const MIGRATIONS_DIR = __dirname;

// Ordered list of migration files to run in sequence
const migrations = [
  "001_initial_schema.sql",
  "002_add_file_size_to_procurements.sql",
  "003_gis_tables.sql",
  "004_update_social_media.sql",
  "005_settings.sql",
  "006_rti.sql",
  "007_last_updated.sql",
  "008_visitor_stats.sql",
  "009_project_component_objectives.sql",
  "010_gallery_district.sql",
  "011_simplify_projects.sql",
  "012_activity_projects.sql",
  "013_official_subcategories.sql",
];

async function runMigrations() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Ensure a tracking table exists so we skip already-applied files
  await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename  VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

  for (const filename of migrations) {
    const { rows } = await pool.query(
      "SELECT filename FROM _migrations WHERE filename = $1",
      [filename],
    );

    if (rows.length > 0) {
      console.log(`  skipped  ${filename}  (already applied)`);
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filePath, "utf8");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [
        filename,
      ]);
      await client.query("COMMIT");
      console.log(`  applied  ${filename}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  failed   ${filename}`);
      console.error(err.message);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log("Migrations complete.");
}

runMigrations().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});
