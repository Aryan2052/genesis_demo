/**
 * Genesis — Database Connection Pool
 * 
 * PostgreSQL connection management with automatic reconnection,
 * query helpers, and transaction support.
 */

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

class Database {
  constructor(config) {
    this.config = config;
    this.pool = null;
    this._isConnected = false;
  }

  /**
   * Initialize connection pool
   */
  async connect() {
    if (this._isConnected) {
      console.log("  🗄️  [Database] Already connected");
      return;
    }

    try {
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        max: 20, // Max connections in pool
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      // Test connection
      const client = await this.pool.connect();
      const result = await client.query("SELECT NOW()");
      client.release();

      this._isConnected = true;
      console.log(`  🗄️  [Database] Connected to ${this.config.database} at ${this.config.host}:${this.config.port}`);
      console.log(`  🗄️  [Database] Server time: ${result.rows[0].now}`);
    } catch (err) {
      console.error(`  💥 [Database] Connection failed: ${err.message}`);
      throw err;
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
      await this.pool.query(schema);
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
   * @returns {Promise<Object>} - Query result
   */
  async query(text, params = []) {
    if (!this._isConnected) {
      throw new Error("Database not connected. Call connect() first.");
    }

    try {
      const start = Date.now();
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;

      // Log slow queries
      if (duration > 1000) {
        console.warn(`  ⏱️  [Database] Slow query (${duration}ms): ${text.slice(0, 100)}`);
      }

      return result;
    } catch (err) {
      console.error(`  💥 [Database] Query failed: ${err.message}`);
      console.error(`  💥 [Database] Query: ${text.slice(0, 200)}`);
      throw err;
    }
  }

  /**
   * Begin a transaction
   * @returns {Promise<Object>} - Transaction client
   */
  async beginTransaction() {
    const client = await this.pool.connect();
    await client.query("BEGIN");
    
    return {
      query: (text, params) => client.query(text, params),
      commit: async () => {
        await client.query("COMMIT");
        client.release();
      },
      rollback: async () => {
        await client.query("ROLLBACK");
        client.release();
      },
    };
  }

  /**
   * Get pool statistics
   */
  getStats() {
    if (!this.pool) return null;
    
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /**
   * Close all connections
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this._isConnected = false;
      console.log("  🗄️  [Database] Connection closed");
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const result = await this.query("SELECT 1");
      return result.rowCount === 1;
    } catch (err) {
      return false;
    }
  }
}

module.exports = Database;
