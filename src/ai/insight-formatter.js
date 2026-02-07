/**
 * Genesis — AI Insight Formatter (LangChain + Gemini)
 *
 * Takes raw blockchain event data (numbers, addresses, hashes) and produces
 * human-readable, insightful text that a normal person can understand.
 *
 * Architecture:
 *   Raw Event → LangChain + Gemini (if configured) → Formatted Insight
 *            → Local Formatter (fallback)           → Formatted Insight
 *
 * The formatter always works — LangChain AI enhances it when available.
 */

const GenesisLangChainAgent = require("./langchain-agent");

class InsightFormatter {
  constructor(config = {}) {
    // Initialize LangChain agent (uses GEMINI_API_KEY from .env)
    this.aiAgent = new GenesisLangChainAgent({
      geminiApiKey: config.geminiApiKey || process.env.GEMINI_API_KEY,
    });
    this.useAI = this.aiAgent.enabled;

    // ── AI Budget: limit Gemini calls to avoid rate limits ──
    // Only high-value events go to the LLM. Everything else uses local formatter.
    this._aiCallsUsed = 0;
    this._aiCallsMax = config.maxAICalls || 5; // max 5 AI calls per session
    this._aiWorthyTypes = new Set([
      "large_movement",    // whale deposits/withdrawals
      "emergency",         // vault pause/unpause
      "large_swap",        // big DEX trades
      "withdrawal",        // only large ones (checked by amount)
    ]);
    this._aiMinAmount = 100_000; // only AI-format events ≥ $100K
  }

  /**
   * Check if an event is important enough to spend an AI call on.
   */
  _shouldUseAI(event) {
    if (!this.useAI) return false;
    if (this._aiCallsUsed >= this._aiCallsMax) return false;

    // Emergency events ALWAYS get AI
    if (event.type === "emergency") return true;

    // Must be a high-value event type
    if (!this._aiWorthyTypes.has(event.type)) return false;

    // Check amount threshold
    const rawAmt = parseFloat(String(event.amount || "0").replace(/,/g, ""));
    return rawAmt >= this._aiMinAmount;
  }

  /**
   * Format a raw event into a human-readable insight.
   * Only high-value events go to Gemini AI. Everything else uses local formatter.
   * @param {object} event - Raw event from contract listener
   * @returns {Promise<object>} { title, summary, details, severity, recommendation }
   */
  async format(event) {
    if (this._shouldUseAI(event)) {
      try {
        const aiInsight = await this.aiAgent.analyze(event);
        if (aiInsight) {
          this._aiCallsUsed++;
          console.log(`  🧠 [AI Budget] ${this._aiCallsUsed}/${this._aiCallsMax} AI calls used`);
          return aiInsight;
        }
      } catch (err) {
        console.error(`  ⚠️  [LangChain] Failed, using local formatter: ${err.message}`);
      }
    }
    return this._formatLocally(event);
  }

  /**
   * Format using ONLY local formatter (no AI call). Use for regular events.
   */
  formatLocal(event) {
    return this._formatLocally(event);
  }

  /**
   * Get AI agent stats (includes budget info)
   */
  getAIStats() {
    return {
      ...this.aiAgent.getStats(),
      aiBudget: {
        used: this._aiCallsUsed,
        max: this._aiCallsMax,
        remaining: this._aiCallsMax - this._aiCallsUsed,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Local formatting (always available, no external dependency)
  // ══════════════════════════════════════════════════════════════════════

  _formatLocally(event) {
    switch (event.type) {
      case "deposit":
        return this._formatDeposit(event);
      case "withdrawal":
        return this._formatWithdrawal(event);
      case "internal_transfer":
        return this._formatInternalTransfer(event);
      case "large_movement":
        return this._formatLargeMovement(event);
      case "emergency":
        return this._formatEmergency(event);
      case "erc20_transfer":
        return this._formatERC20Transfer(event);
      case "user_threshold_triggered":
        return this._formatUserThreshold(event);
      case "vesting_schedule_created":
        return this._formatVestingSchedule(event);
      case "vesting_claim":
        return this._formatVestingClaim(event);
      case "vesting_revoked":
        return this._formatVestingRevoked(event);
      case "vesting_cliff_reached":
        return this._formatVestingCliff(event);
      case "vesting_milestone":
        return this._formatVestingMilestone(event);
      case "governance_proposal_created":
        return this._formatProposalCreated(event);
      case "governance_vote":
        return this._formatVoteCast(event);
      case "governance_proposal_executed":
        return this._formatProposalExecuted(event);
      case "governance_proposal_cancelled":
        return this._formatProposalCancelled(event);
      case "governance_state_change":
        return this._formatGovernanceStateChange(event);
      case "liquidity_added":
        return this._formatLiquidityAdded(event);
      case "liquidity_removed":
        return this._formatLiquidityRemoved(event);
      case "liquidity_swap":
        return this._formatSwap(event);
      case "large_swap":
        return this._formatLargeSwap(event);
      case "liquidity_rebalance":
        return this._formatPoolRebalance(event);
      default:
        return this._formatGeneric(event);
    }
  }

  _formatDeposit(event) {
    const isLarge = parseFloat(event.amount.replace(/,/g, "")) > 50000;
    return {
      title: isLarge ? "🐋 Large Deposit Detected" : "💰 New Deposit",
      summary: isLarge
        ? `A large deposit of $${event.amount} was made into the Genesis Vault. This could indicate institutional accumulation or a whale building a position.`
        : `A deposit of $${event.amount} was made into the Genesis Vault. This is routine vault activity within normal ranges.`,
      details: [
        `• Amount deposited: $${event.amount}`,
        `• New vault balance: $${event.newBalance}`,
        `• Wallet: ${this._shortAddr(event.user)}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: isLarge ? "high" : "low",
      recommendation: isLarge
        ? "Monitor this wallet for follow-up activity. Large deposits often precede significant market moves."
        : "No action needed. Normal vault deposit.",
      aiPowered: false,
    };
  }

  _formatWithdrawal(event) {
    const amount = parseFloat(event.amount.replace(/,/g, ""));
    const isLarge = amount > 50000;
    const severity = amount > 200000 ? "critical" : isLarge ? "high" : "low";

    return {
      title: isLarge ? "📤 Large Withdrawal Alert" : "📤 Withdrawal Processed",
      summary: isLarge
        ? `A significant withdrawal of $${event.amount} was processed from the Genesis Vault. This reduces the vault's total value and could signal profit-taking or a potential exit.`
        : `A withdrawal of $${event.amount} was processed. This is within normal operating ranges.`,
      details: [
        `• Amount withdrawn: $${event.amount}`,
        `• Remaining balance: $${event.remainingBalance}`,
        `• Wallet: ${this._shortAddr(event.user)}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity,
      recommendation: isLarge
        ? "Watch for sequential withdrawals from the same wallet. If this wallet makes multiple large withdrawals, it may indicate a complete exit."
        : "Routine withdrawal — no action required.",
      aiPowered: false,
    };
  }

  _formatInternalTransfer(event) {
    return {
      title: "🔄 Internal Vault Transfer",
      summary: `$${event.amount} was transferred between two vault users internally. No tokens left the vault — this is an internal accounting operation, similar to a Layer-2 transfer.`,
      details: [
        `• Amount: $${event.amount}`,
        `• From: ${this._shortAddr(event.from)}`,
        `• To: ${this._shortAddr(event.to)}`,
        `• Block: #${event.blockNumber}`,
        `• Note: No ERC20 transfer occurred — purely internal`,
      ].join("\n"),
      severity: "low",
      recommendation: "Internal transfers don't affect vault TVL. No action needed unless the amount is unusually large.",
      aiPowered: false,
    };
  }

  _formatLargeMovement(event) {
    const isDeposit = event.subType === "deposit";
    return {
      title: `🚨 WHALE ${event.subType.toUpperCase()} — $${event.amount}`,
      summary: isDeposit
        ? `A whale just deposited $${event.amount} into the vault, exceeding the $${event.threshold} threshold. This is a significant inbound flow that could indicate strong confidence in the protocol or preparation for a large-scale operation.`
        : `A whale just withdrew $${event.amount} from the vault, exceeding the $${event.threshold} threshold. This is a significant outbound flow that could signal profit-taking, portfolio rebalancing, or reduced confidence.`,
      details: [
        `• Movement type: ${event.subType.toUpperCase()}`,
        `• Amount: $${event.amount}`,
        `• Threshold exceeded: $${event.threshold}`,
        `• Wallet: ${this._shortAddr(event.user)}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "high",
      recommendation: isDeposit
        ? "Monitor the whale's next moves. Large deposits followed by quick withdrawals could indicate flash-loan activity."
        : "Check if other wallets are also withdrawing. Multiple large exits could trigger a cascade.",
      aiPowered: false,
    };
  }

  _formatEmergency(event) {
    const isPause = event.action === "paused";
    return {
      title: isPause
        ? "🛑 EMERGENCY: Vault Paused"
        : "✅ Vault Operations Resumed",
      summary: isPause
        ? `The Genesis Vault has been PAUSED by the admin. All deposits and withdrawals are temporarily frozen. This is an emergency circuit breaker, typically used when a security threat is detected.`
        : `The Genesis Vault has been UNPAUSED. Normal operations (deposits, withdrawals, transfers) have resumed.`,
      details: [
        `• Action: ${event.action}`,
        `• Triggered by: ${this._shortAddr(event.triggeredBy)}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: isPause ? "critical" : "medium",
      recommendation: isPause
        ? "DO NOT PANIC. Emergency pauses are a safety feature. Wait for an official announcement before taking action."
        : "Operations are back to normal. Review any pending transactions that may have been blocked during the pause.",
      aiPowered: false,
    };
  }

  _formatERC20Transfer(event) {
    const amount = parseFloat(event.amount.replace(/,/g, ""));
    const isLarge = amount > 100000;

    return {
      title: isLarge ? "💸 Large Token Transfer" : "💸 Token Transfer",
      summary: isLarge
        ? `A large transfer of $${event.amount} gUSD was detected. Transfers of this size typically involve exchanges, treasury operations, or whale-to-whale movements.`
        : `A transfer of $${event.amount} gUSD was detected between two wallets.`,
      details: [
        `• Amount: $${event.amount}`,
        `• From: ${this._shortAddr(event.from)}`,
        `• To: ${this._shortAddr(event.to)}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: isLarge ? "high" : "low",
      recommendation: isLarge
        ? "Track the destination wallet. If it's an exchange deposit address, the sender may be preparing to sell."
        : "Normal transfer — no action needed.",
      aiPowered: false,
    };
  }

  // ── Vesting formatters ─────────────────────────────────────────────────

  _formatVestingSchedule(event) {
    return {
      title: "📅 New Vesting Schedule Created",
      summary: `A vesting schedule of $${event.amount} was created for ${this._shortAddr(event.beneficiary)}. Tokens will unlock linearly over ${event.durationDays?.toFixed(0) || "?"} days with a ${event.cliffDays?.toFixed(0) || "?"}-day cliff.`,
      details: [
        `• Beneficiary: ${this._shortAddr(event.beneficiary)}`,
        `• Total amount: $${event.amount}`,
        `• Duration: ${event.durationDays?.toFixed(0)} days`,
        `• Cliff: ${event.cliffDays?.toFixed(0)} days`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "medium",
      recommendation: "Track this wallet's claim activity. Large vesting schedules often indicate team/investor allocations.",
      aiPowered: false,
    };
  }

  _formatVestingClaim(event) {
    const amount = parseFloat(event.amount.replace(/,/g, ""));
    const isLarge = amount > 50000;
    return {
      title: isLarge ? "🔓 Large Vesting Claim" : "🔓 Vesting Tokens Claimed",
      summary: `${this._shortAddr(event.beneficiary)} claimed $${event.amount} of vested tokens. ${isLarge ? "This is a significant unlock that could add sell pressure if tokens are moved to an exchange." : "Routine vesting claim within normal ranges."}`,
      details: [
        `• Beneficiary: ${this._shortAddr(event.beneficiary)}`,
        `• Amount claimed: $${event.amount}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: isLarge ? "high" : "low",
      recommendation: isLarge
        ? "Monitor if the beneficiary transfers claimed tokens to an exchange. Large vesting claims followed by exchange deposits often precede sell-offs."
        : "Normal vesting claim. No immediate action needed.",
      aiPowered: false,
    };
  }

  _formatVestingRevoked(event) {
    return {
      title: "❌ Vesting Schedule Revoked",
      summary: `A vesting schedule for ${this._shortAddr(event.beneficiary)} was revoked. $${event.amountReturned} in unvested tokens were returned to the protocol owner. This typically indicates a team departure or contract termination.`,
      details: [
        `• Beneficiary: ${this._shortAddr(event.beneficiary)}`,
        `• Tokens returned: $${event.amountReturned}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "high",
      recommendation: "A revoked vesting schedule may signal internal team changes. Watch for further revocations which could indicate organizational instability.",
      aiPowered: false,
    };
  }

  _formatVestingCliff(event) {
    return {
      title: "🏔️ Vesting Cliff Reached",
      summary: `${this._shortAddr(event.beneficiary)} has passed their vesting cliff. $${event.unlockedAmount} is now available to claim. The cliff period is the initial lock-up before any tokens become available.`,
      details: [
        `• Beneficiary: ${this._shortAddr(event.beneficiary)}`,
        `• Amount now claimable: $${event.unlockedAmount}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "medium",
      recommendation: "A cliff unlock creates the first opportunity to sell. Monitor for immediate claims followed by exchange transfers.",
      aiPowered: false,
    };
  }

  _formatVestingMilestone(event) {
    return {
      title: `🎯 Vesting Milestone: ${event.milestone}% Unlocked`,
      summary: `${this._shortAddr(event.beneficiary)} reached the ${event.milestone}% vesting milestone. $${event.amount} newly unlocked. Milestone unlocks are scheduled release points in the vesting timeline.`,
      details: [
        `• Beneficiary: ${this._shortAddr(event.beneficiary)}`,
        `• Milestone: ${event.milestone}%`,
        `• Amount unlocked: $${event.amount}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: event.milestone >= 75 ? "high" : "medium",
      recommendation: event.milestone >= 75
        ? "The majority of tokens are now unlocked. Watch for large sell-offs as the vesting schedule nears completion."
        : "Partial milestone unlock. Monitor for claims.",
      aiPowered: false,
    };
  }

  // ── Governance formatters ──────────────────────────────────────────────

  _formatProposalCreated(event) {
    return {
      title: "🏛️ New Governance Proposal",
      summary: `Proposal #${event.proposalId} was created by ${this._shortAddr(event.proposer)}: "${event.description}". Community voting is now open.`,
      details: [
        `• Proposal ID: #${event.proposalId}`,
        `• Proposer: ${this._shortAddr(event.proposer)}`,
        `• Description: ${event.description}`,
        `• Voting ends: ${new Date(event.votingEnd * 1000).toLocaleString()}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "medium",
      recommendation: "Review the proposal details and participate in voting. Governance proposals can significantly impact protocol parameters.",
      aiPowered: false,
    };
  }

  _formatVoteCast(event) {
    const voteType = event.support ? "FOR ✅" : "AGAINST ❌";
    return {
      title: `🗳️ Vote Cast on Proposal #${event.proposalId}`,
      summary: `${this._shortAddr(event.voter)} voted ${voteType} on Proposal #${event.proposalId} with weight $${event.weight}.`,
      details: [
        `• Proposal ID: #${event.proposalId}`,
        `• Voter: ${this._shortAddr(event.voter)}`,
        `• Vote: ${voteType}`,
        `• Voting weight: $${event.weight}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "low",
      recommendation: "Track the vote tally. Large voting weight from a single address could swing the outcome.",
      aiPowered: false,
    };
  }

  _formatProposalExecuted(event) {
    return {
      title: `⚡ Proposal #${event.proposalId} Executed`,
      summary: `Governance Proposal #${event.proposalId} has been executed by ${this._shortAddr(event.executor)}. The proposed changes are now in effect on-chain.`,
      details: [
        `• Proposal ID: #${event.proposalId}`,
        `• Executor: ${this._shortAddr(event.executor)}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "high",
      recommendation: "Verify that the executed changes match the original proposal. Executed governance actions directly modify protocol behavior.",
      aiPowered: false,
    };
  }

  _formatProposalCancelled(event) {
    return {
      title: `🚫 Proposal #${event.proposalId} Cancelled`,
      summary: `Governance Proposal #${event.proposalId} has been cancelled before execution. This could indicate the proposer withdrew it or it was blocked.`,
      details: [
        `• Proposal ID: #${event.proposalId}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "medium",
      recommendation: "Check if the proposal was cancelled due to controversy or security concerns.",
      aiPowered: false,
    };
  }

  _formatGovernanceStateChange(event) {
    return {
      title: `🔄 Proposal #${event.proposalId} → ${event.stateName}`,
      summary: `Governance Proposal #${event.proposalId} changed state to ${event.stateName}. ${event.stateName === "Succeeded" ? "The proposal passed and is ready for execution." : event.stateName === "Defeated" ? "The proposal did not receive enough support." : ""}`,
      details: [
        `• Proposal ID: #${event.proposalId}`,
        `• New state: ${event.stateName}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: event.stateName === "Succeeded" || event.stateName === "Defeated" ? "high" : "low",
      recommendation: event.stateName === "Succeeded"
        ? "The proposal passed! It can now be executed. Review the changes before execution."
        : "Track governance proposal lifecycle for protocol health monitoring.",
      aiPowered: false,
    };
  }

  // ── Liquidity Pool formatters ──────────────────────────────────────────

  _formatLiquidityAdded(event) {
    return {
      title: "💧 Liquidity Added to Pool",
      summary: `${this._shortAddr(event.provider)} added $${event.amountA} gUSD + $${event.amountB} gETH to the liquidity pool. This increases the pool's depth and reduces slippage for traders.`,
      details: [
        `• Provider: ${this._shortAddr(event.provider)}`,
        `• Amount A (gUSD): $${event.amountA}`,
        `• Amount B (gETH): $${event.amountB}`,
        `• Pool Reserves: $${event.reserveA} / $${event.reserveB}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "medium",
      recommendation: "Increased liquidity is generally positive. Monitor for sudden withdrawals (rug-pull pattern).",
      aiPowered: false,
    };
  }

  _formatLiquidityRemoved(event) {
    return {
      title: "🔻 Liquidity Removed from Pool",
      summary: `${this._shortAddr(event.provider)} removed $${event.amountA} gUSD + $${event.amountB} gETH from the liquidity pool. Large removals can increase slippage and indicate reduced confidence.`,
      details: [
        `• Provider: ${this._shortAddr(event.provider)}`,
        `• Amount A (gUSD): $${event.amountA}`,
        `• Amount B (gETH): $${event.amountB}`,
        `• Remaining Reserves: $${event.reserveA} / $${event.reserveB}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "high",
      recommendation: "Liquidity removal reduces pool depth. If multiple LPs withdraw simultaneously, this could be an early rug-pull signal. Monitor closely.",
      aiPowered: false,
    };
  }

  _formatSwap(event) {
    return {
      title: "🔁 Token Swap Executed",
      summary: `${this._shortAddr(event.trader)} swapped $${event.amountIn} for $${event.amountOut} (fee: $${event.fee}). This is normal trading activity in the pool.`,
      details: [
        `• Trader: ${this._shortAddr(event.trader)}`,
        `• Input: $${event.amountIn}`,
        `• Output: $${event.amountOut}`,
        `• Fee collected: $${event.fee}`,
        `• Pool Reserves: $${event.reserveA} / $${event.reserveB}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "low",
      recommendation: "Normal swap activity. Fees collected benefit LP holders.",
      aiPowered: false,
    };
  }

  _formatLargeSwap(event) {
    return {
      title: `🚨 Large Swap — ${event.priceImpactPercent}% Price Impact`,
      summary: `${this._shortAddr(event.trader)} executed a large swap ($${event.amountIn} → $${event.amountOut}) with ${event.priceImpactPercent}% price impact. This significantly moved the pool price and could indicate manipulation or a whale trade.`,
      details: [
        `• Trader: ${this._shortAddr(event.trader)}`,
        `• Amount In: $${event.amountIn}`,
        `• Amount Out: $${event.amountOut}`,
        `• Price Impact: ${event.priceImpactPercent}%`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: parseFloat(event.priceImpactPercent) > 10 ? "critical" : "high",
      recommendation: "Large swaps can be front-running or sandwich attacks. Check if there were related transactions in the same block. Monitor the trader's wallet for patterns.",
      aiPowered: false,
    };
  }

  _formatPoolRebalance(event) {
    return {
      title: "⚖️ Pool Rebalanced",
      summary: `The liquidity pool was rebalanced by ${this._shortAddr(event.triggeredBy)}. Reason: "${event.reason}". Reserves changed from $${event.oldReserveA}/$${event.oldReserveB} to $${event.newReserveA}/$${event.newReserveB}.`,
      details: [
        `• Triggered by: ${this._shortAddr(event.triggeredBy)}`,
        `• Reason: ${event.reason}`,
        `• Old reserves: $${event.oldReserveA} / $${event.oldReserveB}`,
        `• New reserves: $${event.newReserveA} / $${event.newReserveB}`,
        `• Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: "medium",
      recommendation: "Pool rebalancing is normal maintenance. Verify the reason is legitimate — unexpected rebalances could indicate admin manipulation.",
      aiPowered: false,
    };
  }

  _formatUserThreshold(event) {
    const alertTypeNames = { 0: "Large Transfer", 1: "Whale Movement", 2: "Rapid Flow", 3: "Custom" };
    const isWhale = event.severity === "critical";
    const subType = event.subType || "movement";

    return {
      title: isWhale
        ? `🐋 WHALE THRESHOLD BREACHED — $${event.amount}`
        : `🔔 Alert Threshold Triggered — $${event.amount}`,
      summary: `A ${subType} of $${event.amount} exceeded the on-chain threshold of $${event.thresholdAmount}. `
        + (event.thresholdSource === "global"
          ? `This is a protocol-wide rule: "${event.thresholdDescription}".`
          : `This is a user-defined rule set by ${this._shortAddr(event.thresholdOwner)}: "${event.thresholdDescription}".`),
      details: [
        `\u2022 Movement: $${event.amount} (${subType})`,
        `\u2022 Threshold: $${event.thresholdAmount}`,
        `\u2022 Rule: ${event.thresholdDescription}`,
        `\u2022 Source: ${event.thresholdSource === "global" ? "Protocol-wide" : "User-defined"}`,
        `\u2022 Wallet: ${this._shortAddr(event.user)}`,
        `\u2022 Block: #${event.blockNumber}`,
      ].join("\n"),
      severity: event.severity || "high",
      recommendation: isWhale
        ? "Whale activity detected. Track this wallet for follow-up movements and check if other whales are moving in the same direction."
        : "User-defined threshold breached. Review the transaction and check if the wallet shows unusual patterns.",
      aiPowered: false,
    };
  }

  _formatGeneric(event) {
    return {
      title: `📋 Blockchain Event: ${event.type}`,
      summary: `A ${event.type} event was detected on-chain at block #${event.blockNumber}.`,
      details: JSON.stringify(event, null, 2),
      severity: "low",
      recommendation: "Review event details if relevant to your monitoring rules.",
      aiPowered: false,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  _shortAddr(addr) {
    if (!addr) return "unknown";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  _getTitle(event) {
    const titles = {
      deposit: "💰 Deposit Detected",
      withdrawal: "📤 Withdrawal Detected",
      internal_transfer: "🔄 Internal Transfer",
      large_movement: "🚨 Large Movement",
      emergency: "🛑 Emergency Action",
      erc20_transfer: "💸 Token Transfer",
    };
    return titles[event.type] || "📋 Event Detected";
  }

  _getSeverity(event) {
    if (event.type === "emergency") return "critical";
    if (event.type === "large_movement") return "high";
    const amount = parseFloat((event.amount || "0").replace(/,/g, ""));
    if (amount > 200000) return "critical";
    if (amount > 50000) return "high";
    if (amount > 10000) return "medium";
    return "low";
  }

  /**
   * Format insight for Telegram message (clean HTML with emojis)
   */
  toTelegram(insight) {
    const severityIcon = {
      low: "🟢",
      medium: "🟡",
      high: "🟠",
      critical: "🔴",
    };

    const icon = severityIcon[insight.severity] || "⚪";
    const lines = [
      `<b>${insight.title}</b>`,
      ``,
      insight.summary,
    ];

    if (insight.details) {
      lines.push(``, insight.details);
    }

    lines.push(
      ``,
      `${icon} <b>Severity:</b> ${(insight.severity || "medium").toUpperCase()}`,
      ``,
      `💡 ${insight.recommendation}`,
      ``,
      insight.aiPowered
        ? `🧠 <i>Genesis AI (LangChain + Gemini)</i>`
        : `📊 <i>Genesis Local Analysis</i>`,
    );

    return lines.join("\n");
  }

  /**
   * Format insight as JSON for API/dashboard
   */
  toJSON(insight) {
    return {
      ...insight,
      formattedAt: new Date().toISOString(),
    };
  }
}

module.exports = InsightFormatter;
