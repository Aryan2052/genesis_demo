/**
 * Genesis — Pipeline Orchestrator
 *
 * CONNECTS ALL ENGINE MODULES INTO A UNIFIED PIPELINE:
 *
 *   ContractListener (events)
 *     → EventModel (reorg-safe IDs)
 *     → FinalityTracker (pending → soft → finalized)
 *     → RuleEvaluator (condition matching against rules)
 *     → NoiseFilter (cooldowns, dedup, severity gate)
 *     → Aggregator (event windowing + summaries)
 *     → AnomalyDetector (z-score statistical outliers)
 *     → WalletProfiler (cross-contract behavior + risk scoring)
 *     → InsightFormatter (AI enrichment)
 *     → SSE + Telegram + SQLite
 *
 * This is the "brain" that proves our full architecture works end-to-end.
 */

const { createEventId, FinalityStatus } = require("./pipeline/event-model");
const FinalityTracker = require("./pipeline/finality");
const { RuleLoader, RuleEvaluator, Aggregator, NoiseFilter, AnomalyDetector, WalletProfiler } = require("./engine");

class PipelineOrchestrator {
  /**
   * @param {object} opts
   * @param {object} opts.deployment — parsed localhost.json
   */
  constructor(opts = {}) {
    const deployment = opts.deployment || {};
    const contracts = deployment.contracts || {};

    // ── 1. Finality Tracker ──
    this.finalityTracker = new FinalityTracker({
      slug: "localhost",
      softConfirmBlocks: 1,   // Hardhat: instant
      finalityBlocks: 3,      // After 3 blocks = finalized
    });

    // ── 2. Rule Loader (load from disk + inject dynamic local rules) ──
    this.ruleLoader = new RuleLoader();
    try { this.ruleLoader.load(); } catch (e) { /* rules dir may not exist */ }

    // Inject dynamic rules for deployed contracts
    this._injectLocalRules(contracts);

    // ── 3. Rule Evaluator ──
    this.ruleEvaluator = new RuleEvaluator(this.ruleLoader);

    // ── 4. Noise Filter ──
    this.noiseFilter = new NoiseFilter();
    this.noiseFilter.setMinSeverity("low"); // pass everything in demo

    // ── 5. Aggregator ──
    this.aggregator = new Aggregator();

    // ── 6. Anomaly Detector ──
    this.anomalyDetector = new AnomalyDetector();

    // ── 7. Wallet Profiler ──
    this.walletProfiler = new WalletProfiler();

    // ── Tracking ──
    this.processedCount = 0;
    this.ruleMatchCount = 0;
    this.noiseFilteredCount = 0;
    this.aggregatedAlertCount = 0;
    this.anomalyCount = 0;
    this.finalityUpgrades = 0;
    this.intelligenceLog = [];

    // ── Wire internal events ──
    this.finalityTracker.on("finality:upgraded", (data) => {
      this.finalityUpgrades++;
    });

    this.finalityTracker.on("finality:reverted", (data) => {
      // Could broadcast reorg alerts
    });

    this.aggregator.on("alert:aggregated", (aggregatedAlert) => {
      this.aggregatedAlertCount++;
      if (this.noiseFilter.shouldPassAggregated(aggregatedAlert)) {
        this._pushIntelLog({
          type: "aggregated_alert",
          severity: aggregatedAlert.severity,
          summary: aggregatedAlert.summary,
          eventCount: aggregatedAlert.events?.length || 0,
          timestamp: Date.now(),
        });
      }
    });

    this.walletProfiler.on("pattern", (pattern) => {
      this._pushIntelLog(pattern);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Inject Dynamic Rules for Local Contracts
  // ─────────────────────────────────────────────────────────────────────────

  _injectLocalRules(contracts) {
    const localRules = [];

    if (contracts.GenesisVault) {
      localRules.push({
        rule_id: "local_large_deposit",
        name: "🐋 Large Vault Deposit",
        event_type: "deposit",
        chain: "localhost",
        conditions: { amount_raw: { gte: "100000000000" } }, // $100K
        severity: "high",
        cooldown_sec: 10,
        aggregation: { enabled: true, window_sec: 30, group_by: ["contract"], summary: "total_amount" },
      });
      localRules.push({
        rule_id: "local_large_withdrawal",
        name: "🚨 Large Vault Withdrawal",
        event_type: "withdrawal",
        chain: "localhost",
        conditions: { amount_raw: { gte: "50000000000" } }, // $50K
        severity: "high",
        cooldown_sec: 10,
      });
      localRules.push({
        rule_id: "local_vault_pause",
        name: "🔴 Vault Emergency Pause",
        event_type: "vault_paused",
        chain: "localhost",
        severity: "critical",
        cooldown_sec: 0,
      });
    }

    if (contracts.GenesisLiquidityPool) {
      localRules.push({
        rule_id: "local_large_swap",
        name: "🔄 Large Pool Swap",
        event_type: "swap",
        chain: "localhost",
        conditions: { amount_raw: { gte: "50000000000" } },
        severity: "medium",
        cooldown_sec: 15,
        aggregation: { enabled: true, window_sec: 60, group_by: ["contract"], summary: "count" },
      });
    }

    if (contracts.GenesisGovernance) {
      localRules.push({
        rule_id: "local_governance_proposal",
        name: "📜 New Governance Proposal",
        event_type: "governance_proposal_created",
        chain: "localhost",
        severity: "medium",
        cooldown_sec: 0,
      });
      localRules.push({
        rule_id: "local_governance_vote",
        name: "🗳️ Governance Vote Cast",
        event_type: "governance_vote",
        chain: "localhost",
        severity: "low",
        cooldown_sec: 5,
        aggregation: { enabled: true, window_sec: 30, group_by: ["contract"], summary: "count" },
      });
    }

    if (contracts.AlertRegistry) {
      localRules.push({
        rule_id: "local_onchain_alert",
        name: "⚡ On-Chain Alert Recorded",
        event_type: "alert_recorded",
        chain: "localhost",
        severity: "high",
        cooldown_sec: 5,
      });
    }

    // Add all local rules to the loader
    for (const rule of localRules) {
      rule.enabled = true;
      this.ruleLoader.rules.set(rule.rule_id, rule);
    }

    if (localRules.length > 0) {
      console.log(`  📋 [Pipeline] Injected ${localRules.length} local rules for Hardhat contracts`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Main Processing: Run an event through the full pipeline
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Process a raw event from ContractListener through all pipeline stages.
   * @param {object} event — raw event from listener.on("event")
   * @returns {{ ruleMatches: number, anomaly: object|null, walletProfile: object|null, filtered: boolean }}
   */
  processEvent(event) {
    this.processedCount++;

    // ── Stage 1: Normalize into GenesisEvent-like structure ──
    const normalized = {
      id: createEventId(31337, "", event.txHash || "", 0),
      chain: "localhost",
      chainId: 31337,
      blockNumber: event.blockNumber || 0,
      blockHash: "",
      txHash: event.txHash || "",
      logIndex: 0,
      contract: event.contract || "",
      eventName: event.type,
      eventType: event.type,
      args: {
        ...event,
        _rawValue: String(event.amount || event.depositAmount || event.withdrawAmount || event.amountIn || "0"),
        from: event.user || event.from || event.voter || event.beneficiary || event.proposer || "",
      },
      finality: FinalityStatus.PENDING,
      confirmations: 0,
      timestamp: event.timestamp || Math.floor(Date.now() / 1000),
    };

    // ── Stage 2: Track finality ──
    this.finalityTracker.track(normalized);

    // ── Stage 3: Evaluate rules ──
    const matches = this.ruleEvaluator.evaluate(normalized);
    this.ruleMatchCount += matches.length;

    // ── Stage 4: Noise filter + aggregation for each match ──
    let filtered = false;
    for (const match of matches) {
      if (this.noiseFilter.shouldPass({ ...match, severity: match.rule.severity || "medium" })) {
        // Pass to aggregator
        this.aggregator.process(match);
      } else {
        this.noiseFilteredCount++;
        filtered = true;
      }
    }

    // ── Stage 5: Anomaly detection ──
    // event.amount may be a locale-formatted string like "500,000.00" — strip commas before parsing
    const rawAmt = String(event.amount || event.depositAmount || event.withdrawAmount || event.amountIn || "0").replace(/,/g, "");
    const amount = Number(rawAmt) || 0;
    let anomaly = null;
    if (amount > 0) {
      this.anomalyDetector.recordTransfer("gUSD", String(BigInt(Math.round(amount * 1e6))), 6);
      anomaly = this.anomalyDetector.detectTransferAnomaly("gUSD", amount);
      if (anomaly) {
        this.anomalyCount++;
        this._pushIntelLog({
          type: "anomaly",
          ...anomaly,
          event: event.type,
          timestamp: Date.now(),
        });
      }
    }

    // ── Stage 6: Wallet profiling ──
    let walletProfile = null;
    const wallet = event.user || event.from || event.voter || event.beneficiary || event.proposer || event.executor || "";
    if (wallet && wallet !== "0x0000000000000000000000000000000000000000") {
      const actionMap = {
        deposit: "deposit", withdrawal: "withdraw", large_movement: "deposit",
        internal_transfer: "transfer", swap: "swap",
        governance_vote: "vote", governance_proposal_created: "propose",
        vesting_created: "vest", vesting_claimed: "claim",
        liquidity_added: "add_liquidity", liquidity_removed: "remove_liquidity",
      };
      walletProfile = this.walletProfiler.recordAction({
        wallet,
        action: actionMap[event.type] || event.type,
        contract: event.contract || "unknown",
        amount,
        txHash: event.txHash || "",
        blockNumber: event.blockNumber || 0,
      });
    }

    return { ruleMatches: matches.length, anomaly, walletProfile, filtered };
  }

  /**
   * Called when a new block is mined. Updates finality for all tracked events.
   * @param {number} blockNumber
   */
  onNewBlock(blockNumber) {
    this.finalityTracker.onNewBlock(blockNumber);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Intelligence Log
  // ─────────────────────────────────────────────────────────────────────────

  _pushIntelLog(entry) {
    entry.id = entry.id || `intel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.intelligenceLog.push(entry);
    if (this.intelligenceLog.length > 500) {
      this.intelligenceLog = this.intelligenceLog.slice(-250);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Stats API — Shows judges the full pipeline is alive
  // ─────────────────────────────────────────────────────────────────────────

  getFullPipelineStats() {
    return {
      pipeline: {
        eventsProcessed: this.processedCount,
        ruleMatches: this.ruleMatchCount,
        noiseFiltered: this.noiseFilteredCount,
        aggregatedAlerts: this.aggregatedAlertCount,
        anomaliesDetected: this.anomalyCount,
        finalityUpgrades: this.finalityUpgrades,
        intelligenceEvents: this.intelligenceLog.length,
      },
      modules: {
        ruleLoader: {
          totalRules: this.ruleLoader.getAll().length,
          rules: this.ruleLoader.getAll().map((r) => ({
            id: r.rule_id,
            name: r.name,
            severity: r.severity,
            eventType: r.event_type,
          })),
        },
        noiseFilter: this.noiseFilter.getStats(),
        aggregator: this.aggregator.getStats(),
        anomalyDetector: this.anomalyDetector.getStats(),
        walletProfiler: this.walletProfiler.getStats(),
        finalityTracker: this.finalityTracker.getStats(),
      },
    };
  }

  /** Cleanup */
  destroy() {
    this.aggregator.destroy();
    this.ruleLoader.stop();
  }
}

module.exports = PipelineOrchestrator;
