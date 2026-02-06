/**
 * Genesis — Database Connection (SQLite)
 * 
 * SQLite connection management with automatic file persistence,
 * query helpers, and transaction support.
 * 
 * Uses sql.js (pure JavaScript, zero dependencies)
 */

const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

class Database {
  constructor(config) {
    this.config = config;
    this.db = null;
    this.SQL = null;
    this._isConnected = false;
    this.dbPath = config.path || path.join(__dirname, "../../data/genesis.db");
  }

  /**
   * Initialize SQLite connection
   */
  async connect() {
    if (this._isConnected) {
      console.log("  🗄️  [Database] Already connected");
      return;
    }

    try {
      // Initialize sql.js
      this.SQL = await initSqlJs();

      // Create data directory if it doesn't exist
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Load existing database or create new
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(buffer);
        console.log(`  🗄️  [Database] Loaded existing database from ${this.dbPath}`);
      } else {
        this.db = new this.SQL.Database();
        console.log(`  🗄️  [Database] Created new database at ${this.dbPath}`);
      }

      this._isConnected = true;

      // Set up auto-save on changes
      this._setupAutoSave();
    } catch (err) {
      console.error(`  � [Database] Connection failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Auto-save database to file after changes
   */
  _setupAutoSave() {
    // Save every 5 seconds if there were changes
    this._saveInterval = setInterval(() => {
      this.save();
    }, 5000);
  }

  /**
   * Save database to file
   */
  save() {
    if (!this.db) return;
    
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (err) {
      console.error(`  💥 [Database] Save failed: ${err.message}`);
    }
  }

  /**
   * Run database migrations (schema setup)
   */
  async migrate() {
    console.log("  🔧 [Database] Running migrations...");
    
    const schemaPath = path.join(__dirname, "../../db/schema.sql");
    
    if (!fs.existsSync(schemaPath)) {
      console.warn("  ⚠️  [Database] schema.sql not found, skipping migrations");
      return;
    }

    try {
      const schema = fs.readFileSync(schemaPath, "utf8");
      
      // Execute the entire schema at once (SQLite can handle it)
      this.db.run(schema);

      this.save(); // Persist migrations
      console.log("  ✅ [Database] Migrations complete");
    } catch (err) {
      console.error(`  💥 [Database] Migration failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Execute a query
   * @param {string} text - SQL query
   * @param {Array} params - Query parameters
   * @returns {Object} - Query result
   */
  query(text, params = []) {
    if (!this._isConnected) {
      throw new Error("Database not connected. Call connect() first.");
    }

    try {
      const start = Date.now();
      
      // Convert $1, $2, $3 style params to ? style for SQLite
      let sqliteQuery = text;
      if (params.length > 0 && text.includes("$")) {
        for (let i = params.length; i >= 1; i--) {
          sqliteQuery = sqliteQuery.replace(new RegExp(`\\$${i}\\b`, "g"), "?");
        }
      }
      
      // sql.js uses different methods for SELECT vs INSERT/UPDATE/DELETE
      const isSelect = sqliteQuery.trim().toUpperCase().startsWith("SELECT");
      
      if (isSelect) {
        const stmt = this.db.prepare(sqliteQuery);
        stmt.bind(params);
        
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();

        const duration = Date.now() - start;
        if (duration > 1000) {
          console.warn(`  ⏱️  [Database] Slow query (${duration}ms): ${text.slice(0, 100)}`);
        }

        return { rows, rowCount: rows.length };
      } else {
        // INSERT, UPDATE, DELETE
        this.db.run(sqliteQuery, params);
        const duration = Date.now() - start;

        if (duration > 1000) {
          console.warn(`  ⏱️  [Database] Slow query (${duration}ms): ${text.slice(0, 100)}`);
        }

        // For INSERT with RETURNING, we need to get the last inserted row
        if (text.toUpperCase().includes("RETURNING")) {
          const lastId = this.db.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0] || null;
          return { rows: [{ id: lastId }], rowCount: 1 };
        }

        return { rows: [], rowCount: this.db.getRowsModified() };
      }
    } catch (err) {
      console.error(`  💥 [Database] Query failed:`, err);
      console.error(`  💥 [Database] Error type:`, typeof err);
      console.error(`  💥 [Database] Error message:`, err?.message);
      console.error(`  💥 [Database] Query: ${text.slice(0, 200)}`);
      console.error(`  💥 [Database] Params:`, params);
      throw err;
    }
  }

  /**
   * Begin a transaction
   * @returns {Object} - Transaction client
   */
  beginTransaction() {
    try {
      this.db.run("BEGIN TRANSACTION");
    } catch (err) {
      console.error(`  💥 [Database] Begin transaction failed: ${err.message}`);
      throw err;
    }
    
    return {
      query: (text, params) => this.query(text, params),
      commit: () => {
        try {
          this.db.run("COMMIT");
          this.save(); // Save after commit
        } catch (err) {
          console.error(`  💥 [Database] Commit failed: ${err.message}`);
          throw err;
        }
      },
      rollback: () => {
        try {
          this.db.run("ROLLBACK");
        } catch (err) {
          console.error(`  💥 [Database] Rollback failed: ${err.message}`);
          throw err;
        }
      },
    };
  }

  /**
   * Get database statistics
   */
  getStats() {
    if (!this.db) return null;
    
    try {
      const sizeResult = this.query("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()");
      const tableResult = this.query("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'");
      
      return {
        size: sizeResult.rows[0]?.size || 0,
        tables: tableResult.rows[0]?.count || 0,
        path: this.dbPath,
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.db) {
      clearInterval(this._saveInterval);
      this.save(); // Final save
      this.db.close();
      this._isConnected = false;
      console.log("  🗄️  [Database] Connection closed");
    }
  }

  /**
   * Health check
   */
  healthCheck() {
    try {
      this.query("SELECT 1");
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = Database;
