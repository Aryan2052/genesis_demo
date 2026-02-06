/**
 * Genesis — Console Notifier
 *
 * Pretty-prints decoded GenesisEvents to the terminal.
 * This is the Phase 1 output channel — Webhook/Telegram come in Phase 4.
 */

const { ethers } = require("ethers");

// ANSI color helpers
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
};

// Finality → display
const FINALITY_BADGE = {
  pending: `${c.yellow}⏳ PENDING${c.reset}`,
  soft_confirmed: `${c.blue}🔵 SOFT${c.reset}`,
  finalized: `${c.green}✅ FINAL${c.reset}`,
  reverted: `${c.red}❌ REVERTED${c.reset}`,
};

class ConsoleNotifier {
  constructor() {
    this.eventCount = 0;
  }

  /**
   * Print a decoded event.
   * @param {import('../pipeline/event-model').GenesisEvent} event
   */
  notify(event) {
    this.eventCount++;

    const badge = FINALITY_BADGE[event.finality] || event.finality;
    const header = `${c.bold}${c.cyan}🚨 #${this.eventCount} ${event.eventType}${c.reset}  ${badge}`;

    console.log(`\n  ${header}`);
    console.log(`  ${c.dim}${"─".repeat(56)}${c.reset}`);

    // Event-specific formatting
    switch (event.eventType) {
      case "ERC20_TRANSFER":
        this._printErc20Transfer(event);
        break;
      case "ERC721_TRANSFER":
        this._printErc721Transfer(event);
        break;
      default:
        this._printGeneric(event);
    }

    // Common footer
    console.log(`  ${c.dim}Chain:    ${event.chain} │ Block: ${event.blockNumber} │ Confirms: ${event.confirmations}${c.reset}`);
    console.log(`  ${c.dim}Contract: ${event.contract}${c.reset}`);
    if (event.explorerUrl) {
      console.log(`  ${c.dim}Explorer: ${event.explorerUrl}${c.reset}`);
    }
    console.log(`  ${c.dim}ID:       ${_shortId(event.id)}${c.reset}`);
    console.log(`  ${c.dim}${"─".repeat(56)}${c.reset}`);
  }

  // ---------------------------------------------------------------------------
  // Event-specific formatters
  // ---------------------------------------------------------------------------

  _printErc20Transfer(event) {
    const { from, to, value, _rawValue } = event.args;

    // Try to format as human-readable (assume 6 decimals for stablecoins, 18 for others)
    let displayAmount = value || _rawValue || "?";
    try {
      // If it's a known stablecoin-sized value, format with 6 decimals
      const raw = BigInt(_rawValue || value);
      // Heuristic: if raw < 10^12, likely 6 decimals; otherwise 18
      if (raw < 10n ** 12n) {
        displayAmount = ethers.formatUnits(raw, 6);
      } else {
        displayAmount = ethers.formatUnits(raw, 18);
      }
    } catch {
      // keep as-is
    }

    console.log(`  ${c.magenta}📤 From:   ${from}${c.reset}`);
    console.log(`  ${c.green}📥 To:     ${to}${c.reset}`);
    console.log(`  ${c.bold}💰 Amount: ${displayAmount}${c.reset}`);
  }

  _printErc721Transfer(event) {
    const { from, to, tokenId } = event.args;
    console.log(`  ${c.magenta}📤 From:    ${from}${c.reset}`);
    console.log(`  ${c.green}📥 To:      ${to}${c.reset}`);
    console.log(`  ${c.bold}🎨 TokenID: #${tokenId}${c.reset}`);
  }

  _printGeneric(event) {
    console.log(`  ${c.white}Event:  ${event.eventName}${c.reset}`);
    for (const [key, val] of Object.entries(event.args)) {
      if (key.startsWith("_")) continue;
      console.log(`  ${c.dim}${key}: ${val}${c.reset}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Finality upgrade / revert notifications
  // ---------------------------------------------------------------------------

  notifyFinalityUpgrade({ event, from, to }) {
    const badge = FINALITY_BADGE[to] || to;
    console.log(
      `  ${c.blue}🔔 Finality upgrade: ${event.eventType} block ${event.blockNumber} │ ${from} → ${to}  ${badge}${c.reset}`
    );
  }

  notifyRevert({ event }) {
    console.log(
      `  ${c.bgRed}${c.white}${c.bold} ⚠️  REVERTED: ${event.eventType} block ${event.blockNumber} │ ${_shortId(event.id)} ${c.reset}`
    );
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  printStats(stats) {
    console.log(`\n  📊 ${c.bold}Stats${c.reset}`);
    console.log(`  ${c.dim}${"─".repeat(40)}${c.reset}`);
    for (const [key, val] of Object.entries(stats)) {
      console.log(`  ${key}: ${JSON.stringify(val)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Rule-aware alert formatting
  // ---------------------------------------------------------------------------

  /**
   * Print an instant alert (single event matched a rule).
   */
  notifyAlert({ rule, event, severity }) {
    this.eventCount++;
    const badge = FINALITY_BADGE[event.finality] || event.finality;
    const sevColor = severity === "critical" || severity === "high" ? c.red : severity === "medium" ? c.yellow : c.dim;

    console.log(`\n  ${c.bold}${c.cyan}🚨 #${this.eventCount} ALERT${c.reset}  ${badge}  ${sevColor}[${(severity || "?").toUpperCase()}]${c.reset}`);
    console.log(`  ${c.dim}${"─".repeat(56)}${c.reset}`);
    console.log(`  ${c.white}Rule:     ${rule.name || rule.rule_id}${c.reset}`);

    // Event-specific formatting
    switch (event.eventType) {
      case "ERC20_TRANSFER":
        this._printErc20Transfer(event);
        break;
      case "ERC721_TRANSFER":
        this._printErc721Transfer(event);
        break;
      default:
        this._printGeneric(event);
    }

    console.log(`  ${c.dim}Chain:    ${event.chain} │ Block: ${event.blockNumber} │ Confirms: ${event.confirmations}${c.reset}`);
    console.log(`  ${c.dim}Contract: ${event.contract}${c.reset}`);
    if (event.explorerUrl) {
      console.log(`  ${c.dim}Explorer: ${event.explorerUrl}${c.reset}`);
    }
    console.log(`  ${c.dim}${"─".repeat(56)}${c.reset}`);
  }

  /**
   * Print an aggregated alert (summary of multiple events over a time window).
   */
  notifyAggregated({ rule, summary, events, severity }) {
    this.eventCount++;
    const sevColor = severity === "critical" || severity === "high" ? c.red : severity === "medium" ? c.yellow : c.dim;

    console.log(`\n  ${c.bold}${c.magenta}📊 #${this.eventCount} AGGREGATED ALERT${c.reset}  ${sevColor}[${(severity || "?").toUpperCase()}]${c.reset}`);
    console.log(`  ${c.dim}${"─".repeat(56)}${c.reset}`);
    console.log(`  ${c.white}Rule:      ${rule.name || rule.rule_id}${c.reset}`);
    console.log(`  ${c.bold}📦 Events:  ${summary.event_count} events in ${summary.duration_sec}s${c.reset}`);
    console.log(`  ${c.dim}Blocks:    ${summary.first_block} → ${summary.last_block}${c.reset}`);

    if (summary.total_amount_display) {
      console.log(`  ${c.bold}${c.green}💰 Total:   ${summary.total_amount_display}${c.reset}`);
    }
    if (summary.total_count) {
      console.log(`  ${c.bold}📈 Count:   ${summary.total_count} transfers${c.reset}`);
    }

    console.log(`  ${c.dim}Senders:   ${summary.unique_senders} unique │ Receivers: ${summary.unique_receivers} unique${c.reset}`);
    console.log(`  ${c.dim}Group:     ${summary.group_key}${c.reset}`);
    console.log(`  ${c.dim}${"─".repeat(56)}${c.reset}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _shortId(id) {
  // "1:0xabc...def:0x123...456:3" → "1:0xabc…def:0x123…456:3"
  return id.replace(/0x([a-f0-9]{8})[a-f0-9]+([a-f0-9]{4})/gi, "0x$1…$2");
}

module.exports = ConsoleNotifier;
