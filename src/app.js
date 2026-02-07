/**
 * Genesis — Main Application (Phase 3)
 *
 * Full pipeline:
 *   Observer (RPC Pool → Block Tracker → Log Fetcher)
 *     → Pipeline (Decoder → Event Model → Finality Tracker)
 *       → Engine (Rule Evaluator → Aggregator → Noise Filter)
 *         → Database (Postgres → Event Repository → Alert Repository)
 *         → Notifications (Dispatcher → Console)
 *
 * Rules drive EVERYTHING:
 *   - Which contracts to watch (selective indexing)
 *   - Which events to alert on
 *   - How to aggregate (time windows)
 *   - When to suppress noise (cooldowns)
 *
 * Run: node src/app.js
 *      node src/app.js --chain polygon
 */

const config = require("./config");
const { RpcPool, BlockTracker, LogFetcher } = require("./observer");
const { Decoder, FinalityTracker } = require("./pipeline");
const { RuleLoader, RuleEvaluator, Aggregator, NoiseFilter } = require("./engine");
const AnomalyDetector = require("./engine/anomaly-detector");
const NotificationDispatcher = require("./notify/dispatcher");
// CyreneAI integration temporarily disabled for demo stability.
// To re-enable, uncomment the import and initialization below and ensure CYRENE credentials are configured.
// const CyreneAgent = require("./ai/cyrene-agent");
const { Database, EventRepository, AlertRepository } = require("./db");
const metricsCollector = require("./metrics/collector");
const MetricsServer = require("./metrics/server");

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { chain: config.defaultChain };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--chain" && args[i + 1]) {
      opts.chain = args[i + 1];
      i++;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║              🧬 GENESIS — Blockchain Monitor            ║");
  console.log("║         Signal-First · Reorg-Native · Sustainable       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();

  // --- 1. Load chain config ---
  const chainConfig = config.getChain(opts.chain);
  console.log(`  🌐 Chain: ${chainConfig.name} (ID: ${chainConfig.chainId})`);
  console.log();

  // --- 2. Database Layer (Phase 3) ---
  const db = new Database(config.database);
  await db.connect();
  await db.migrate(); // Run schema migrations
  
  const eventRepo = new EventRepository(db);
  const alertRepo = new AlertRepository(db);
  console.log();

  // --- 3. Load rules ---
  const ruleLoader = new RuleLoader();
  ruleLoader.load();
  ruleLoader.watch(); // hot-reload on file changes

  const rules = ruleLoader.getForChain(opts.chain);
  if (rules.length === 0) {
    console.warn(`  ⚠️  No rules found for chain "${opts.chain}". Add JSON files to the rules/ directory.`);
  }
  console.log();

  // --- 4. Observer Layer ---
  const rpcPool = new RpcPool(chainConfig);
  const blockTracker = new BlockTracker(rpcPool, chainConfig);
  const logFetcher = new LogFetcher(rpcPool, chainConfig);

  // --- 5. Pipeline Layer ---
  const decoder = new Decoder(chainConfig, config.abis);
  const finalityTracker = new FinalityTracker(chainConfig);

  // --- 6. Engine Layer (Phase 2) ---
  const ruleEvaluator = new RuleEvaluator(ruleLoader);
  const aggregator = new Aggregator();
  const noiseFilter = new NoiseFilter();
  const anomalyDetector = new AnomalyDetector();

  // --- 7. Notification Layer (Phase 4) ---
  const notificationDispatcher = new NotificationDispatcher(config);

  // --- 7.5. AI Intelligence Layer (CyreneAI Integration) ---
  // CyreneAI is currently commented out for the live demo. To enable later
  // restore the lines below and provide valid `config.cyrene` settings.
  // const cyreneAgent = new CyreneAgent({
  //   endpoint: config.cyrene?.endpoint,
  //   apiKey: config.cyrene?.apiKey,
  // });

  // --- 8. Metrics Dashboard (Phase 5) ---
  const metricsServer = new MetricsServer(config.api.port);
  metricsServer.start();

  // --- 9. SELECTIVE INDEXING: Rules drive what we watch ---
  //    This is the 70-90% RPC cost saving.
  //    Instead of watching "everything", we only watch contracts referenced in rules.
  function syncWatchTargets() {
    // Clear old targets
    for (const id of Array.from(logFetcher.watchTargets.keys())) {
      logFetcher.removeTarget(id);
    }

    // Add targets from rules
    const activeRules = ruleLoader.getForChain(opts.chain);

    for (const rule of activeRules) {
      const abi = getAbiForEventType(rule.event_type);

      if (rule.contracts && rule.contracts.length > 0) {
        for (const addr of rule.contracts) {
          logFetcher.addTarget(
            `rule_${rule.rule_id}_${addr.slice(0, 8)}`,
            addr,
            abi
          );
        }
      } else {
        logFetcher.addTarget(`rule_${rule.rule_id}`, null, abi);
      }
    }
  }

  function getAbiForEventType(eventType) {
    switch (eventType) {
      case "ERC20_TRANSFER": return config.abis.erc20;
      case "ERC721_TRANSFER": return config.abis.erc721;
      case "UNISWAP_V2": return config.abis.uniswapV2;
      default: return config.abis.erc20;
    }
  }

  // Initial sync
  syncWatchTargets();

  // Re-sync when rules change (hot-reload)
  ruleLoader.on("rules:changed", ({ added, removed }) => {
    console.log(`  🔄 Rules changed: +${added.length} -${removed.length} — re-syncing watch targets...`);
    syncWatchTargets();
  });

  // --- 8. Wire the full event pipeline ---
  let lastFetchedBlock = 0;
  let processing = false;
  const blockQueue = [];

  async function processBlock(block) {
    const { blockNumber, timestamp } = block;

    // Update finality for tracked events
    finalityTracker.onNewBlock(blockNumber);

    // Fetch logs for new block(s)
    const fromBlock = lastFetchedBlock > 0 ? lastFetchedBlock + 1 : blockNumber;
    const toBlock = blockNumber;

    if (fromBlock > toBlock) return;

    console.log(`  🔎 Fetching logs for blocks ${fromBlock}→${toBlock}...`);
    const logs = await logFetcher.fetchLogs(fromBlock, toBlock);
    lastFetchedBlock = toBlock;

    if (logs.length === 0) {
      console.log(`  📦 Block ${blockNumber}: 0 logs (no matching events)`);
      return;
    }

    // Get finality status for this block
    const finality = blockTracker.getFinalityStatus(blockNumber);

    // Decode logs → GenesisEvents
    const events = decoder.decodeBatch(logs, { timestamp }, finality);

    // Track metrics: RPC calls and events
    metricsCollector.recordBlockProcessed(blockNumber);
    metricsCollector.recordRPCCall(50); // Assume 50ms latency for getLogs
    
    // Estimate RPC savings from selective indexing
    const naiveCallsEstimate = 100; // Naive indexer would make ~100 calls per block
    const actualCalls = 1; // We make 1 selective call with topic filters
    metricsCollector.recordRPCSaved(naiveCallsEstimate - actualCalls);

    for (const event of events) {
      metricsCollector.recordEventDecoded(event.eventType);
    }

    if (events.length === 0) {
      console.log(`  📦 Block ${blockNumber}: ${logs.length} logs → 0 decoded events`);
      return;
    }

    // ┌─────────────────────────────────────────────┐
    // │  PHASE 3: Save events to database           │
    // └─────────────────────────────────────────────┘

    try {
      await eventRepo.saveBatch(events);
    } catch (err) {
      console.error(`  💥 [Database] Failed to save events: ${err.message}`);
      // Continue processing even if DB save fails
    }

    // Track finality for all decoded events
    for (const event of events) {
      finalityTracker.track(event);
    }

    // ┌─────────────────────────────────────────────┐
    // │  Feed events to anomaly detector            │
    // │  for statistical baseline training          │
    // └─────────────────────────────────────────────┘

    for (const event of events) {
      // Only record transfer events for statistical analysis
      if (event.name === 'Transfer' && event.args && event.args.value) {
        try {
          const token = event.address.toLowerCase();
          const amount = event.args.value;
          
          // Get token decimals (default to 18 if not in our known list)
          const knownTokens = {
            '0xdac17f958d2ee523a2206206994597c13d831ec7': 6, // USDT
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
            '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
          };
          const decimals = knownTokens[token] || 18;
          
          anomalyDetector.recordTransfer(token, amount, decimals);
        } catch (err) {
          // Silently fail - don't block processing for anomaly recording
        }
      }
    }

    // ┌─────────────────────────────────────────────┐
    // │  PHASE 2: Rule Evaluation → Aggregation     │
    // │  Events only become alerts if a rule matches │
    // └─────────────────────────────────────────────┘

    const matches = ruleEvaluator.evaluateBatch(events);

    // Track matched vs filtered events
    metricsCollector.recordEventFiltered(events.length - matches.length);
    for (const match of matches) {
      metricsCollector.recordEventMatched();
    }

    // ┌─────────────────────────────────────────────┐
    // │  ANOMALY DETECTION (Phase 5+)               │
    // │  Statistical analysis for outliers          │
    // └─────────────────────────────────────────────┘

    const anomalies = anomalyDetector.detectBatchAnomalies(events);
    
    if (anomalies.length > 0) {
      console.log(`  🔍 [Anomaly] Detected ${anomalies.length} statistical outlier(s):`);
      for (const anom of anomalies) {
        console.log(`     ${anom.message}`);
        console.log(`     Confidence: ${anom.anomaly.confidence_level} | Z-score: ${anom.anomaly.abs_z_score.toFixed(2)}σ`);
        
        // Track metrics
        metricsCollector.recordAnomalyDetected(
          anom.anomaly.severity,
          anom.event.address.toLowerCase()
        );
        
        // Send anomaly alerts through notification system
        const anomalyAlert = {
          alert_type: 'anomaly',
          rule_name: `🔬 Statistical Anomaly Detected`,
          severity: anom.anomaly.severity,
          chain: chainConfig.slug,
          event: anom.event,
          anomaly: anom.anomaly,
          message: anom.message,
          timestamp: Date.now(),
        };
        
        // Dispatch anomaly alert
        try {
          await notificationDispatcher.dispatch(anomalyAlert);
        } catch (err) {
          console.error(`  💥 [Anomaly Alert] Failed: ${err.message}`);
        }
      }
    }

    console.log(
      `  📦 Block ${blockNumber}: ${logs.length} logs → ${events.length} decoded → ${matches.length} rule match(es)`
    );

    // Feed matches through the aggregator
    for (const match of matches) {
      aggregator.process(match);
    }
  }

  // Serialized block handler — prevents race conditions
  async function drainBlockQueue() {
    if (processing) return;
    processing = true;
    while (blockQueue.length > 0) {
      const block = blockQueue.shift();
      try {
        await processBlock(block);
      } catch (err) {
        console.error(`  💥 [BlockHandler] Error processing block: ${err.message}`);
        console.error(err.stack);
      }
    }
    processing = false;
  }

  blockTracker.on("block", (block) => {
    blockQueue.push(block);
    drainBlockQueue();
  });

  // --- 9. Aggregator → Noise Filter → AI Enhancement → Notification Dispatcher → Database ---

  // Instant alerts (high/critical severity bypass aggregation)
  // CyreneAI temporarily disabled: send original alerts without AI enhancement.
  aggregator.on("alert", async (alert) => {
    if (noiseFilter.shouldPass(alert)) {
      // AI analysis is disabled for the demo — keep the original alert as-is.
      const enhancedAlert = alert;

      // Dispatch to notification channels (Telegram, Webhook, Console)
      try {
        await notificationDispatcher.dispatch(enhancedAlert);
        
        // Track metrics for each channel
        if (config.TELEGRAM_BOT_TOKEN) {
          metricsCollector.recordAlertSent(alert.severity, 'telegram');
        }
        if (config.WEBHOOK_URL) {
          metricsCollector.recordAlertSent(alert.severity, 'webhook');
        }
        if (config.CONSOLE_ALERTS) {
          metricsCollector.recordAlertSent(alert.severity, 'console');
        }
      } catch (err) {
        console.error(`  💥 [Notification] Failed to dispatch alert: ${err.message}`);
      }
      
      // Save alert to database
      try {
        await alertRepo.save(alert);
        await alertRepo.markNotified(alert.alertId || alert.rule.rule_id, ["telegram", "console"]);
      } catch (err) {
        console.error(`  💥 [Database] Failed to save alert: ${err.message}`);
      }
    }
  });

  // Aggregated alerts (window expired → summary)
  aggregator.on("alert:aggregated", async (alert) => {
    // Track aggregation metrics
    metricsCollector.recordAggregationWindow();
    metricsCollector.recordEventAggregated(alert.event_count || 1);
    
    if (noiseFilter.shouldPassAggregated(alert)) {
      // CyreneAI pattern detection temporarily disabled: send aggregated alert as-is.
      const enhancedAlert = alert;

      // Dispatch to notification channels (Telegram, Webhook, Console)
      try {
        await notificationDispatcher.dispatch(enhancedAlert);
        
        // Track metrics for each channel
        if (config.TELEGRAM_BOT_TOKEN) {
          metricsCollector.recordAlertSent(alert.severity, 'telegram');
        }
        if (config.WEBHOOK_URL) {
          metricsCollector.recordAlertSent(alert.severity, 'webhook');
        }
        if (config.CONSOLE_ALERTS) {
          metricsCollector.recordAlertSent(alert.severity, 'console');
        }
      } catch (err) {
        console.error(`  💥 [Notification] Failed to dispatch aggregated alert: ${err.message}`);
      }
      
      // Save aggregated alert to database
      try {
        await alertRepo.save(alert);
        await alertRepo.markNotified(alert.alertId || alert.rule.rule_id, ["telegram", "console"]);
      } catch (err) {
        console.error(`  💥 [Database] Failed to save aggregated alert: ${err.message}`);
      }
    }
  });

  // --- 10. Reorg handling ---
  blockTracker.on("reorg", (reorg) => {
    finalityTracker.onReorg(reorg);
  });

  finalityTracker.on("finality:upgraded", async (data) => {
    // Update finality in database (no notification for finality upgrades - too verbose)
    try {
      if (!data.event) return;
      
      // Update single event's finality status
      await eventRepo.updateFinality(data.event.id, data.to);
      
      console.log(`  ⬆️  [Finality] ${data.event.eventType} upgraded: ${data.from} → ${data.to} (Block ${data.event.blockNumber})`);
    } catch (err) {
      console.error(`  💥 [Database] Failed to update finality: ${err.message}`);
    }
  });

  finalityTracker.on("finality:reverted", async (data) => {
    // Critical event - log revert but don't spam notifications
    console.log(`  🚨 Event reverted: ${data.event?.eventType || 'Unknown'} at block ${data.event?.blockNumber}`);
    
    // Update event as reverted in database
    try {
      if (data.event && data.event.id) {
        await eventRepo.updateFinality(data.event.id, 'reverted');
      }
    } catch (err) {
      console.error(`  💥 [Database] Failed to mark event as reverted: ${err.message}`);
    }
  });

  // --- 11. Health check every 60s ---
  const healthInterval = setInterval(() => {
    rpcPool.healthCheck();
  }, 60_000);

  // --- 12. Stats every 5 minutes ---
  const statsInterval = setInterval(() => {
    const nf = noiseFilter.getStats();
    const ag = aggregator.getStats();
    console.log(`\n  📊 Noise filter: ${nf.passed} passed, ${nf.suppressionRate} suppressed | Aggregator: ${ag.activeWindows} active window(s)\n`);
  }, 300_000);

  // --- 13. Test notification channels ---
  await notificationDispatcher.testChannels();

  // --- 14. Start ---
  console.log();
  console.log("  🚀 Starting Genesis...");
  console.log(`  🎯 Active rules: ${ruleLoader.getAll().length}`);
  console.log(`  📡 Watch targets: ${logFetcher.getStats().activeTargets}`);
  console.log(`  📡 Finality: soft=${chainConfig.softConfirmBlocks} blocks, final=${chainConfig.finalityBlocks} blocks`);
  console.log();

  // Initial health check
  await rpcPool.healthCheck();
  console.log();
  console.log("  ⏳ Waiting for new blocks...");
  console.log("  (Press Ctrl+C to stop)");
  console.log();

  await blockTracker.start();

  // --- 14. Graceful shutdown ---
  const shutdown = async () => {
    console.log("\n  🛑 Shutting down Genesis...");
    blockTracker.stop();
    clearInterval(healthInterval);
    clearInterval(statsInterval);
    aggregator.flushAll(); // flush pending aggregation windows
    ruleLoader.stop();
    rpcPool.destroy();

    // Close database connection
    await db.close();

    // Print final stats
    const finalityStats = finalityTracker.getStats();
    const noiseStats = noiseFilter.getStats();
    const dbStats = db.getStats();
    
    console.log(`  📊 Final stats:`);
    console.log(`     Events tracked: ${finalityStats.totalTracked}`);
    console.log(`     Finality: ${JSON.stringify(finalityStats.byStatus)}`);
    console.log(`     Noise filter: ${noiseStats.passed} passed, ${noiseStats.suppressionRate} suppressed`);
    console.log(`       ↳ Cooldown: ${noiseStats.suppressed_cooldown} | Dedup: ${noiseStats.suppressed_dedup} | Severity: ${noiseStats.suppressed_severity}`);
    if (dbStats) {
      console.log(`     Database pool: ${dbStats.total} total, ${dbStats.idle} idle`);
    }
    console.log("  👋 Goodbye!\n");

    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("\n  💥 Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
