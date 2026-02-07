/**
 * Genesis — On-Chain API Server
 *
 * Bridges smart contract events → Insight Formatter → Dashboard (SSE) + Telegram
 *
 * Endpoints:
 *   GET  /                   → On-chain control panel dashboard
 *   GET  /api/events         → SSE stream of live contract events
 *   GET  /api/onchain-stats  → Current listener stats
 *   POST /api/threshold      → Set a new threshold (writes to contract)
 *   GET  /api/alerts         → Query on-chain alert history
 *
 * Usage:
 *   node src/onchain-server.js
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const ContractListener = require("./contract-listener");
const InsightFormatter = require("./ai/insight-formatter");
const { Database, EventRepository, AlertRepository } = require("./db");
const AnomalyDetector = require("./engine/anomaly-detector");
const WalletProfiler = require("./engine/wallet-profiler");

// ── SQLite Database ──────────────────────────────────────────────────────
const db = new Database({
  path: process.env.DATABASE_PATH || path.resolve(__dirname, "../data/genesis.db"),
});
let eventRepo = null;
let alertRepo = null;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../public")));

// ── Telegram Bot ─────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendToTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    console.log("  📨 [Telegram] Alert sent!");
  } catch (err) {
    console.error(`  ⚠️  [Telegram] Failed: ${err.message}`);
  }
}

// ── SSE clients ──────────────────────────────────────────────────────────
const sseClients = [];

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => {
    try { res.write(msg); } catch (e) {}
  });
}

// ── Contract Listener ────────────────────────────────────────────────────
const listener = new ContractListener();
const formatter = new InsightFormatter({
  geminiApiKey: process.env.GEMINI_API_KEY,
});

// ── Intelligence Layer ───────────────────────────────────────────────────
const anomalyDetector = new AnomalyDetector();
const walletProfiler = new WalletProfiler();
const intelligenceLog = [];

walletProfiler.on("pattern", (pattern) => {
  intelligenceLog.push(pattern);
  if (intelligenceLog.length > 300) intelligenceLog.splice(0, 100);
  broadcastSSE({ type: "intelligence_pattern", ...pattern });
});

// Wire events
listener.on("event", async (event) => {
  // Regular events use local formatter (saves AI budget for important alerts)
  const insight = formatter.formatLocal(event);
  broadcastSSE({ ...event, insight });

  // Feed intelligence layer
  try {
    const amount = Number(event.amount || event.depositAmount || event.withdrawAmount || event.amountIn || 0) / 1e6;
    if (amount > 0) {
      anomalyDetector.recordTransfer("gUSD", String(BigInt(Math.round(amount * 1e6))), 6);
      const anomaly = anomalyDetector.detectTransferAnomaly("gUSD", amount);
      if (anomaly) {
        intelligenceLog.push({ type: "anomaly", ...anomaly, event: event.type, timestamp: Date.now() });
        broadcastSSE({ type: "intelligence_anomaly", ...anomaly });
      }
    }
    const wallet = event.user || event.from || event.voter || event.beneficiary || event.proposer || "";
    if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
      const actionMap = {
        deposit: "deposit", withdrawal: "withdraw", large_movement: "deposit",
        internal_transfer: "transfer", swap: "swap",
        governance_vote: "vote", governance_proposal_created: "propose",
        vesting_created: "vest", vesting_claimed: "claim",
        liquidity_added: "add_liquidity", liquidity_removed: "remove_liquidity",
      };
      walletProfiler.recordAction({
        wallet, action: actionMap[event.type] || event.type,
        contract: event.contract || "unknown", amount,
        txHash: event.txHash || "", blockNumber: event.blockNumber || 0,
      });
    }
  } catch (err) { /* silent */ }

  // Persist to SQLite
  if (eventRepo) {
    try {
      await eventRepo.save({
        id: `${event.txHash}-${event.type}-${Date.now()}`,
        chain: "localhost",
        chainId: 31337,
        blockNumber: event.blockNumber || 0,
        blockHash: "",
        timestamp: event.timestamp || Math.floor(Date.now() / 1000),
        txHash: event.txHash || "",
        logIndex: 0,
        contract: event.contract || "",
        eventName: event.type,
        eventType: event.type,
        args: event,
        finality: "confirmed",
      });
    } catch (err) {
      console.error(`  ⚠️  [DB] Event save failed: ${err.message}`);
    }
  }
});

listener.on("alert", async (alert) => {
  const insight = await formatter.format(alert);
  broadcastSSE({ ...alert, insight });

  // Log the formatted insight
  console.log();
  console.log(`  🧠 INSIGHT: ${insight.title}`);
  console.log(`     ${insight.summary}`);
  console.log(`     💡 ${insight.recommendation}`);
  console.log();

  // Persist to SQLite
  if (alertRepo) {
    try {
      await alertRepo.save({
        alertId: `alert-${alert.type}-${Date.now()}`,
        type: "instant",
        rule: {
          rule_id: alert.type,
          name: alert.type.replace(/_/g, " ").toUpperCase(),
          severity: alert.severity || "medium",
        },
        chain: "localhost",
        eventIds: [],
        events: [],
        event: {
          chain: "localhost",
          blockNumber: alert.blockNumber || 0,
        },
        data: alert,
        notified: true,
        notifiedAt: Math.floor(Date.now() / 1000),
        notificationChannels: ["sse", "telegram"],
      });
    } catch (err) {
      console.error(`  ⚠️  [DB] Alert save failed: ${err.message}`);
    }
  }

  // Send to Telegram if configured
  sendToTelegram(formatter.toTelegram(insight));
});

listener.on("threshold_change", (data) => {
  broadcastSSE({ ...data, type: "threshold_change" });
});

listener.on("alert_recorded", (data) => {
  broadcastSSE({ ...data, type: "alert_recorded" });
});

// ── Routes ───────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname, "../public/onchain.html"));
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("data: {\"type\":\"connected\"}\n\n");
  sseClients.push(res);
  req.on("close", () => {
    const idx = sseClients.indexOf(res);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
});

app.get("/api/onchain-stats", (req, res) => {
  res.json({
    ...listener.getStats(),
    ai: formatter.getAIStats(),
  });
});

app.post("/api/threshold", async (req, res) => {
  const { alertType, threshold, cooldown, description } = req.body;
  console.log(`  ⚙️  [API] Threshold set request: type=${alertType} amount=$${threshold} cooldown=${cooldown}s`);
  console.log(`     "${description}"`);

  try {
    const { ethers } = require("ethers");
    const fs2 = require("fs");
    const deployment = JSON.parse(
      fs2.readFileSync(path.resolve(__dirname, "../deployments/localhost.json"), "utf8")
    );
    const abi = JSON.parse(
      fs2.readFileSync(
        path.resolve(__dirname, "../artifacts/contracts/ThresholdEngine.sol/ThresholdEngine.json"),
        "utf8"
      )
    ).abi;

    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const signer = await provider.getSigner(0); // deployer
    const engine = new ethers.Contract(deployment.contracts.ThresholdEngine.address, abi, signer);

    const alertTypeMap = { LARGE_TRANSFER: 0, WHALE_MOVEMENT: 1, RAPID_FLOW: 2, CUSTOM: 3 };
    const typeIdx = alertTypeMap[alertType] ?? 3;
    const tokenAddr = deployment.contracts.GenesisToken.address;
    const thresholdUnits = BigInt(Math.round(threshold * 1e6));

    const tx = await engine.setGlobalThreshold(
      tokenAddr,
      typeIdx,
      thresholdUnits,
      cooldown || 120,
      description || `Alert on amounts above $${threshold}`
    );
    const receipt = await tx.wait();

    console.log(`  ✅ [API] Threshold written ON-CHAIN in tx ${receipt.hash.slice(0, 18)}...`);
    res.json({ success: true, txHash: receipt.hash, message: "Threshold written to smart contract!" });
  } catch (err) {
    console.error(`  ❌ [API] Threshold write failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/alerts", async (req, res) => {
  try {
    const { ethers } = require("ethers");
    const fs = require("fs");
    const deployment = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../deployments/localhost.json"), "utf8")
    );
    const abi = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../artifacts/contracts/AlertRegistry.sol/AlertRegistry.json"),
        "utf8"
      )
    ).abi;

    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const registry = new ethers.Contract(deployment.contracts.AlertRegistry.address, abi, provider);
    const count = Number(await registry.alertCount());
    const alerts = [];
    for (let i = 0; i < count; i++) {
      const a = await registry.getAlert(i);
      alerts.push({
        id: Number(a.id),
        triggeredBy: a.triggeredBy,
        amount: (Number(a.amount) / 1e6).toFixed(2),
        severity: ["LOW", "MEDIUM", "HIGH", "CRITICAL"][Number(a.severity)],
        alertType: a.alertType,
        summary: a.summary,
        blockNumber: Number(a.blockNumber),
      });
    }
    res.json({ count, alerts });
  } catch (err) {
    res.json({ count: 0, alerts: [], error: err.message });
  }
});

// ── Dashboard route ──────────────────────────────────────────────────────
app.get("/dashboard", (req, res) => {
  res.sendFile(path.resolve(__dirname, "../public/dashboard.html"));
});

// ── History APIs (powered by SQLite) ─────────────────────────────────────

// GET /api/history/events — query stored events from SQLite
app.get("/api/history/events", async (req, res) => {
  if (!eventRepo) return res.json({ events: [], message: "Database not initialized" });

  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const eventType = req.query.type;

    let query = "SELECT * FROM events";
    const params = [];

    if (eventType) {
      query += " WHERE event_type = ?";
      params.push(eventType);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const result = db.query(query, params);
    const events = result.rows.map((row) => ({
      ...row,
      args: row.args ? JSON.parse(row.args) : {},
    }));

    res.json({ count: events.length, events });
  } catch (err) {
    res.json({ events: [], error: err.message });
  }
});

// GET /api/history/alerts — query stored alerts from SQLite
app.get("/api/history/alerts", async (req, res) => {
  if (!alertRepo) return res.json({ alerts: [], message: "Database not initialized" });

  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const severity = req.query.severity;

    let query = "SELECT * FROM alerts";
    const params = [];

    if (severity) {
      query += " WHERE severity = ?";
      params.push(severity);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const result = db.query(query, params);
    const alerts = result.rows.map((row) => ({
      ...row,
      data: row.data ? JSON.parse(row.data) : {},
      event_ids: row.event_ids ? JSON.parse(row.event_ids) : [],
    }));

    res.json({ count: alerts.length, alerts });
  } catch (err) {
    res.json({ alerts: [], error: err.message });
  }
});

// GET /api/history/stats — aggregate stats from SQLite
app.get("/api/history/stats", async (req, res) => {
  if (!db._isConnected) return res.json({ message: "Database not initialized" });

  try {
    const totalEvents = db.query("SELECT COUNT(*) as count FROM events");
    const totalAlerts = db.query("SELECT COUNT(*) as count FROM alerts");
    const eventTypes = db.query(
      "SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type ORDER BY count DESC"
    );
    const recentEvents = db.query(
      "SELECT event_type, block_number, tx_hash, created_at FROM events ORDER BY created_at DESC LIMIT 10"
    );

    res.json({
      totalEvents: totalEvents.rows[0]?.count || 0,
      totalAlerts: totalAlerts.rows[0]?.count || 0,
      eventBreakdown: eventTypes.rows,
      recentEvents: recentEvents.rows,
      dbStats: db.getStats(),
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// GET /api/db-status — check if database is connected
app.get("/api/db-status", (req, res) => {
  res.json({
    connected: db._isConnected,
    healthy: db._isConnected ? db.healthCheck() : false,
    stats: db._isConnected ? db.getStats() : null,
  });
});

// ── Intelligence API endpoints ────────────────────────────────────────────
app.get("/api/intelligence/stats", (req, res) => {
  res.json({
    walletProfiler: walletProfiler.getStats(),
    anomalyDetector: anomalyDetector.getStats(),
    recentPatterns: walletProfiler.getRecentPatterns(20),
    intelligenceEvents: intelligenceLog.length,
  });
});

app.get("/api/intelligence/wallets", (req, res) => {
  res.json({
    leaderboard: walletProfiler.getRiskLeaderboard(),
    stats: walletProfiler.getStats(),
  });
});

app.get("/api/intelligence/wallet/:address", (req, res) => {
  const profile = walletProfiler.getProfile(req.params.address);
  if (!profile) return res.json({ error: "Wallet not found" });
  res.json({
    address: profile.address,
    riskScore: profile.riskScore,
    riskLevel: profile.riskLevel,
    totalTxCount: profile.totalTxCount,
    totalVolume: profile.totalVolume,
    contractsTouched: [...profile.contractsTouched],
    contractActivity: profile.contractActivity,
    patterns: walletProfiler.getWalletPatterns(req.params.address),
    recentActions: profile.actions.slice(-20),
  });
});

app.get("/api/intelligence/patterns", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({
    patterns: walletProfiler.getRecentPatterns(limit),
    breakdown: walletProfiler.getStats().patternBreakdown,
  });
});

app.get("/api/intelligence/anomalies", (req, res) => {
  const anomalies = intelligenceLog.filter((l) => l.type === "anomaly");
  res.json({
    count: anomalies.length,
    anomalies: anomalies.slice(-50).reverse(),
    tokenStats: anomalyDetector.getStats(),
  });
});

// Serve intelligence dashboard
app.get("/intelligence", (req, res) => {
  res.sendFile(path.resolve(__dirname, "../public/intelligence.html"));
});

// ── Start ────────────────────────────────────────────────────────────────
const PORT = process.env.ONCHAIN_PORT || 3001;

async function start() {
  // Initialize SQLite database
  try {
    await db.connect();
    await db.migrate();
    eventRepo = new EventRepository(db);
    alertRepo = new AlertRepository(db);
    console.log("  🗄️  [Database] SQLite connected — events & alerts will be persisted");
  } catch (err) {
    console.error(`  ⚠️  [Database] SQLite init failed (continuing without persistence): ${err.message}`);
  }

  await listener.start();
  app.listen(PORT, () => {
    console.log();
    console.log(`  🌐 On-Chain Dashboard:  http://localhost:${PORT}`);
    console.log(`  📡 Event Stream:        http://localhost:${PORT}/api/events`);
    console.log(`  📊 Stats API:           http://localhost:${PORT}/api/onchain-stats`);
    console.log(`  📜 Alert History:       http://localhost:${PORT}/api/alerts`);
    console.log(`  🧠 Intelligence:        http://localhost:${PORT}/intelligence`);
    console.log(`  🗄️  Event History (DB):  http://localhost:${PORT}/api/history/events`);
    console.log(`  🗄️  Alert History (DB):  http://localhost:${PORT}/api/history/alerts`);
    console.log(`  📊 DB Stats:            http://localhost:${PORT}/api/history/stats`);
    console.log(`  📋 Full Dashboard:      http://localhost:${PORT}/dashboard`);
    console.log();
  });
}

start().catch((err) => {
  console.error("💥 Failed to start on-chain server:", err.message);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await listener.stop();
  if (db._isConnected) {
    await db.close();
    console.log("  🗄️  [Database] SQLite closed gracefully");
  }
  process.exit(0);
});
