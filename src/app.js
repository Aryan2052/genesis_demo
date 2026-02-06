/**
 * Genesis — Main Application (Phase 2)
 *
 * Full pipeline:
 *   Observer (RPC Pool → Block Tracker → Log Fetcher)
 *     → Pipeline (Decoder → Event Model → Finality Tracker)
 *       → Engine (Rule Evaluator → Aggregator → Noise Filter)
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
const ConsoleNotifier = require("./notify/channels/console");
const Dispatcher = require("./notify/dispatcher");

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

  // --- 2. Load rules ---
  const ruleLoader = new RuleLoader();
  ruleLoader.load();
  ruleLoader.watch(); // hot-reload on file changes

  const rules = ruleLoader.getForChain(opts.chain);
  if (rules.length === 0) {
    console.warn(`  ⚠️  No rules found for chain "${opts.chain}". Add JSON files to the rules/ directory.`);
  }
  console.log();

  // --- 3. Observer Layer ---
  const rpcPool = new RpcPool(chainConfig);
  const blockTracker = new BlockTracker(rpcPool, chainConfig);
  const logFetcher = new LogFetcher(rpcPool, chainConfig);

  // --- 4. Pipeline Layer ---
  const decoder = new Decoder(chainConfig, config.abis);
  const finalityTracker = new FinalityTracker(chainConfig);

  // --- 5. Engine Layer (Phase 2) ---
  const ruleEvaluator = new RuleEvaluator(ruleLoader);
  const aggregator = new Aggregator();
  const noiseFilter = new NoiseFilter();

  // --- 6. Notification Layer ---
  const dispatcher = new Dispatcher();
  dispatcher.addChannel("console", new ConsoleNotifier());

  // --- 7. SELECTIVE INDEXING: Rules drive what we watch ---
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

    if (events.length === 0) {
      console.log(`  📦 Block ${blockNumber}: ${logs.length} logs → 0 decoded events`);
      return;
    }

    // Track finality for all decoded events
    for (const event of events) {
      finalityTracker.track(event);
    }

    // ┌─────────────────────────────────────────────┐
    // │  PHASE 2: Rule Evaluation → Aggregation     │
    // │  Events only become alerts if a rule matches │
    // └─────────────────────────────────────────────┘

    const matches = ruleEvaluator.evaluateBatch(events);

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

  // --- 9. Aggregator → Noise Filter → Dispatcher ---

  // Instant alerts (high/critical severity bypass aggregation)
  aggregator.on("alert", (alert) => {
    if (noiseFilter.shouldPass(alert)) {
      dispatcher.notifyAlert(alert);
    }
  });

  // Aggregated alerts (window expired → summary)
  aggregator.on("alert:aggregated", (alert) => {
    if (noiseFilter.shouldPassAggregated(alert)) {
      dispatcher.notifyAggregated(alert);
    }
  });

  // --- 10. Reorg handling ---
  blockTracker.on("reorg", (reorg) => {
    finalityTracker.onReorg(reorg);
  });

  finalityTracker.on("finality:upgraded", (data) => {
    dispatcher.notifyFinalityUpgrade(data);
  });

  finalityTracker.on("finality:reverted", (data) => {
    dispatcher.notifyRevert(data);
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

  // --- 13. Start ---
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
  const shutdown = () => {
    console.log("\n  🛑 Shutting down Genesis...");
    blockTracker.stop();
    clearInterval(healthInterval);
    clearInterval(statsInterval);
    aggregator.flushAll(); // flush pending aggregation windows
    ruleLoader.stop();
    rpcPool.destroy();

    // Print final stats
    const finalityStats = finalityTracker.getStats();
    const noiseStats = noiseFilter.getStats();
    console.log(`  📊 Final stats:`);
    console.log(`     Events tracked: ${finalityStats.totalTracked}`);
    console.log(`     Finality: ${JSON.stringify(finalityStats.byStatus)}`);
    console.log(`     Noise filter: ${noiseStats.passed} passed, ${noiseStats.suppressionRate} suppressed`);
    console.log(`       ↳ Cooldown: ${noiseStats.suppressed_cooldown} | Dedup: ${noiseStats.suppressed_dedup} | Severity: ${noiseStats.suppressed_severity}`);
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
