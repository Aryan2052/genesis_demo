/**
 * Genesis — REST API Server
 * 
 * Provides HTTP endpoints for querying events, alerts, and stats.
 * Runs on a separate port from the main Genesis monitor.
 * 
 * Run: node src/api-server.js
 */

const express = require("express");
const cors = require("cors");
const config = require("./config");
const { Database, EventRepository, AlertRepository } = require("./db");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

let db, eventRepo, alertRepo;

// ---------------------------------------------------------------------------
// Middleware: Request logging
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`  📡 ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Health check endpoint
 */
app.get("/health", async (req, res) => {
  const dbHealthy = await db.healthCheck();
  res.json({
    status: dbHealthy ? "ok" : "degraded",
    database: dbHealthy,
    timestamp: Date.now(),
  });
});

/**
 * GET /events
 * Query events with filters
 * 
 * Query params:
 *   - chain: Chain slug (ethereum, polygon, etc.)
 *   - eventType: Event type (ERC20_TRANSFER, etc.)
 *   - finality: Finality status (pending, soft_confirmed, final)
 *   - contractAddress: Contract address
 *   - limit: Max results (default: 100, max: 1000)
 */
app.get("/events", async (req, res) => {
  try {
    const { chain, eventType, finality, contractAddress, limit } = req.query;
    
    const filters = {};
    if (chain) filters.chain = chain;
    if (eventType) filters.eventType = eventType;
    if (finality) filters.finality = finality;
    if (contractAddress) filters.contractAddress = contractAddress;

    const maxLimit = Math.min(parseInt(limit || "100", 10), 1000);

    const events = await eventRepo.getRecent(filters, maxLimit);
    const total = await eventRepo.getCount(filters);

    res.json({
      events,
      total,
      limit: maxLimit,
      filters,
    });
  } catch (err) {
    console.error(`  💥 [API] /events error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /events/stats
 * Get event statistics
 * 
 * Query params:
 *   - chain: Chain slug (required)
 */
app.get("/events/stats", async (req, res) => {
  try {
    const { chain } = req.query;
    
    if (!chain) {
      return res.status(400).json({ error: "chain parameter required" });
    }

    const stats = await eventRepo.getStats(chain);

    res.json({
      chain,
      stats: {
        totalEvents: parseInt(stats.total_events, 10),
        uniqueContracts: parseInt(stats.unique_contracts, 10),
        uniqueTransactions: parseInt(stats.unique_transactions, 10),
        blockRange: {
          first: parseInt(stats.first_block, 10),
          latest: parseInt(stats.latest_block, 10),
        },
        finality: {
          pending: parseInt(stats.pending_count, 10),
          softConfirmed: parseInt(stats.soft_confirmed_count, 10),
          final: parseInt(stats.final_count, 10),
        },
      },
    });
  } catch (err) {
    console.error(`  💥 [API] /events/stats error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /events/block/:chain/:blockNumber
 * Get all events in a specific block
 */
app.get("/events/block/:chain/:blockNumber", async (req, res) => {
  try {
    const { chain, blockNumber } = req.params;
    const block = parseInt(blockNumber, 10);

    const events = await eventRepo.getByBlockRange(chain, block, block, 1000);

    res.json({
      chain,
      blockNumber: block,
      events,
      count: events.length,
    });
  } catch (err) {
    console.error(`  💥 [API] /events/block error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /events/contract/:address
 * Get events for a specific contract
 */
app.get("/events/contract/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { limit } = req.query;

    const maxLimit = Math.min(parseInt(limit || "100", 10), 1000);
    const events = await eventRepo.getByContract(address, maxLimit);

    res.json({
      contractAddress: address.toLowerCase(),
      events,
      count: events.length,
      limit: maxLimit,
    });
  } catch (err) {
    console.error(`  💥 [API] /events/contract error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /events/tx/:txHash
 * Get all events in a specific transaction
 */
app.get("/events/tx/:txHash", async (req, res) => {
  try {
    const { txHash } = req.params;

    const events = await eventRepo.getByTxHash(txHash);

    res.json({
      txHash: txHash.toLowerCase(),
      events,
      count: events.length,
    });
  } catch (err) {
    console.error(`  💥 [API] /events/tx error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /alerts
 * Query alerts with filters
 * 
 * Query params:
 *   - chain: Chain slug
 *   - ruleId: Rule ID
 *   - severity: Severity level (low, medium, high, critical)
 *   - alertType: Alert type (instant, aggregated)
 *   - notified: Notified status (true/false)
 *   - limit: Max results (default: 100, max: 1000)
 */
app.get("/alerts", async (req, res) => {
  try {
    const { chain, ruleId, severity, alertType, notified, limit } = req.query;
    
    const filters = {};
    if (chain) filters.chain = chain;
    if (ruleId) filters.ruleId = ruleId;
    if (severity) filters.severity = severity;
    if (alertType) filters.alertType = alertType;
    if (notified !== undefined) filters.notified = notified === "true";

    const maxLimit = Math.min(parseInt(limit || "100", 10), 1000);

    const alerts = await alertRepo.getRecent(filters, maxLimit);
    const total = await alertRepo.getCount(filters);

    res.json({
      alerts,
      total,
      limit: maxLimit,
      filters,
    });
  } catch (err) {
    console.error(`  💥 [API] /alerts error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /alerts/stats
 * Get alert statistics
 * 
 * Query params:
 *   - chain: Chain slug (required)
 */
app.get("/alerts/stats", async (req, res) => {
  try {
    const { chain } = req.query;
    
    if (!chain) {
      return res.status(400).json({ error: "chain parameter required" });
    }

    const stats = await alertRepo.getStats(chain);

    res.json({
      chain,
      stats: {
        totalAlerts: parseInt(stats.total_alerts, 10),
        totalEvents: parseInt(stats.total_events, 10),
        bySeverity: {
          low: parseInt(stats.low_count, 10),
          medium: parseInt(stats.medium_count, 10),
          high: parseInt(stats.high_count, 10),
          critical: parseInt(stats.critical_count, 10),
        },
        byType: {
          instant: parseInt(stats.instant_count, 10),
          aggregated: parseInt(stats.aggregated_count, 10),
        },
        notified: parseInt(stats.notified_count, 10),
      },
    });
  } catch (err) {
    console.error(`  💥 [API] /alerts/stats error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /alerts/rule/:ruleId
 * Get alerts for a specific rule
 */
app.get("/alerts/rule/:ruleId", async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { limit } = req.query;

    const maxLimit = Math.min(parseInt(limit || "100", 10), 1000);
    const alerts = await alertRepo.getByRule(ruleId, maxLimit);

    res.json({
      ruleId,
      alerts,
      count: alerts.length,
      limit: maxLimit,
    });
  } catch (err) {
    console.error(`  💥 [API] /alerts/rule error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /
 * API documentation
 */
app.get("/", (req, res) => {
  res.json({
    name: "Genesis API",
    version: "1.0.0",
    description: "REST API for querying blockchain events and alerts",
    endpoints: {
      health: "GET /health",
      events: {
        list: "GET /events?chain=ethereum&eventType=ERC20_TRANSFER&limit=100",
        stats: "GET /events/stats?chain=ethereum",
        byBlock: "GET /events/block/:chain/:blockNumber",
        byContract: "GET /events/contract/:address",
        byTx: "GET /events/tx/:txHash",
      },
      alerts: {
        list: "GET /alerts?chain=ethereum&severity=high&limit=100",
        stats: "GET /alerts/stats?chain=ethereum",
        byRule: "GET /alerts/rule/:ruleId",
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(`  💥 [API] Unhandled error: ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function start() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║              🧬 GENESIS — REST API Server               ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();

  // Connect to database
  db = new Database(config.database);
  await db.connect();

  // Initialize repositories
  eventRepo = new EventRepository(db);
  alertRepo = new AlertRepository(db);

  // Start Express server
  const port = config.api.port;
  const host = config.api.host;

  app.listen(port, host, () => {
    console.log();
    console.log(`  🚀 API server running at http://${host}:${port}`);
    console.log(`  📚 Documentation: http://${host}:${port}/`);
    console.log();
    console.log("  Available endpoints:");
    console.log(`     GET /health`);
    console.log(`     GET /events`);
    console.log(`     GET /events/stats?chain=ethereum`);
    console.log(`     GET /events/block/:chain/:blockNumber`);
    console.log(`     GET /events/contract/:address`);
    console.log(`     GET /events/tx/:txHash`);
    console.log(`     GET /alerts`);
    console.log(`     GET /alerts/stats?chain=ethereum`);
    console.log(`     GET /alerts/rule/:ruleId`);
    console.log();
    console.log("  (Press Ctrl+C to stop)");
    console.log();
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n  🛑 Shutting down API server...");
  await db.close();
  process.exit(0);
});

start().catch((err) => {
  console.error("\n  💥 Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
