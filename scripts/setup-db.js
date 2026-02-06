/**
 * Genesis — Database Setup Script
 * 
 * Runs database migrations to create tables and indexes.
 * Run this once before starting Genesis for the first time.
 * 
 * Usage: node scripts/setup-db.js
 */

const config = require("../src/config");
const { Database } = require("../src/db");

async function setup() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║              🧬 GENESIS — Database Setup                ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();

  const db = new Database(config.database);

  try {
    await db.connect();
    await db.migrate();
    
    console.log();
    console.log("  ✅ Database setup complete!");
    console.log("  🚀 You can now run Genesis: node src/app.js");
    console.log();

    await db.close();
    process.exit(0);
  } catch (err) {
    console.error("\n  💥 Setup failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

setup();
