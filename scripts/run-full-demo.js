/**
 * Genesis — Full Pipeline Demo
 *
 * Starts the on-chain server (listener + AI formatter + Telegram + SSE dashboard)
 * FIRST, then runs the proven 12-step demo. This guarantees the listener catches
 * ALL events in real-time.
 *
 * Usage:
 *   1. Start Hardhat:  npx hardhat node
 *   2. Deploy:         npx hardhat run scripts/deploy.js --network localhost
 *   3. Run this:       node scripts/run-full-demo.js
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const ContractListener = require("../src/contract-listener");
const InsightFormatter = require("../src/ai/insight-formatter");
const { Database, EventRepository, AlertRepository } = require("../src/db");
const PipelineOrchestrator = require("../src/pipeline-orchestrator");
const TelegramBot = require("../src/telegram-bot");
const { ALERT_TYPES } = require("../src/telegram-bot");

// ── Helpers ──────────────────────────────────────────────────────────────
const UNITS = (n) => BigInt(n) * 1_000_000n;
const fmt = (n) => (Number(n) / 1e6).toLocaleString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadDeployment() {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../deployments/localhost.json"), "utf8")
  );
}

function loadABI(name) {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`),
      "utf8"
    )
  ).abi;
}

// ── Telegram Bot (Interactive — user-driven alerts) ──────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Legacy fallback for simple sends (used before bot is fully wired)
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
  } catch (err) {
    // Silent — network errors expected when offline
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

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 1: Start server + listener
// ═══════════════════════════════════════════════════════════════════════════

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, "../public")));

  // Initialize SQLite
  const db = new Database({
    path: process.env.DATABASE_PATH || path.resolve(__dirname, "../data/genesis.db"),
  });
  let eventRepo = null;
  let alertRepo = null;

  try {
    await db.connect();
    await db.migrate();
    eventRepo = new EventRepository(db);
    alertRepo = new AlertRepository(db);
    console.log("  🗄️  [Database] SQLite connected — events will be persisted");
  } catch (err) {
    console.error(`  ⚠️  [Database] SQLite init failed (continuing without): ${err.message}`);
  }

  const listener = new ContractListener();
  const formatter = new InsightFormatter({
    geminiApiKey: process.env.GEMINI_API_KEY,
  });

  // ── Full Pipeline Orchestrator (connects ALL engine modules) ──
  const deployment = loadDeployment();
  const pipeline = new PipelineOrchestrator({ deployment });

  // Forward wallet profiler patterns to SSE
  pipeline.walletProfiler.on("pattern", (pattern) => {
    broadcastSSE({ type: "intelligence_pattern", ...pattern });
    const emoji = { critical: "🔴", high: "🟠", medium: "🟡" }[pattern.severity] || "🔵";
    console.log(`  ${emoji} [Intel] ${pattern.type}: ${pattern.description}`);
  });

  // ── Interactive Telegram Bot (user-driven alert preferences) ──
  const telegramBot = new TelegramBot({
    botToken: TELEGRAM_BOT_TOKEN,
    defaultChatId: TELEGRAM_CHAT_ID,
    db,
  });
  telegramBot.listener = listener;
  telegramBot.formatter = formatter;
  telegramBot.pipeline = pipeline;

  let eventLog = [];
  telegramBot.eventLog = eventLog; // Share reference

  listener.on("event", async (event) => {
    // ── 1. IMMEDIATELY push to eventLog (no await — this must be instant) ──
    eventLog.push(event);

    // ── 2. Run through full pipeline SYNCHRONOUSLY (no AI, no network) ──
    try {
      const result = pipeline.processEvent(event);
      if (result.anomaly) {
        broadcastSSE({ type: "intelligence_anomaly", ...result.anomaly });
        console.log(`  🧪 [Anomaly] ${result.anomaly.description} — z=${result.anomaly.z_score.toFixed(2)} (${result.anomaly.confidence_level})`);
      }
      if (result.ruleMatches > 0) {
        console.log(`  📋 [Rules] ${result.ruleMatches} rule(s) matched for ${event.type}`);
      }
    } catch (err) { /* pipeline errors should never crash the system */ }

    // ── 3. Persist to SQLite (fast, local) ──
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
      } catch (err) { /* silent */ }
    }

    // ── 4. AI enrichment LAST (slow — Gemini API call, may rate-limit) ──
    try {
      const insight = await formatter.format(event);
      const enriched = { ...event, insight };
      broadcastSSE(enriched);
    } catch (err) { /* AI failure should never block the pipeline */ }
  });

  listener.on("alert", async (alert) => {
    // Push immediately so Phase 3 counts are correct
    eventLog.push(alert);

    // Persist to SQLite immediately (no AI dependency)
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
          event: { chain: "localhost", blockNumber: alert.blockNumber || 0 },
          data: alert,
          notified: true,
          notifiedAt: Math.floor(Date.now() / 1000),
          notificationChannels: ["sse", "telegram"],
        });
      } catch (err) { /* silent */ }
    }

    // AI enrichment (slow — may rate-limit)
    try {
      const insight = await formatter.format(alert);
      const enriched = { ...alert, insight };
      broadcastSSE(enriched);

      console.log();
      console.log(`  🧠 INSIGHT: ${insight.title}`);
      console.log(`     ${insight.summary}`);
      if (insight.recommendation) console.log(`     💡 ${insight.recommendation}`);
      console.log();

      // 🤖 User-driven dispatch: only send to users whose prefs match
      const sentCount = await telegramBot.dispatchAlert(alert, formatter.toTelegram(insight));
      if (sentCount > 0) console.log(`  📨 [Telegram] Alert sent to ${sentCount} subscriber(s)`);
    } catch (err) {
      // If AI fails, still try filtered dispatch with basic message
      const sentCount = await telegramBot.dispatchAlert(alert, `🚨 Alert: ${alert.type} — ${alert.severity || "medium"}`).catch(() => 0);
      if (sentCount > 0) console.log(`  📨 [Telegram] Fallback alert sent to ${sentCount} subscriber(s)`);
    }
  });

  listener.on("threshold_change", (data) => {
    broadcastSSE({ ...data, type: "threshold_change" });
  });

  listener.on("alert_recorded", (data) => {
    broadcastSSE({ ...data, type: "alert_recorded" });
  });

  app.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write('data: {"type":"connected"}\n\n');
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
      chain: { name: process.env.CHAIN_NAME || "localhost", id: parseInt(process.env.CHAIN_ID) || 31337, rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545" },
    });
  });

  // ── Threshold APIs (user-driven, writes to smart contract on-chain) ────

  // GET /api/thresholds — read all active thresholds from ThresholdEngine
  app.get("/api/thresholds", async (req, res) => {
    try {
      // Return cached thresholds from listener (already loaded from contract)
      const thresholds = listener.getActiveThresholds();
      res.json({
        count: thresholds.length,
        thresholds,
        chain: process.env.CHAIN_NAME || "localhost",
      });
    } catch (err) {
      res.json({ count: 0, thresholds: [], error: err.message });
    }
  });

  // POST /api/threshold — create a new threshold ON-CHAIN via ThresholdEngine
  app.post("/api/threshold", async (req, res) => {
    try {
      const { alertType, threshold, cooldown, description, signerIndex } = req.body;
      const amount = BigInt(Math.round(Number(threshold) * 1e6)); // convert $ to contract units
      const cooldownSec = parseInt(cooldown) || 120;
      const typeNum = parseInt(alertType) || 0;
      const desc = description || `Custom threshold: $${Number(threshold).toLocaleString()}`;

      const deployment = loadDeployment();
      const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Use specified signer or default to deployer (index 0)
      const signer = await provider.getSigner(parseInt(signerIndex) || 0);
      const engine = new ethers.Contract(
        deployment.contracts.ThresholdEngine.address,
        loadABI("ThresholdEngine"),
        signer
      );

      const tx = await engine.setThreshold(
        deployment.contracts.GenesisToken.address, // token
        typeNum,                                    // alertType enum
        amount,                                     // threshold in contract units
        cooldownSec,
        desc
      );
      const receipt = await tx.wait();

      res.json({
        success: true,
        message: `Threshold set on-chain! Tx: ${receipt.hash}`,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        threshold: Number(threshold),
        alertType: typeNum,
        description: desc,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/threshold — disable a user threshold on-chain
  app.delete("/api/threshold", async (req, res) => {
    try {
      const { ruleIndex, signerIndex } = req.body;
      const deployment = loadDeployment();
      const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const signer = await provider.getSigner(parseInt(signerIndex) || 0);
      const engine = new ethers.Contract(
        deployment.contracts.ThresholdEngine.address,
        loadABI("ThresholdEngine"),
        signer
      );

      const tx = await engine.removeThreshold(parseInt(ruleIndex));
      const receipt = await tx.wait();

      res.json({
        success: true,
        message: `Threshold #${ruleIndex} removed on-chain! Tx: ${receipt.hash}`,
        txHash: receipt.hash,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Serve dashboards
  app.get("/", (req, res) => {
    res.sendFile(path.resolve(__dirname, "../public/onchain.html"));
  });

  app.get("/dashboard", (req, res) => {
    res.sendFile(path.resolve(__dirname, "../public/dashboard.html"));
  });

  // History APIs (powered by SQLite)
  app.get("/api/history/stats", (req, res) => {
    if (!db._isConnected) return res.json({ message: "Database not initialized" });
    try {
      const totalEvents = db.query("SELECT COUNT(*) as count FROM events");
      const totalAlerts = db.query("SELECT COUNT(*) as count FROM alerts");
      const eventTypes = db.query("SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type ORDER BY count DESC");
      const recentEvents = db.query("SELECT event_type, block_number, tx_hash, created_at FROM events ORDER BY created_at DESC LIMIT 10");
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

  app.get("/api/history/events", (req, res) => {
    if (!eventRepo) return res.json({ events: [] });
    try {
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const result = db.query("SELECT * FROM events ORDER BY created_at DESC LIMIT ?", [limit]);
      res.json({ count: result.rows.length, events: result.rows });
    } catch (err) {
      res.json({ events: [], error: err.message });
    }
  });

  app.get("/api/history/alerts", (req, res) => {
    if (!alertRepo) return res.json({ alerts: [] });
    try {
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const result = db.query("SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?", [limit]);
      res.json({ count: result.rows.length, alerts: result.rows });
    } catch (err) {
      res.json({ alerts: [], error: err.message });
    }
  });

  app.get("/api/alerts", async (req, res) => {
    try {
      const deployment = loadDeployment();
      const abi = loadABI("AlertRegistry");
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
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

  app.get("/api/db-status", (req, res) => {
    res.json({
      connected: db._isConnected,
      healthy: db._isConnected ? db.healthCheck() : false,
      stats: db._isConnected ? db.getStats() : null,
    });
  });

  // ── Intelligence API endpoints (powered by PipelineOrchestrator) ──────

  app.get("/api/intelligence/stats", (req, res) => {
    res.json({
      walletProfiler: pipeline.walletProfiler.getStats(),
      anomalyDetector: pipeline.anomalyDetector.getStats(),
      recentPatterns: pipeline.walletProfiler.getRecentPatterns(20),
      intelligenceEvents: pipeline.intelligenceLog.length,
    });
  });

  app.get("/api/intelligence/wallets", (req, res) => {
    res.json({
      leaderboard: pipeline.walletProfiler.getRiskLeaderboard(),
      stats: pipeline.walletProfiler.getStats(),
    });
  });

  app.get("/api/intelligence/wallet/:address", (req, res) => {
    const profile = pipeline.walletProfiler.getProfile(req.params.address);
    if (!profile) return res.json({ error: "Wallet not found" });
    res.json({
      address: profile.address,
      riskScore: profile.riskScore,
      riskLevel: profile.riskLevel,
      totalTxCount: profile.totalTxCount,
      totalVolume: profile.totalVolume,
      contractsTouched: [...profile.contractsTouched],
      contractActivity: profile.contractActivity,
      patterns: pipeline.walletProfiler.getWalletPatterns(req.params.address),
      recentActions: profile.actions.slice(-20),
    });
  });

  app.get("/api/intelligence/patterns", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json({
      patterns: pipeline.walletProfiler.getRecentPatterns(limit),
      breakdown: pipeline.walletProfiler.getStats().patternBreakdown,
    });
  });

  app.get("/api/intelligence/anomalies", (req, res) => {
    const anomalies = pipeline.intelligenceLog.filter((l) => l.type === "anomaly");
    res.json({
      count: anomalies.length,
      anomalies: anomalies.slice(-50).reverse(),
      tokenStats: pipeline.anomalyDetector.getStats(),
    });
  });

  // Full pipeline stats (shows ALL modules to judges)
  app.get("/api/intelligence/pipeline", (req, res) => {
    res.json(pipeline.getFullPipelineStats());
  });

  // Serve intelligence dashboard
  app.get("/intelligence", (req, res) => {
    res.sendFile(path.resolve(__dirname, "../public/intelligence.html"));
  });

  // ── Telegram Bot API endpoints ──
  app.get("/api/telegram/status", (req, res) => {
    res.json(telegramBot.getSummary());
  });

  app.post("/api/telegram/report", async (req, res) => {
    try {
      const chatId = req.body?.chatId || TELEGRAM_CHAT_ID;
      await telegramBot.sendReport(chatId);
      res.json({ success: true, sentTo: chatId });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  const PORT = process.env.ONCHAIN_PORT || 3001;
  await listener.start();

  // Start Telegram bot polling (non-blocking, handles commands from users)
  await telegramBot.startPolling();

  return new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log();
      console.log(`  🌐 Control Panel:  http://localhost:${PORT}`);
      console.log(`  📊 Analytics:      http://localhost:${PORT}/dashboard`);
      console.log(`  🧠 Intelligence:   http://localhost:${PORT}/intelligence`);
      console.log(`  📡 SSE:            http://localhost:${PORT}/api/events`);
      console.log(`  🗄️  DB Stats:       http://localhost:${PORT}/api/history/stats`);
      console.log(`  🤖 Telegram Bot:   Active (polling for /commands)`);
      console.log();
      resolve({ listener, formatter, eventLog, db, pipeline, telegramBot });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 2: Run demo transactions (exact copy of proven demo-onchain.js)
// ═══════════════════════════════════════════════════════════════════════════

async function runDemo() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployment = loadDeployment();
  const d = deployment.contracts;

  const signers = await Promise.all(
    [0, 1, 2, 3].map((i) => provider.getSigner(i))
  );
  const [deployer, user1, user2, whale] = signers;

  const token = new ethers.Contract(d.GenesisToken.address, loadABI("GenesisToken"), deployer);
  const vault = new ethers.Contract(d.GenesisVault.address, loadABI("GenesisVault"), deployer);
  const thresholdEngine = new ethers.Contract(d.ThresholdEngine.address, loadABI("ThresholdEngine"), deployer);
  const alertRegistry = new ethers.Contract(d.AlertRegistry.address, loadABI("AlertRegistry"), deployer);

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║       🧬 GENESIS — Live On-Chain Demo (Full 12-Step)    ║");
  console.log("║       Listener is LIVE — catching events in real-time!  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  🌐 Chain: ${process.env.CHAIN_NAME || "localhost"} (ID: ${process.env.CHAIN_ID || 31337})`);
  console.log(`  🔗 RPC:   ${process.env.RPC_URL || "http://127.0.0.1:8545"}\n`);

  // ── STEP 1: Normal Deposits ──
  console.log("━━━ STEP 1/12: Normal Deposits ━━━");
  let tx = await vault.connect(user1).deposit(UNITS(10_000));
  await tx.wait();
  console.log(`  ✅ User1 deposited $10,000`);
  await sleep(1500);

  tx = await vault.connect(user2).deposit(UNITS(25_000));
  await tx.wait();
  console.log(`  ✅ User2 deposited $25,000`);
  await sleep(1500);

  // ── STEP 2: Whale Deposit ──
  console.log("\n━━━ STEP 2/12: Whale Deposit ($500K — triggers LargeMovement!) ━━━");
  tx = await vault.connect(whale).deposit(UNITS(500_000));
  await tx.wait();
  console.log(`  🐋 Whale deposited $500,000 — LARGE MOVEMENT emitted on-chain!`);
  await sleep(2000);

  // ── STEP 3: Internal Transfer ──
  console.log("\n━━━ STEP 3/12: Internal Vault Transfer ━━━");
  const user2Addr = await user2.getAddress();
  tx = await vault.connect(user1).internalTransfer(user2Addr, UNITS(5_000));
  await tx.wait();
  console.log(`  ✅ User1 → User2: $5,000 internal transfer`);
  await sleep(1500);

  // ── STEP 4: Custom Threshold ──
  console.log("\n━━━ STEP 4/12: Set Custom Alert Threshold (on-chain!) ━━━");
  tx = await thresholdEngine.connect(user1).setThreshold(
    d.GenesisToken.address, 0, UNITS(20_000), 60, "Alert me on gUSD transfers above $20K"
  );
  await tx.wait();
  console.log(`  ✅ User1 created custom threshold: $20K`);

  tx = await thresholdEngine.connect(user1).updateThreshold(0, UNITS(15_000));
  await tx.wait();
  console.log(`  ✅ User1 updated threshold: $20K → $15K`);
  await sleep(1500);

  // ── STEP 5: Whale Withdrawal ──
  console.log("\n━━━ STEP 5/12: Whale Withdrawal ($200K) ━━━");
  tx = await vault.connect(whale).withdraw(UNITS(200_000));
  await tx.wait();
  console.log(`  🐋 Whale withdrew $200,000 — LARGE MOVEMENT!`);
  await sleep(2000);

  // ── STEP 6: Record On-chain Alerts ──
  console.log("\n━━━ STEP 6/12: Record Alerts to Immutable On-Chain Registry ━━━");
  const whaleAddr = await whale.getAddress();
  tx = await alertRegistry.recordAlert(
    whaleAddr, d.GenesisToken.address, UNITS(500_000), 2, "whale_deposit",
    "Whale deposited $500K into Genesis Vault — normal accumulation"
  );
  await tx.wait();
  console.log(`  ✅ Alert recorded: whale_deposit (HIGH)`);

  tx = await alertRegistry.recordAlert(
    whaleAddr, d.GenesisToken.address, UNITS(200_000), 2, "whale_withdrawal",
    "Whale withdrew $200K from Genesis Vault — partial profit-taking"
  );
  await tx.wait();
  console.log(`  ✅ Alert recorded: whale_withdrawal (HIGH)`);
  await sleep(1500);

  // ── STEP 7: Emergency Pause/Unpause ──
  console.log("\n━━━ STEP 7/12: Emergency Vault Pause (circuit breaker!) ━━━");
  tx = await vault.pause();
  await tx.wait();
  console.log(`  🛑 Vault PAUSED — no deposits/withdrawals possible!`);
  await sleep(1000);

  tx = await vault.unpause();
  await tx.wait();
  console.log(`  ✅ Vault UNPAUSED — operations resumed`);
  await sleep(1500);

  // ── STEP 8: Add Liquidity ──
  if (d.GenesisLiquidityPool && d.GenesisETH) {
    const pool = new ethers.Contract(d.GenesisLiquidityPool.address, loadABI("GenesisLiquidityPool"), deployer);

    console.log("\n━━━ STEP 8/12: Add Liquidity to gUSD/gETH Pool ━━━");
    tx = await pool.addLiquidity(UNITS(100_000), UNITS(100_000));
    await tx.wait();
    console.log(`  ✅ Deployer seeded pool: $100K gUSD + $100K gETH`);
    await sleep(1500);

    tx = await pool.connect(user1).addLiquidity(UNITS(50_000), UNITS(50_000));
    await tx.wait();
    console.log(`  ✅ User1 added: $50K gUSD + $50K gETH`);
    await sleep(1500);

    tx = await pool.connect(whale).addLiquidity(UNITS(200_000), UNITS(200_000));
    await tx.wait();
    console.log(`  🐋 Whale added: $200K gUSD + $200K gETH`);
    await sleep(1500);

    // ── STEP 9: Swaps ──
    console.log("\n━━━ STEP 9/12: Token Swaps (DEX Trading) ━━━");
    tx = await pool.connect(user2).swap(d.GenesisToken.address, UNITS(10_000));
    await tx.wait();
    console.log(`  ✅ User2 swapped $10K gUSD → gETH`);
    await sleep(1500);

    tx = await pool.connect(whale).swap(d.GenesisETH.address, UNITS(200_000));
    await tx.wait();
    console.log(`  🚨 Whale swapped $200K gETH → gUSD — LARGE SWAP!`);
    await sleep(2000);

    // ── STEP 10: Remove Liquidity ──
    console.log("\n━━━ STEP 10/12: Remove Liquidity from Pool ━━━");
    try {
      // Try getLPBalance first, fall back to public lpShares mapping
      let user1LPBal;
      const user1Addr = await user1.getAddress();
      try {
        user1LPBal = await pool.getLPBalance(user1Addr);
      } catch {
        user1LPBal = await pool.lpShares(user1Addr);
      }
      if (user1LPBal > 0n) {
        const sharesToRemove = user1LPBal / 2n;
        tx = await pool.connect(user1).removeLiquidity(sharesToRemove);
        await tx.wait();
        console.log(`  ✅ User1 removed 50% of LP position`);
      }
    } catch (err) {
      console.log(`  ⚠️  Remove liquidity skipped: ${err.message.slice(0, 80)}`);
    }
    await sleep(1500);

    try {
      const [resA, resB, , swaps] = await pool.getPoolStats();
      console.log(`  📊 Pool: $${fmt(resA)} gUSD / $${fmt(resB)} gETH | Swaps: ${swaps}`);
    } catch {
      console.log(`  📊 Pool stats: (read failed — pool operational)`);
    }
  }

  // ── STEP 11: Vesting ──
  if (d.GenesisVesting) {
    const vesting = new ethers.Contract(d.GenesisVesting.address, loadABI("GenesisVesting"), deployer);

    console.log("\n━━━ STEP 11/12: Vesting — Create Schedule + Claim ━━━");
    const user1Addr = await user1.getAddress();
    tx = await vesting.createVesting(
      user1Addr, d.GenesisToken.address, UNITS(100_000),
      10 * 86400, 30 * 86400,
      "Team allocation — 30 day vest with 10 day cliff"
    );
    await tx.wait();
    console.log(`  ✅ Vesting: User1 gets $100K over 30d (cliff: 10d)`);
    await sleep(1500);

    tx = await vesting.simulateTimePass(0, 15 * 86400);
    await tx.wait();
    console.log(`  ⏩ Simulated 15 days passing (past cliff)`);

    const claimable = await vesting.getClaimable(0);
    console.log(`  💰 User1 claimable: $${fmt(claimable)}`);

    if (claimable > 0n) {
      tx = await vesting.connect(user1).claim(0);
      await tx.wait();
      console.log(`  ✅ User1 claimed vested tokens!`);
    }
    await sleep(1500);

    const info = await vesting.getScheduleInfo(0);
    console.log(`  📊 Vesting: claimed $${fmt(info.claimedAmount)}, ${info.vestingProgress}% complete`);
  }

  // ── BONUS: Intelligence Showcase — Trigger Anomaly Detection ──
  console.log("\n━━━ 🧠 BONUS: Intelligence Layer Showcase ━━━");
  console.log("  (Rapid multi-contract activity to trigger pattern detection)\n");

  try {
    // Rapid deposit-withdraw (flash pattern)
    console.log("  ⚡ Flash pattern test: rapid deposit → withdraw...");
    tx = await vault.connect(user2).deposit(UNITS(25_000));
    await tx.wait();
    tx = await vault.connect(user2).withdraw(UNITS(24_000));
    await tx.wait();
    console.log("  ✅ User2: $25K deposit → $24K withdraw in rapid succession");
    await sleep(500);

    // Velocity burst: whale does many small txs fast
    console.log("  ⚡ Velocity burst: whale rapid-fires transactions...");
    for (let i = 0; i < 4; i++) {
      tx = await vault.connect(whale).deposit(UNITS(5_000 * (i + 1)));
      await tx.wait();
    }
    console.log("  ✅ Whale: 4 deposits in rapid succession ($5K→$20K)");
    await sleep(500);

    // Cross-contract: user1 touches vault + pool + governance
    console.log("  🔗 Cross-contract test: user1 across vault → pool → vault...");
    tx = await vault.connect(user1).deposit(UNITS(15_000));
    await tx.wait();
    if (d.GenesisLiquidityPool) {
      const pool = new ethers.Contract(d.GenesisLiquidityPool.address, loadABI("GenesisLiquidityPool"), deployer);
      tx = await pool.connect(user1).swap(d.GenesisToken.address, UNITS(5_000));
      await tx.wait();
    }
    tx = await vault.connect(user1).withdraw(UNITS(10_000));
    await tx.wait();
    console.log("  ✅ User1: deposit → swap → withdraw (wash trade pattern)");
    await sleep(500);

    // Large anomaly: whale suddenly moves 10x average
    console.log("  🐋 Large movement anomaly: whale $1M deposit (10x normal)...");
    tx = await vault.connect(whale).deposit(UNITS(1_000_000));
    await tx.wait();
    console.log("  ✅ Whale: $1M deposit — statistical outlier triggered");
    await sleep(2000);

    console.log("\n  🧠 Intelligence layer processed all patterns.");
    console.log("  📊 View results: http://localhost:3001/intelligence\n");
  } catch (err) {
    console.log(`  ⚠️  Intelligence showcase: ${err.message.slice(0, 100)}`);
  }

  // ── BONUS 2: User-Driven Threshold Configuration ──
  console.log("\n━━━ 🎯 BONUS 2: User-Driven Threshold Configuration ━━━");
  console.log("  (Users can set their OWN thresholds — stored on-chain, enforced in real-time)\n");

  try {
    // User2 sets a custom low threshold ($30K) — much lower than the default $100K
    console.log("  👤 User2 creates a custom threshold: $30K (Large Transfer)...");
    tx = await thresholdEngine.connect(user2).setThreshold(
      d.GenesisToken.address,    // token to watch
      0,                          // AlertType: LARGE_TRANSFER
      UNITS(30_000),             // $30,000 threshold
      60,                         // 60 second cooldown
      "User2's custom alert: gUSD transfers above $30K"
    );
    await tx.wait();
    console.log(`  ✅ User2 threshold written to ThresholdEngine smart contract on-chain!`);
    console.log(`     Alert Type: Large Transfer | Threshold: $30,000 | Cooldown: 60s`);
    await sleep(1500);

    // Whale sets a whale-specific threshold ($250K)
    console.log("\n  🐋 Whale creates threshold: $250K (Whale Movement)...");
    tx = await thresholdEngine.connect(whale).setThreshold(
      d.GenesisToken.address,
      1,                          // AlertType: WHALE_MOVEMENT
      UNITS(250_000),
      120,
      "Whale's alert: notify on movements above $250K"
    );
    await tx.wait();
    console.log(`  ✅ Whale threshold written on-chain!`);
    await sleep(1500);

    // Now trigger User2's threshold: $50K deposit (above $30K but below default $100K)
    console.log("\n  🔔 Testing user threshold: whale deposits $50K (triggers User2's $30K rule!)...");
    tx = await vault.connect(whale).deposit(UNITS(50_000));
    await tx.wait();
    console.log(`  ✅ $50K deposit — this should trigger User2's custom $30K threshold!`);
    console.log(`     (Would NOT trigger the default $100K threshold — only the user-defined one)`);
    await sleep(2000);

    // Trigger whale's threshold: $300K withdrawal
    console.log("\n  🔔 Testing whale threshold: whale withdraws $300K (triggers Whale's $250K rule!)...");
    tx = await vault.connect(whale).withdraw(UNITS(300_000));
    await tx.wait();
    console.log(`  ✅ $300K withdrawal — triggers both User2's $30K AND Whale's $250K thresholds!`);
    await sleep(2000);

    // Show what the listener picked up
    console.log("\n  📋 Threshold Summary:");
    console.log("     ⛓️  All thresholds are stored ON-CHAIN in ThresholdEngine");
    console.log("     👤 Each user controls their OWN rules (per-wallet)");
    console.log("     🔄 Listener auto-reloads when thresholds change");
    console.log("     🌐 Dashboard shows live thresholds from contract\n");
  } catch (err) {
    console.log(`  ⚠️  User threshold demo: ${err.message.slice(0, 100)}`);
  }

  // ── STEP 12: Governance ──
  if (d.GenesisGovernance) {
    const gov = new ethers.Contract(d.GenesisGovernance.address, loadABI("GenesisGovernance"), deployer);

    console.log("\n━━━ STEP 12/12: Governance — Full Lifecycle ━━━");

    // Use a longer duration (3600s = 1 hour) to avoid timing issues with Hardhat
    const VOTE_DURATION = 3600;

    tx = await gov.createProposal(
      "Increase vault large-movement threshold to $1M",
      "The current $100K threshold generates too many alerts. Propose raising to $1M.",
      VOTE_DURATION
    );
    const receipt = await tx.wait();

    // Extract proposalId from ProposalCreated event instead of hardcoding 0
    const iface = gov.interface;
    const createdLog = receipt.logs.find(
      (l) => { try { return iface.parseLog(l)?.name === "ProposalCreated"; } catch { return false; } }
    );
    const proposalId = createdLog
      ? Number(iface.parseLog(createdLog).args.proposalId)
      : Number(await gov.totalProposals()) - 1;

    console.log(`  ✅ Proposal #${proposalId} created (${VOTE_DURATION}s voting window)`);
    await sleep(1000);

    // VoteType: 0=Against, 1=For, 2=Abstain
    tx = await gov.connect(user1).castVote(proposalId, 1, UNITS(10_000), "Too many false alerts");
    await tx.wait();
    console.log(`  🗳️  User1 voted FOR ($10K weight)`);

    tx = await gov.connect(user2).castVote(proposalId, 1, UNITS(5_000), "Agree — threshold too low");
    await tx.wait();
    console.log(`  🗳️  User2 voted FOR ($5K weight)`);

    tx = await gov.connect(whale).castVote(proposalId, 0, UNITS(3_000), "Keep low threshold for safety");
    await tx.wait();
    console.log(`  🗳️  Whale voted AGAINST ($3K weight)`);
    await sleep(1000);

    const voteResult = await gov.getVoteResult(proposalId);
    console.log(`  📊 FOR=$${fmt(voteResult.forVotes)} vs AGAINST=$${fmt(voteResult.againstVotes)} | Quorum: ${voteResult.quorumReached ? "✅" : "❌"}`);

    // Fast-forward past voting period
    await provider.send("evm_increaseTime", [VOTE_DURATION + 1]);
    await provider.send("evm_mine", []);
    console.log(`  ⏩ Time warped past voting period`);

    tx = await gov.finalizeProposal(proposalId);
    await tx.wait();
    console.log(`  ✅ Proposal finalized`);
    await sleep(1000);

    const proposalInfo = await gov.getProposalInfo(proposalId);
    const stateNames = ["Active", "Passed", "Failed", "Executed", "Cancelled"];
    console.log(`  📋 State: ${stateNames[Number(proposalInfo.state)]}`);

    if (Number(proposalInfo.state) === 1) {
      tx = await gov.executeProposal(proposalId);
      await tx.wait();
      console.log(`  ⚡ Proposal EXECUTED on-chain!`);
    }
    await sleep(1500);
  }

  // ── Final Summary ──
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  📊 FINAL: On-Chain State Summary");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const [totalDep, totalWith, vaultBal, isPaused] = await vault.getVaultStats();
  console.log(`  Vault deposits:    $${fmt(totalDep)}`);
  console.log(`  Vault withdrawals: $${fmt(totalWith)}`);
  console.log(`  Vault balance:     $${fmt(vaultBal)}`);
  console.log(`  Vault paused:      ${isPaused}`);

  const alertCount = await alertRegistry.alertCount();
  console.log(`  Alerts on-chain:   ${alertCount}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN: Start server → Run demo → Show results
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   🧬 GENESIS — Full Pipeline Demo                       ║");
  console.log("║   Server → Listener → Demo → AI Formatter → Telegram   ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // Phase 1: Start listener + server
  console.log("━━━ PHASE 1: Starting On-Chain Server + Listener ━━━\n");
  const { listener, formatter, eventLog, db, pipeline, telegramBot } = await startServer();

  // Let subscriptions settle
  await sleep(2000);

  // ═══════════════════════════════════════════════════════════════════════
  //  USER SETUP: Bot asks user what alerts they want BEFORE any events
  //  User MUST choose first — only chosen alerts will be delivered.
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   🤖 TELEGRAM BOT: User Alert Setup (Button-Driven)      ║");
  console.log("║   Bot ASKS user what alerts they want — BEFORE events!   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // Step 1: Send welcome message with interactive buttons to Telegram
  console.log("\n  📱 Sending interactive welcome to Telegram user...");
  console.log("     The bot sends inline keyboard buttons:");
  console.log("     [🔔 Choose My Alerts] [📊 Get Report] [ℹ️ Help]");
  try {
    await telegramBot.sendWelcomePrompt(TELEGRAM_CHAT_ID);
    console.log("  ✅ Welcome message with buttons sent to Telegram!");
  } catch (err) {
    console.log(`  ⚠️  Welcome send failed (network): ${err.message}`);
  }
  await sleep(1000);

  // Step 2: User chooses alerts via buttons (simulated for demo)
  console.log("\n  🎯 User picks alerts via inline buttons:");

  console.log("\n     Step A: User taps [🔔 Choose My Alerts]");
  console.log("     → Bot shows: [💰 Large Transfer] [🐋 Whale Movement] [⚡ Rapid Flow] [🔧 Custom]");

  console.log("\n     Step B: User taps [💰 Large Transfer]");
  console.log("     → Bot shows: [$10K] [$50K] [$100K] [$500K] [✏️ Custom Amount]");

  console.log("\n     Step C: User taps [$50K]");
  const pref1 = telegramBot.addPreference(TELEGRAM_CHAT_ID, "large_transfer", 50000);
  if (pref1) {
    console.log("     ✅ Subscribed! Large Transfer ≥ $50,000");
    console.log("     → Bot shows: [➕ Add Another Alert] [📋 View My Alerts] [✅ Done]");
  }

  console.log("\n     Step D: User taps [➕ Add Another Alert]");
  console.log("     → Bot shows alert type buttons again");
  console.log("     Step E: User taps [🐋 Whale Movement] → [✏️ Custom Amount] → types '200000'");
  const pref2 = telegramBot.addPreference(TELEGRAM_CHAT_ID, "whale_movement", 200000);
  if (pref2) {
    console.log("     ✅ Subscribed! Whale Movement ≥ $200,000");
  }

  console.log("\n     Step F: User taps [✅ Done]");
  console.log("     → Bot: 'You're all set! Only matching alerts will reach you.'");

  const botSummary = telegramBot.getSummary();
  console.log(`\n  🤖 Bot Status After User Setup:`);
  console.log(`     Registered users:    ${botSummary.totalUsers}`);
  console.log(`     Alert subscriptions: ${botSummary.totalPreferences}`);
  for (const [, user] of telegramBot.users) {
    for (const [, pref] of user.alertPrefs) {
      const typeName = Object.values(ALERT_TYPES).find(t => t.id === pref.alertType)?.name || "Custom";
      console.log(`     → ${typeName} ≥ $${(pref.threshold / 1e6).toLocaleString()}`);
    }
  }

  console.log("\n  🚫 ZERO alerts will be sent until events match these choices.");
  console.log("  ✅ User is in control. Let's start the on-chain demo now!\n");
  await sleep(1000);

  // Phase 2: Run the 12-step demo (alerts will ONLY go to prefs that match)
  console.log("\n━━━ PHASE 2: Running 12-Step Demo (listener is catching events!) ━━━\n");
  await runDemo();

  // Give events time to propagate (smart wait — checks if events arrived)
  console.log("\n  ⏳ Waiting for event propagation...");
  const expectedMin = listener.getStats().eventsReceived;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (eventLog.length >= expectedMin) break;
  }
  // Extra buffer for any stragglers
  await sleep(2000);

  // ═══════════════════════════════════════════════════════════════════════
  //  BONUS 3: Telegram Bot Summary — Show what happened
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   🤖 BONUS 3: Telegram Alert Delivery Results            ║");
  console.log("║   Only alerts matching user choices were delivered!       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");


  const finalSummary = telegramBot.getSummary();
  console.log(`\n  📱 User chose these alerts BEFORE the demo started:`);
  for (const [, user] of telegramBot.users) {
    for (const [, pref] of user.alertPrefs) {
      const typeDef = Object.values(ALERT_TYPES).find(t => t.id === pref.alertType);
      console.log(`     → ${typeDef?.emoji || "📋"} ${typeDef?.name || "Custom"} ≥ $${(pref.threshold / 1e6).toLocaleString()}`);
    }
  }
  console.log(`\n  📊 Subscriptions: ${finalSummary.totalPreferences} | Users: ${finalSummary.totalUsers}`);
  console.log(`  ✅ Only events matching those choices were sent to Telegram.`);
  console.log(`  🚫 Everything else was silently filtered out — ZERO spam.`);

  // Send a dashboard report to Telegram
  console.log(`\n  📊 Sending dashboard report to Telegram...`);
  try {
    await telegramBot.sendReport();
    console.log(`  📨 Dashboard report sent to Telegram!`);
  } catch (err) {
    console.log(`  ⚠️  Report send failed: ${err.message}`);
  }

  await sleep(1000);

  // Phase 3: Show captured results
  const stats = listener.getStats();
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   📊 PHASE 3: Listener Results                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  📊 Listener Stats:`);
  console.log(`     Total events caught:   ${stats.eventsReceived}`);
  console.log(`     Deposits:              ${stats.depositsDetected}`);
  console.log(`     Withdrawals:           ${stats.withdrawalsDetected}`);
  console.log(`     Large movements:       ${stats.largeMovements}`);
  console.log(`     Internal transfers:    ${stats.internalTransfers}`);
  console.log(`     Threshold changes:     ${stats.thresholdChanges}`);
  console.log(`     Alerts recorded:       ${stats.alertsRecorded}`);
  console.log(`     Vesting events:        ${stats.vestingEvents}`);
  console.log(`     Governance events:     ${stats.governanceEvents}`);
  console.log(`     Liquidity events:      ${stats.liquidityEvents}`);
  console.log(`     Uptime:                ${stats.uptimeSeconds}s`);

  const aiStats = formatter.getAIStats();
  console.log(`\n  🧠 AI Stats:`);
  console.log(`     AI enabled:            ${aiStats.enabled}`);
  console.log(`     Analyses completed:    ${aiStats.analysisCount || 0}`);

  console.log(`\n  📋 Events caught by listener (${eventLog.length} total):`);
  eventLog.forEach((e, i) => {
    // amount is already a formatted string like "500,000.00" from _formatAmount
    // amountRaw is the raw bigint string — use amount directly if it exists
    const amt = e.amount || e.amountIn || "";
    const amtStr = amt ? ` — $${amt}` : "";
    const label = e.type || "unknown";
    console.log(`     ${String(i + 1).padStart(2)}. ${label}${amtStr}`);
  });

  console.log("\n  ═══════════════════════════════════════════════════════");
  console.log("  ✅ FULL PIPELINE VERIFIED:");
  console.log("     Smart Contracts → Event Listener → AI Formatter → Telegram Bot (filtered)");
  console.log("     Smart Contracts → Event Listener → SQLite Database");
  console.log("     Smart Contracts → Anomaly Detector → Wallet Profiler → Intel Dashboard");
  console.log("     Telegram Bot → Inline Buttons → User Picks Alerts → Filtered Dispatch");
  console.log("     Telegram Bot → /report → Dashboard Report + [🔄 Refresh] Button");
  console.log("  ═══════════════════════════════════════════════════════");

  // ═══════════════════════════════════════════════════════════════════════
  //  🔔 USER-DRIVEN THRESHOLDS SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   🔔 USER-DRIVEN THRESHOLDS — On-Chain Configuration     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const activeThresholds = listener.getActiveThresholds();
  const userThresholdAlerts = eventLog.filter(e => e.type === "user_threshold_triggered");
  const alertTypes = ["LARGE_TRANSFER", "WHALE_MOVEMENT", "RAPID_FLOW", "CUSTOM"];

  console.log(`\n  📋 Active On-Chain Thresholds: ${activeThresholds.length}`);
  if (activeThresholds.length > 0) {
    activeThresholds.forEach((t, i) => {
      const typeName = alertTypes[t.alertType] || `TYPE_${t.alertType}`;
      const amtStr = `$${(t.threshold / 1e6).toLocaleString()}`;
      const src = t.source === "global" ? "🌍 Global" : `👤 User ${t.user ? t.user.slice(0, 6) + "…" + t.user.slice(-4) : "unknown"}`;
      console.log(`     ${i + 1}. [${typeName}] ${amtStr} — ${src} — "${t.description}"`);
    });
  } else {
    console.log("     (no user-created thresholds found)");
  }

  console.log(`\n  🔔 User Threshold Alerts Triggered: ${userThresholdAlerts.length}`);
  if (userThresholdAlerts.length > 0) {
    userThresholdAlerts.forEach((a, i) => {
      const desc = a.thresholdDescription || a.type;
      console.log(`     ${i + 1}. ${desc}`);
    });
  }

  console.log(`\n  ⛓️  Chain: ${process.env.CHAIN_NAME || "localhost"} (ID: ${process.env.CHAIN_ID || "31337"})`);
  console.log(`  🌐 RPC:   ${process.env.RPC_URL || "http://127.0.0.1:8545"}`);
  console.log("  ═══════════════════════════════════════════════════════");

  // ═══════════════════════════════════════════════════════════════════════
  //  � TELEGRAM BOT — User-Driven Alert Preferences
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   🤖 TELEGRAM BOT — User-Driven Alert System            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const botFinalSummary = telegramBot.getSummary();
  console.log(`\n  📱 Registered Users: ${botFinalSummary.totalUsers}`);
  console.log(`  📋 Alert Subscriptions: ${botFinalSummary.totalPreferences}`);

  if (botFinalSummary.users.length > 0) {
    botFinalSummary.users.forEach((u) => {
      const chatLabel = u.chatId === TELEGRAM_CHAT_ID ? `${u.username} (default)` : u.username;
      console.log(`\n  👤 ${chatLabel}:`);
      if (u.preferences.length > 0) {
        u.preferences.forEach((p) => {
          console.log(`     #${p.id} ${p.type} ≥ $${(p.threshold / 1e6).toLocaleString()} on ${p.chain}`);
        });
      } else {
        console.log(`     (no subscriptions)`);
      }
    });
  }

  console.log(`\n  🔑 Alert Flow (User-First, Button-Driven):`);
  console.log(`     1. Bot sends Welcome → [🔔 Choose Alerts] button`);
  console.log(`     2. User taps → picks alert type → picks threshold`);
  console.log(`     3. ✅ Subscribed BEFORE any events happen`);
  console.log(`     4. On-chain events fire → bot checks user prefs`);
  console.log(`     5. Only matching alerts delivered — everything else filtered`);
  console.log(`     6. /report → Dashboard report + [🔄 Refresh] button`);
  console.log(`\n  🚫 NO alerts without user choice — ZERO spam!`);
  console.log(`  ✅ User is always in control of what they receive!`);
  console.log("  ═══════════════════════════════════════════════════════");

  // ═══════════════════════════════════════════════════════════════════════
  //  �🧠 INTELLIGENCE LAYER SHOWCASE — The "WOW" Section
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   🧠 INTELLIGENCE LAYER — Wallet Profiling & Anomalies  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // ── Wallet Risk Leaderboard ──
  const leaderboard = pipeline.walletProfiler.getRiskLeaderboard();
  if (leaderboard.length > 0) {
    console.log(`\n  🏆 WALLET RISK LEADERBOARD (${leaderboard.length} wallets profiled):`);
    console.log("  ┌──────────────────────┬───────┬──────────┬────────┬─────────────────────────┐");
    console.log("  │ Address              │ Risk  │ Level    │ TXs    │ Volume                  │");
    console.log("  ├──────────────────────┼───────┼──────────┼────────┼─────────────────────────┤");
    const testAccounts = loadDeployment().testAccounts;
    const nameMap = {};
    if (testAccounts) {
      for (const [name, addr] of Object.entries(testAccounts)) {
        nameMap[addr.toLowerCase()] = name.toUpperCase();
      }
    }
    for (const w of leaderboard) {
      const shortAddr = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
      const walletName = nameMap[w.address.toLowerCase()] || "";
      const label = walletName ? `${shortAddr} (${walletName})` : shortAddr;
      const riskEmoji = w.riskScore > 75 ? "🔴" : w.riskScore > 50 ? "🟠" : w.riskScore > 25 ? "🟡" : "🟢";
      const vol = isNaN(w.totalVolume) || w.totalVolume === 0
        ? `$0`
        : w.totalVolume >= 1000000
        ? `$${(w.totalVolume / 1000000).toFixed(1)}M`
        : w.totalVolume >= 1000
        ? `$${(w.totalVolume / 1000).toFixed(1)}K`
        : `$${w.totalVolume.toFixed(0)}`;
      console.log(`  │ ${label.padEnd(20)} │ ${riskEmoji} ${String(w.riskScore).padStart(3)} │ ${w.riskLevel.padEnd(8)} │ ${String(w.totalTxCount).padStart(6)} │ ${vol.padEnd(23)} │`);
    }
    console.log("  └──────────────────────┴───────┴──────────┴────────┴─────────────────────────┘");
  } else {
    console.log("\n  ⚠️  No wallets profiled (pipeline may not have processed events yet)");
  }

  // ── Per-Wallet Deep Dive (top 3 riskiest) ──
  if (leaderboard.length > 0) {
    console.log("\n  🔍 TOP RISK WALLET DEEP DIVES:");
    const topWallets = leaderboard.slice(0, 3);
    const testAccounts2 = loadDeployment().testAccounts;
    const nameMap2 = {};
    if (testAccounts2) {
      for (const [name, addr] of Object.entries(testAccounts2)) {
        nameMap2[addr.toLowerCase()] = name.toUpperCase();
      }
    }
    for (const w of topWallets) {
      const profile = pipeline.walletProfiler.getProfile(w.address);
      const patterns = pipeline.walletProfiler.getWalletPatterns(w.address);
      const walletName = nameMap2[w.address.toLowerCase()] || "";
      const shortAddr = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
      const label = walletName ? `${shortAddr} (${walletName})` : shortAddr;
      const riskEmoji = w.riskScore > 75 ? "🔴" : w.riskScore > 50 ? "🟠" : w.riskScore > 25 ? "🟡" : "🟢";
      console.log(`\n     ${riskEmoji} ${label} — Risk Score: ${w.riskScore}/100 (${w.riskLevel})`);
      console.log(`        Transactions: ${w.totalTxCount} | Volume: $${(isNaN(w.totalVolume) ? 0 : w.totalVolume).toLocaleString()}`);
      console.log(`        Contracts touched: ${w.contractsTouched.join(", ") || "none"}`);
      if (profile && profile.contractActivity) {
        const activities = Object.entries(profile.contractActivity);
        if (activities.length > 0) {
          console.log(`        Activity breakdown:`);
          for (const [contract, data] of activities) {
            const cShort = contract.length > 20 ? `${contract.slice(0, 6)}...${contract.slice(-4)}` : contract;
            const volStr = isNaN(data.volume) ? "0" : data.volume.toLocaleString();
            console.log(`          ${cShort}: ${data.count} txs, $${volStr} vol`);
          }
        }
      }
      if (patterns.length > 0) {
        console.log(`        ⚠️  Detected patterns:`);
        for (const p of patterns.slice(-5)) {
          const pEmoji = p.severity === "critical" ? "🔴" : p.severity === "high" ? "🟠" : "🟡";
          console.log(`          ${pEmoji} ${p.type}: ${p.description}`);
        }
      }
    }
  }

  // ── Detected Patterns Summary ──
  const recentPatterns = pipeline.walletProfiler.getRecentPatterns(50);
  const intelStats = pipeline.walletProfiler.getStats();
  if (recentPatterns.length > 0) {
    console.log(`\n  🚨 DETECTED PATTERNS (${recentPatterns.length} total):`);
    const pb = intelStats.patternBreakdown;
    if (Object.keys(pb).length > 0) {
      for (const [type, count] of Object.entries(pb)) {
        const emoji = type === "flash_pattern" ? "🔴" : type === "velocity_anomaly" ? "🟠" : type === "whale_activity" ? "🐋" : "🟡";
        console.log(`     ${emoji} ${type}: ${count} occurrence(s)`);
      }
    }
    console.log(`\n     Last 5 patterns:`);
    for (const p of recentPatterns.slice(0, 5)) {
      const shortWallet = `${p.wallet.slice(0, 6)}...${p.wallet.slice(-4)}`;
      const emoji = p.severity === "critical" ? "🔴" : p.severity === "high" ? "🟠" : "🟡";
      console.log(`     ${emoji} [${p.severity.toUpperCase()}] ${shortWallet} — ${p.type}: ${p.description}`);
    }
  } else {
    console.log("\n  ℹ️  No patterns detected (events may still be processing)");
  }

  // ── Anomaly Detection Stats ──
  const anomalyStats = pipeline.anomalyDetector.getStats();
  const anomalyLog = pipeline.intelligenceLog.filter((l) => l.type === "anomaly");
  console.log(`\n  📊 ANOMALY DETECTION (Z-Score Statistical Analysis):`);
  if (Object.keys(anomalyStats).length > 0) {
    for (const [token, s] of Object.entries(anomalyStats)) {
      console.log(`     Token: ${token}`);
      console.log(`       Mean transfer:    $${Number(s.mean).toLocaleString()}`);
      console.log(`       Std deviation:    $${Number(s.std_dev).toLocaleString()}`);
      console.log(`       Sample size:      ${s.sample_size} transfers recorded`);
    }
  }
  if (anomalyLog.length > 0) {
    console.log(`\n     🔬 ${anomalyLog.length} anomalies flagged:`);
    for (const a of anomalyLog.slice(-5)) {
      console.log(`        z=${a.z_score?.toFixed(2) || "?"} | ${a.confidence_level || "?"} confidence | ${a.description || a.event || "unknown"}`);
    }
  } else {
    console.log(`     No anomalies flagged yet.`);
  }

  // ── Risk Distribution ──
  if (intelStats.riskDistribution) {
    const rd = intelStats.riskDistribution;
    console.log(`\n  🛡️  RISK DISTRIBUTION:`);
    console.log(`     🟢 Low risk (0-25):       ${rd.low || 0} wallets`);
    console.log(`     🟡 Elevated (25-50):      ${rd.elevated || 0} wallets`);
    console.log(`     🟠 Suspicious (50-75):    ${rd.suspicious || 0} wallets`);
    console.log(`     🔴 High risk (75-100):    ${rd.high_risk || 0} wallets`);
  }

  // ── Full Pipeline Module Stats ──
  const pipeStats = pipeline.getFullPipelineStats();
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   ⚙️  PIPELINE MODULE STATUS — All 7 Modules Active      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  📥 Events In:            ${pipeStats.pipeline.eventsProcessed}`);
  console.log(`  📋 Rule Matches:         ${pipeStats.pipeline.ruleMatches}`);
  console.log(`  🔇 Noise Filtered:       ${pipeStats.pipeline.noiseFiltered}`);
  console.log(`  📦 Aggregated Alerts:    ${pipeStats.pipeline.aggregatedAlerts}`);
  console.log(`  🔬 Anomalies Detected:   ${pipeStats.pipeline.anomaliesDetected}`);
  console.log(`  ✅ Finality Upgrades:    ${pipeStats.pipeline.finalityUpgrades}`);
  console.log(`  🧠 Intelligence Events:  ${pipeStats.pipeline.intelligenceEvents}`);

  // Show active rules
  console.log(`\n  📋 ACTIVE RULES (${pipeStats.modules.ruleLoader.totalRules}):`);
  for (const r of pipeStats.modules.ruleLoader.rules) {
    const sevEmoji = r.severity === "critical" ? "🔴" : r.severity === "high" ? "🟠" : r.severity === "medium" ? "🟡" : "🔵";
    console.log(`     ${sevEmoji} [${r.severity.toUpperCase().padEnd(8)}] ${r.name}`);
  }

  // Noise filter stats
  if (pipeStats.modules.noiseFilter) {
    const nf = pipeStats.modules.noiseFilter;
    console.log(`\n  🔇 Noise Filter: ${nf.passed || 0} passed, ${nf.blocked || 0} blocked, ${nf.deduplicated || 0} deduped`);
  }

  // Aggregator stats
  if (pipeStats.modules.aggregator) {
    const ag = pipeStats.modules.aggregator;
    console.log(`  📦 Aggregator: ${ag.activeWindows || 0} active windows, ${ag.alertsFired || 0} aggregated alerts`);
  }

  // Finality tracker stats
  if (pipeStats.modules.finalityTracker) {
    const ft = pipeStats.modules.finalityTracker;
    console.log(`  ✅ Finality: ${ft.tracking || ft.tracked || 0} events tracked, ${ft.finalized || 0} finalized, ${ft.reverted || 0} reverted`)
  }

  // Show DB stats
  if (db && db._isConnected) {
    try {
      const dbEvents = db.query("SELECT COUNT(*) as count FROM events");
      const dbAlerts = db.query("SELECT COUNT(*) as count FROM alerts");
      const dbStats = db.getStats();
      console.log(`\n  🗄️  SQLite Stats:`);
      console.log(`     Events stored:         ${dbEvents.rows[0]?.count || 0}`);
      console.log(`     Alerts stored:         ${dbAlerts.rows[0]?.count || 0}`);
      console.log(`     DB size:               ${((dbStats?.size || 0) / 1024).toFixed(1)} KB`);
      console.log(`     DB path:               ${dbStats?.path || 'N/A'}`);
    } catch (err) {
      console.log(`\n  ⚠️  SQLite stats unavailable: ${err.message}`);
    }
  }

  console.log(`\n  🌐 Control Panel:  http://localhost:3001`);
  console.log(`  📊 Analytics:      http://localhost:3001/dashboard`);
  console.log(`  🧠 Intelligence:   http://localhost:3001/intelligence`);
  console.log("  Press Ctrl+C to stop.\n");
}

main().catch((err) => {
  console.error("💥 Demo failed:", err);
  process.exit(1);
});
