/**
 * Genesis — On-Chain Contract Listener
 *
 * Replaces the Infura-based observer with DIRECT contract event subscriptions.
 * Connects to our own deployed contracts on a local Hardhat node (or any EVM chain).
 *
 * Architecture:
 *   Contract events (Solidity `emit`) → ethers.js subscription → Genesis pipeline
 *     → ThresholdEngine check → CyreneAI insight formatter → Telegram delivery
 *
 * No Infura dependency.  No polling.  Pure event-driven.
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

// ── Load deployment info ────────────────────────────────────────────────────
function loadDeployment() {
  const deployPath = path.resolve(__dirname, "../deployments/localhost.json");
  if (!fs.existsSync(deployPath)) {
    console.error("❌ No deployment found. Run: npx hardhat run scripts/deploy.js --network localhost");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(deployPath, "utf8"));
}

// ── Load compiled ABIs from Hardhat artifacts ──────────────────────────────
function loadABI(contractName) {
  const artifactPath = path.resolve(
    __dirname,
    `../artifacts/contracts/${contractName}.sol/${contractName}.json`
  );
  if (!fs.existsSync(artifactPath)) {
    console.error(`❌ ABI not found for ${contractName}. Run: npx hardhat compile`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(artifactPath, "utf8")).abi;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ContractListener class
// ═══════════════════════════════════════════════════════════════════════════
class ContractListener extends EventEmitter {
  constructor(rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545") {
    super();
    this.rpcUrl = rpcUrl;
    this.chainName = process.env.CHAIN_NAME || "localhost";
    this.chainId = parseInt(process.env.CHAIN_ID) || 31337;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.deployment = loadDeployment();
    this.contracts = {};
    this.activeThresholds = []; // loaded from ThresholdEngine on-chain
    this.stats = {
      eventsReceived: 0,
      depositsDetected: 0,
      withdrawalsDetected: 0,
      largeMovements: 0,
      internalTransfers: 0,
      thresholdChanges: 0,
      alertsRecorded: 0,
      vestingEvents: 0,
      governanceEvents: 0,
      liquidityEvents: 0,
      startedAt: Date.now(),
    };
  }

  /** Wire up all contract instances and subscribe to their events. */
  async start() {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║     🧬 GENESIS — On-Chain Contract Listener         ║");
    console.log("║     Event-Driven · No Infura · Direct Subscriptions ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log();

    const network = await this.provider.getNetwork();
    console.log(`  🌐 Connected to chain ${network.chainId} (${this.chainName}) via ${this.rpcUrl}`);
    console.log();

    // Load contract ABIs and instantiate
    this._connectContracts();

    // Load active thresholds from ThresholdEngine smart contract
    await this._loadActiveThresholds();

    // Subscribe to events
    this._subscribeVaultEvents();
    this._subscribeThresholdEvents();
    this._subscribeAlertRegistryEvents();
    this._subscribeTokenTransfers();
    if (this.contracts.vesting)       this._subscribeVestingEvents();
    if (this.contracts.governance)    this._subscribeGovernanceEvents();
    if (this.contracts.liquidityPool) this._subscribeLiquidityEvents();

    // Block listener for heartbeat
    this.provider.on("block", (blockNumber) => {
      if (blockNumber % 10 === 0) {
        console.log(`  ⛏️  Block #${blockNumber} | Events: ${this.stats.eventsReceived} | Large: ${this.stats.largeMovements}`);
      }
    });

    console.log();
    console.log("  ⏳ Listening for on-chain events...");
    console.log("  (Press Ctrl+C to stop)");
    console.log();
  }

  // ── Connect to deployed contracts ──────────────────────────────────────
  _connectContracts() {
    const d = this.deployment.contracts;

    this.contracts.token = new ethers.Contract(
      d.GenesisToken.address,
      loadABI("GenesisToken"),
      this.provider
    );
    this.contracts.vault = new ethers.Contract(
      d.GenesisVault.address,
      loadABI("GenesisVault"),
      this.provider
    );
    this.contracts.thresholdEngine = new ethers.Contract(
      d.ThresholdEngine.address,
      loadABI("ThresholdEngine"),
      this.provider
    );
    this.contracts.alertRegistry = new ethers.Contract(
      d.AlertRegistry.address,
      loadABI("AlertRegistry"),
      this.provider
    );

    // ── New: Vesting & Governance ──
    if (d.GenesisVesting) {
      this.contracts.vesting = new ethers.Contract(
        d.GenesisVesting.address,
        loadABI("GenesisVesting"),
        this.provider
      );
    }
    if (d.GenesisGovernance) {
      this.contracts.governance = new ethers.Contract(
        d.GenesisGovernance.address,
        loadABI("GenesisGovernance"),
        this.provider
      );
    }
    if (d.GenesisLiquidityPool) {
      this.contracts.liquidityPool = new ethers.Contract(
        d.GenesisLiquidityPool.address,
        loadABI("GenesisLiquidityPool"),
        this.provider
      );
    }

    console.log("  📋 Contracts connected:");
    console.log(`     Token:           ${d.GenesisToken.address}`);
    console.log(`     Vault:           ${d.GenesisVault.address}`);
    console.log(`     ThresholdEngine: ${d.ThresholdEngine.address}`);
    console.log(`     AlertRegistry:   ${d.AlertRegistry.address}`);
    if (d.GenesisVesting)        console.log(`     Vesting:         ${d.GenesisVesting.address}`);
    if (d.GenesisGovernance)     console.log(`     Governance:      ${d.GenesisGovernance.address}`);
    if (d.GenesisLiquidityPool)  console.log(`     LiquidityPool:   ${d.GenesisLiquidityPool.address}`);
  }

  // ── Load active thresholds from ThresholdEngine smart contract ────────
  async _loadActiveThresholds() {
    try {
      const engine = this.contracts.thresholdEngine;

      // Load global rules
      const globalCount = Number(await engine.getGlobalRuleCount());
      const thresholds = [];

      for (let i = 0; i < globalCount; i++) {
        const rule = await engine.globalRules(i);
        if (rule.enabled) {
          thresholds.push({
            source: "global",
            index: i,
            token: rule.token,
            alertType: Number(rule.alertType),
            threshold: Number(rule.threshold),
            cooldownSec: Number(rule.cooldownSec),
            description: rule.description,
          });
        }
      }

      // Load user rules for all active users
      const activeUserCount = Number(await engine.getActiveUserCount());
      for (let u = 0; u < activeUserCount; u++) {
        const userAddr = await engine.activeUsers(u);
        const userRuleCount = Number(await engine.getUserRuleCount(userAddr));
        for (let i = 0; i < userRuleCount; i++) {
          const rule = await engine.getUserRule(userAddr, i);
          if (rule.enabled) {
            thresholds.push({
              source: "user",
              user: userAddr,
              index: i,
              token: rule.token,
              alertType: Number(rule.alertType),
              threshold: Number(rule.threshold),
              cooldownSec: Number(rule.cooldownSec),
              description: rule.description,
            });
          }
        }
      }

      this.activeThresholds = thresholds;
      console.log(`  ⚙️  Loaded ${thresholds.length} active thresholds from ThresholdEngine on-chain`);
      if (thresholds.length > 0) {
        for (const t of thresholds) {
          const types = ["Large Transfer", "Whale Movement", "Rapid Flow", "Custom"];
          console.log(`     ${t.source === "global" ? "🌍" : "👤"} ${types[t.alertType] || "Custom"}: $${(t.threshold / 1e6).toLocaleString("en-US")} (${t.description})`);
        }
      }
    } catch (err) {
      console.log(`  ⚠️  Could not load thresholds: ${err.message.slice(0, 80)}`);
    }
  }

  /**
   * Check if a transfer amount triggers any on-chain user/global threshold.
   * Returns array of matched thresholds.
   */
  checkUserThresholds(amountRaw) {
    const amount = Number(amountRaw);
    return this.activeThresholds.filter((t) => amount >= t.threshold);
  }

  /** Reload thresholds from on-chain (called when ThresholdSet/Updated events fire) */
  async reloadThresholds() {
    await this._loadActiveThresholds();
    this.emit("thresholds_reloaded", { count: this.activeThresholds.length });
  }

  /** Get all active thresholds (for API) */
  getActiveThresholds() {
    return this.activeThresholds;
  }

  // ── Vault events ──────────────────────────────────────────────────────
  _subscribeVaultEvents() {
    const vault = this.contracts.vault;

    vault.on("Deposit", (user, amount, newBalance, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.depositsDetected++;
      const amountFormatted = this._formatAmount(amount);
      const balanceFormatted = this._formatAmount(newBalance);

      console.log(`  💰 [Deposit] ${this._short(user)} deposited $${amountFormatted} (balance: $${balanceFormatted})`);

      this.emit("event", {
        type: "deposit",
        user,
        amount: amountFormatted,
        amountRaw: amount.toString(),
        newBalance: balanceFormatted,
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });

      // ── Check user-defined thresholds ──
      const matched = this.checkUserThresholds(amount.toString());
      for (const t of matched) {
        console.log(`  🔔 [User Threshold Triggered] $${amountFormatted} exceeded ${t.source} rule: "${t.description}" ($${(t.threshold / 1e6).toLocaleString("en-US")} limit)`);
        this.emit("alert", {
          type: "user_threshold_triggered",
          subType: "deposit",
          alertType: t.alertType,                               // 0=Large, 1=Whale, 2=RapidFlow, 3=Custom
          user,
          amount: amountFormatted,
          amountRaw: amount.toString(),
          thresholdSource: t.source,
          thresholdOwner: t.user || "protocol",
          thresholdDescription: t.description,
          thresholdAmount: (t.threshold / 1e6).toLocaleString("en-US"),
          severity: t.alertType === 1 ? "critical" : "high", // Whale=critical
          timestamp: Number(timestamp),
          txHash: event.log.transactionHash,
          blockNumber: event.log.blockNumber,
        });
      }
    });

    vault.on("Withdrawal", (user, amount, remaining, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.withdrawalsDetected++;
      const amountFormatted = this._formatAmount(amount);

      console.log(`  📤 [Withdrawal] ${this._short(user)} withdrew $${amountFormatted}`);

      this.emit("event", {
        type: "withdrawal",
        user,
        amount: amountFormatted,
        amountRaw: amount.toString(),
        remainingBalance: this._formatAmount(remaining),
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });

      // ── Check user-defined thresholds ──
      const matched = this.checkUserThresholds(amount.toString());
      for (const t of matched) {
        console.log(`  🔔 [User Threshold Triggered] $${amountFormatted} withdrawal exceeded ${t.source} rule: "${t.description}"`);
        this.emit("alert", {
          type: "user_threshold_triggered",
          subType: "withdrawal",
          alertType: t.alertType,                               // 0=Large, 1=Whale, 2=RapidFlow, 3=Custom
          user,
          amount: amountFormatted,
          amountRaw: amount.toString(),
          thresholdSource: t.source,
          thresholdOwner: t.user || "protocol",
          thresholdDescription: t.description,
          thresholdAmount: (t.threshold / 1e6).toLocaleString("en-US"),
          severity: t.alertType === 1 ? "critical" : "high",
          timestamp: Number(timestamp),
          txHash: event.log.transactionHash,
          blockNumber: event.log.blockNumber,
        });
      }
    });

    vault.on("InternalTransfer", (from, to, amount, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.internalTransfers++;
      const amountFormatted = this._formatAmount(amount);

      console.log(`  🔄 [Internal] ${this._short(from)} → ${this._short(to)}: $${amountFormatted}`);

      this.emit("event", {
        type: "internal_transfer",
        from,
        to,
        amount: amountFormatted,
        amountRaw: amount.toString(),
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    vault.on("LargeMovement", (user, movementType, amount, threshold, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.largeMovements++;
      const amountFormatted = this._formatAmount(amount);

      console.log(`  🚨 [LARGE ${movementType.toUpperCase()}] ${this._short(user)}: $${amountFormatted} (threshold: $${this._formatAmount(threshold)})`);

      this.emit("alert", {
        type: "large_movement",
        subType: movementType,
        user,
        amount: amountFormatted,
        amountRaw: amount.toString(),
        threshold: this._formatAmount(threshold),
        severity: "high",
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    vault.on("EmergencyAction", (action, triggeredBy, timestamp, event) => {
      this.stats.eventsReceived++;
      console.log(`  🛑 [EMERGENCY] Vault ${action} by ${this._short(triggeredBy)}`);

      this.emit("alert", {
        type: "emergency",
        action,
        triggeredBy,
        severity: "critical",
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    console.log("  ✅ Subscribed to Vault events (Deposit, Withdrawal, LargeMovement, Emergency)");
  }

  // ── ThresholdEngine events ────────────────────────────────────────────
  _subscribeThresholdEvents() {
    const engine = this.contracts.thresholdEngine;

    engine.on("ThresholdSet", (user, ruleIndex, token, alertType, threshold, cooldown, description, timestamp) => {
      this.stats.eventsReceived++;
      this.stats.thresholdChanges++;
      console.log(`  ⚙️  [Threshold] ${this._short(user)} set rule #${ruleIndex}: "${description}" → $${this._formatAmount(threshold)}`);

      // Auto-reload thresholds so new rules take effect immediately
      this.reloadThresholds().catch(() => {});

      this.emit("threshold_change", {
        action: "set",
        user,
        ruleIndex: Number(ruleIndex),
        threshold: this._formatAmount(threshold),
        description,
        timestamp: Number(timestamp),
      });
    });

    engine.on("ThresholdUpdated", (user, ruleIndex, oldThreshold, newThreshold, timestamp) => {
      this.stats.eventsReceived++;
      this.stats.thresholdChanges++;
      console.log(`  ⚙️  [Threshold] ${this._short(user)} updated rule #${ruleIndex}: $${this._formatAmount(oldThreshold)} → $${this._formatAmount(newThreshold)}`);

      // Auto-reload thresholds so updated rules take effect immediately
      this.reloadThresholds().catch(() => {});

      this.emit("threshold_change", {
        action: "updated",
        user,
        ruleIndex: Number(ruleIndex),
        oldThreshold: this._formatAmount(oldThreshold),
        newThreshold: this._formatAmount(newThreshold),
        timestamp: Number(timestamp),
      });
    });

    console.log("  ✅ Subscribed to ThresholdEngine events (Set, Updated, Removed)");
  }

  // ── AlertRegistry events ──────────────────────────────────────────────
  _subscribeAlertRegistryEvents() {
    const registry = this.contracts.alertRegistry;

    registry.on("AlertRecorded", (alertId, triggeredBy, token, amount, severity, alertType, summary, blockNumber, timestamp) => {
      this.stats.eventsReceived++;
      this.stats.alertsRecorded++;
      const severityNames = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
      console.log(`  📝 [Alert #${alertId}] ${severityNames[Number(severity)]} — ${alertType}: ${summary}`);

      this.emit("alert_recorded", {
        alertId: Number(alertId),
        triggeredBy,
        token,
        amount: this._formatAmount(amount),
        severity: severityNames[Number(severity)],
        alertType,
        summary,
        blockNumber: Number(blockNumber),
        timestamp: Number(timestamp),
      });
    });

    console.log("  ✅ Subscribed to AlertRegistry events (AlertRecorded)");
  }

  // ── Token Transfer events (ERC20 standard) ───────────────────────────
  _subscribeTokenTransfers() {
    const token = this.contracts.token;

    token.on("Transfer", (from, to, value, event) => {
      this.stats.eventsReceived++;
      const amountFormatted = this._formatAmount(value);

      // Only log significant transfers (> $1000) to reduce noise
      if (value > 1000n * 1_000_000n) {
        console.log(`  💸 [Transfer] ${this._short(from)} → ${this._short(to)}: $${amountFormatted}`);
      }

      this.emit("event", {
        type: "erc20_transfer",
        from,
        to,
        amount: amountFormatted,
        amountRaw: value.toString(),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    console.log("  ✅ Subscribed to gUSD Token Transfer events");
  }

  // ── Vesting events ────────────────────────────────────────────────────
  _subscribeVestingEvents() {
    const vesting = this.contracts.vesting;

    // VestingCreated(scheduleId, beneficiary, token, totalAmount, cliffDuration, vestingDuration, description, timestamp)
    vesting.on("VestingCreated", (scheduleId, beneficiary, token, totalAmount, cliffDuration, vestingDuration, description, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.vestingEvents++;
      const amountFormatted = this._formatAmount(totalAmount);
      const durationDays = Number(vestingDuration) / 86400;
      const cliffDays = Number(cliffDuration) / 86400;
      console.log(`  📅 [Vesting #${Number(scheduleId)}] ${this._short(beneficiary)} | $${amountFormatted} over ${durationDays.toFixed(1)}d (cliff: ${cliffDays.toFixed(1)}d) | "${description}"`);

      this.emit("event", {
        type: "vesting_schedule_created",
        scheduleId: Number(scheduleId),
        beneficiary,
        token,
        amount: amountFormatted,
        amountRaw: totalAmount.toString(),
        durationDays,
        cliffDays,
        description,
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // TokensClaimed(scheduleId, beneficiary, amountClaimed, totalClaimed, remainingLocked, timestamp)
    vesting.on("TokensClaimed", (scheduleId, beneficiary, amountClaimed, totalClaimed, remainingLocked, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.vestingEvents++;
      const claimedFmt = this._formatAmount(amountClaimed);
      const totalFmt = this._formatAmount(totalClaimed);
      const remainFmt = this._formatAmount(remainingLocked);
      console.log(`  🔓 [Vesting Claim] ${this._short(beneficiary)} claimed $${claimedFmt} (total: $${totalFmt}, remaining: $${remainFmt})`);

      this.emit("event", {
        type: "vesting_claim",
        scheduleId: Number(scheduleId),
        beneficiary,
        amount: claimedFmt,
        amountRaw: amountClaimed.toString(),
        totalClaimed: totalFmt,
        remainingLocked: remainFmt,
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // VestingRevoked(scheduleId, beneficiary, unvestedAmount, vestedUnclaimed, timestamp)
    vesting.on("VestingRevoked", (scheduleId, beneficiary, unvestedAmount, vestedUnclaimed, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.vestingEvents++;
      const unvestedFmt = this._formatAmount(unvestedAmount);
      const unclaimedFmt = this._formatAmount(vestedUnclaimed);
      console.log(`  ❌ [Vesting Revoked] Schedule #${Number(scheduleId)} | ${this._short(beneficiary)} | $${unvestedFmt} returned, $${unclaimedFmt} unclaimed`);

      this.emit("event", {
        type: "vesting_revoked",
        scheduleId: Number(scheduleId),
        beneficiary,
        unvestedAmount: unvestedFmt,
        vestedUnclaimed: unclaimedFmt,
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // UnlockMilestone(scheduleId, beneficiary, milestone, unlockedAmount, timestamp)
    vesting.on("UnlockMilestone", (scheduleId, beneficiary, milestone, unlockedAmount, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.vestingEvents++;
      const amountFormatted = this._formatAmount(unlockedAmount);
      console.log(`  🎯 [Milestone] ${this._short(beneficiary)} | "${milestone}" | $${amountFormatted} unlocked`);

      this.emit("event", {
        type: "vesting_milestone",
        scheduleId: Number(scheduleId),
        beneficiary,
        milestone,       // string: "cliff_reached", "25_percent", etc.
        amount: amountFormatted,
        amountRaw: unlockedAmount.toString(),
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    console.log("  ✅ Subscribed to Vesting events (Created, Claimed, Revoked, Milestone)");
  }

  // ── Governance events ─────────────────────────────────────────────────
  _subscribeGovernanceEvents() {
    const gov = this.contracts.governance;

    // ProposalCreated(proposalId, proposer, title, description, startTime, endTime, timestamp)
    gov.on("ProposalCreated", (proposalId, proposer, title, description, startTime, endTime, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.governanceEvents++;
      const id = Number(proposalId);
      const endsIn = Math.round((Number(endTime) - Number(timestamp)) / 60);
      console.log(`  🏛️  [Proposal #${id}] by ${this._short(proposer)} | "${title}" | Voting: ${endsIn}min`);

      this.emit("event", {
        type: "governance_proposal_created",
        proposalId: id,
        proposer,
        title,
        description,
        startTime: Number(startTime),
        endTime: Number(endTime),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // VoteCast(proposalId, voter, voteType, weight, reason, timestamp)
    gov.on("VoteCast", (proposalId, voter, voteType, weight, reason, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.governanceEvents++;
      const id = Number(proposalId);
      const voteNames = ["❌ AGAINST", "✅ FOR", "⚪ ABSTAIN"];
      const voteName = voteNames[Number(voteType)] || `Unknown(${voteType})`;
      const weightFormatted = this._formatAmount(weight);
      console.log(`  🗳️  [Vote] Proposal #${id} | ${this._short(voter)} voted ${voteName} (weight: $${weightFormatted})${reason ? ` — "${reason}"` : ""}`);

      this.emit("event", {
        type: "governance_vote",
        proposalId: id,
        voter,
        voteType: Number(voteType),
        support: Number(voteType) === 1,
        weight: weightFormatted,
        weightRaw: weight.toString(),
        reason,
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // ProposalExecuted(proposalId, executor, votesFor, votesAgainst, timestamp)
    gov.on("ProposalExecuted", (proposalId, executor, votesFor, votesAgainst, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.governanceEvents++;
      const id = Number(proposalId);
      console.log(`  ⚡ [Proposal Executed] #${id} by ${this._short(executor)} | For: $${this._formatAmount(votesFor)} vs Against: $${this._formatAmount(votesAgainst)}`);

      this.emit("event", {
        type: "governance_proposal_executed",
        proposalId: id,
        executor,
        votesFor: this._formatAmount(votesFor),
        votesAgainst: this._formatAmount(votesAgainst),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // ProposalCancelled(proposalId, canceller, reason, timestamp)
    gov.on("ProposalCancelled", (proposalId, canceller, reason, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.governanceEvents++;
      const id = Number(proposalId);
      console.log(`  🚫 [Proposal Cancelled] #${id} by ${this._short(canceller)} — "${reason}"`);

      this.emit("event", {
        type: "governance_proposal_cancelled",
        proposalId: id,
        canceller,
        reason,
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // ProposalStateChanged(proposalId, oldState, newState, timestamp)
    gov.on("ProposalStateChanged", (proposalId, oldState, newState, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.governanceEvents++;
      const id = Number(proposalId);
      const states = ["Active", "Passed", "Failed", "Executed", "Cancelled"];
      const oldName = states[Number(oldState)] || `Unknown(${oldState})`;
      const newName = states[Number(newState)] || `Unknown(${newState})`;
      console.log(`  🔄 [Proposal #${id}] ${oldName} → ${newName}`);

      this.emit("event", {
        type: "governance_state_change",
        proposalId: id,
        oldState: Number(oldState),
        newState: Number(newState),
        stateName: newName,
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    console.log("  ✅ Subscribed to Governance events (Proposal, Vote, Execute, Cancel, StateChange)");
  }

  // ── Liquidity Pool events ─────────────────────────────────────────────
  _subscribeLiquidityEvents() {
    const pool = this.contracts.liquidityPool;

    // LiquidityAdded(provider, amountA, amountB, lpSharesMinted, newReserveA, newReserveB, timestamp)
    pool.on("LiquidityAdded", (provider, amountA, amountB, shares, newResA, newResB, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.liquidityEvents++;
      const aFmt = this._formatAmount(amountA);
      const bFmt = this._formatAmount(amountB);
      console.log(`  💧 [Liquidity Added] ${this._short(provider)} | +$${aFmt} gUSD + $${bFmt} gETH | Reserves: $${this._formatAmount(newResA)}/$${this._formatAmount(newResB)}`);

      this.emit("event", {
        type: "liquidity_added",
        provider,
        amountA: aFmt,
        amountB: bFmt,
        lpSharesMinted: shares.toString(),
        reserveA: this._formatAmount(newResA),
        reserveB: this._formatAmount(newResB),
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // LiquidityRemoved(provider, amountA, amountB, lpSharesBurned, newReserveA, newReserveB, timestamp)
    pool.on("LiquidityRemoved", (provider, amountA, amountB, shares, newResA, newResB, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.liquidityEvents++;
      const aFmt = this._formatAmount(amountA);
      const bFmt = this._formatAmount(amountB);
      console.log(`  🔻 [Liquidity Removed] ${this._short(provider)} | -$${aFmt} gUSD - $${bFmt} gETH | Reserves: $${this._formatAmount(newResA)}/$${this._formatAmount(newResB)}`);

      this.emit("event", {
        type: "liquidity_removed",
        provider,
        amountA: aFmt,
        amountB: bFmt,
        lpSharesBurned: shares.toString(),
        reserveA: this._formatAmount(newResA),
        reserveB: this._formatAmount(newResB),
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // Swap(trader, tokenIn, tokenOut, amountIn, amountOut, fee, newReserveA, newReserveB, timestamp)
    pool.on("Swap", (trader, tokenIn, tokenOut, amountIn, amountOut, fee, newResA, newResB, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.liquidityEvents++;
      const inFmt = this._formatAmount(amountIn);
      const outFmt = this._formatAmount(amountOut);
      const feeFmt = this._formatAmount(fee);
      console.log(`  🔁 [Swap] ${this._short(trader)} | $${inFmt} → $${outFmt} (fee: $${feeFmt})`);

      this.emit("event", {
        type: "liquidity_swap",
        trader,
        tokenIn,
        tokenOut,
        amountIn: inFmt,
        amountOut: outFmt,
        fee: feeFmt,
        reserveA: this._formatAmount(newResA),
        reserveB: this._formatAmount(newResB),
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // LargeSwapDetected(trader, amountIn, amountOut, priceImpactBps, timestamp)
    pool.on("LargeSwapDetected", (trader, amountIn, amountOut, priceImpactBps, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.liquidityEvents++;
      const impactPct = (Number(priceImpactBps) / 100).toFixed(2);
      console.log(`  🚨 [Large Swap] ${this._short(trader)} | Impact: ${impactPct}% | $${this._formatAmount(amountIn)} → $${this._formatAmount(amountOut)}`);

      this.emit("alert", {
        type: "large_swap",
        trader,
        amountIn: this._formatAmount(amountIn),
        amountOut: this._formatAmount(amountOut),
        priceImpactPercent: impactPct,
        severity: Number(priceImpactBps) > 1000 ? "critical" : "high",
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    // PoolRebalanced(triggeredBy, oldReserveA, oldReserveB, newReserveA, newReserveB, reason, timestamp)
    pool.on("PoolRebalanced", (triggeredBy, oldA, oldB, newA, newB, reason, timestamp, event) => {
      this.stats.eventsReceived++;
      this.stats.liquidityEvents++;
      console.log(`  ⚖️  [Pool Rebalanced] by ${this._short(triggeredBy)} | "${reason}" | Reserves: $${this._formatAmount(newA)}/$${this._formatAmount(newB)}`);

      this.emit("event", {
        type: "liquidity_rebalance",
        triggeredBy,
        oldReserveA: this._formatAmount(oldA),
        oldReserveB: this._formatAmount(oldB),
        newReserveA: this._formatAmount(newA),
        newReserveB: this._formatAmount(newB),
        reason,
        timestamp: Number(timestamp),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });

    console.log("  ✅ Subscribed to LiquidityPool events (Add, Remove, Swap, LargeSwap, Rebalance)");
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  _formatAmount(amount) {
    return (Number(amount) / 1e6).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  _short(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  getStats() {
    return {
      ...this.stats,
      uptimeSeconds: Math.round((Date.now() - this.stats.startedAt) / 1000),
    };
  }

  async stop() {
    this.provider.removeAllListeners();
    for (const contract of Object.values(this.contracts)) {
      contract.removeAllListeners();
    }
    console.log("\n  🛑 Contract listener stopped.");
  }
}

module.exports = ContractListener;

// ── Run standalone ──────────────────────────────────────────────────────
if (require.main === module) {
  const listener = new ContractListener();
  listener.start().catch(console.error);

  process.on("SIGINT", async () => {
    await listener.stop();
    const stats = listener.getStats();
    console.log("\n  📊 Final stats:");
    console.log(`     Total events:       ${stats.eventsReceived}`);
    console.log(`     Deposits:           ${stats.depositsDetected}`);
    console.log(`     Withdrawals:        ${stats.withdrawalsDetected}`);
    console.log(`     Large movements:    ${stats.largeMovements}`);
    console.log(`     Internal transfers: ${stats.internalTransfers}`);
    console.log(`     Alerts recorded:    ${stats.alertsRecorded}`);
    console.log(`     Vesting events:     ${stats.vestingEvents}`);
    console.log(`     Governance events:  ${stats.governanceEvents}`);
    console.log(`     Liquidity events:   ${stats.liquidityEvents}`);
    console.log(`     Uptime:             ${stats.uptimeSeconds}s`);
    process.exit(0);
  });
}
