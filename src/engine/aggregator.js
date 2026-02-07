/**
 * Genesis — Event Aggregator
 *
 * Instead of sending 10,000 raw "Transfer" alerts, this groups events
 * into meaningful summaries:
 *
 *   "Wallet 0xABC sent $1.3M USDC across 14 txs in 5 minutes"
 *
 * How it works:
 *   - Each rule can define an aggregation window + group_by fields
 *   - Matched events are bucketed by (rule_id, group_key)
 *   - When the window expires, a single aggregated alert is emitted
 *   - Individual events can also be passed through immediately (for high-severity rules)
 *
 * Emits:
 *   "alert"           — { rule, event, type: "instant" }
 *   "alert:aggregated" — { rule, summary, events, type: "aggregated" }
 */

const EventEmitter = require("events");

class Aggregator extends EventEmitter {
  constructor() {
    super();

    /**
     * Active aggregation windows.
     * Key: `${rule_id}::${group_key}`
     * Value: { rule, events[], timer, startTime }
     * @type {Map<string, object>}
     */
    this.windows = new Map();
  }

  // ---------------------------------------------------------------------------
  // Main entry: process a rule match
  // ---------------------------------------------------------------------------

  /**
   * Process a matched (rule, event) pair.
   * Either aggregates it or emits immediately based on rule config.
   *
   * @param {{ rule: object, event: object }} match
   */
  process(match) {
    const { rule, event } = match;
    const agg = rule.aggregation;

    // No aggregation configured — emit immediately
    if (!agg || !agg.enabled) {
      this.emit("alert", {
        rule,
        event,
        type: "instant",
        severity: rule.severity || "medium",
      });
      return;
    }

    // Build the group key from the event
    const groupKey = this._buildGroupKey(event, agg.group_by || []);
    const windowKey = `${rule.rule_id}::${groupKey}`;

    // Get or create the aggregation window
    if (!this.windows.has(windowKey)) {
      const window = {
        rule,
        groupKey,
        events: [],
        startTime: Date.now(),
        timer: null,
      };

      // Set timer to flush the window
      window.timer = setTimeout(() => {
        this._flushWindow(windowKey);
      }, (agg.window_sec || 60) * 1000);

      this.windows.set(windowKey, window);
    }

    const window = this.windows.get(windowKey);
    window.events.push(event);

    // Also emit for critical/high severity — don't wait for aggregation
    if (rule.severity === "critical" || rule.severity === "high") {
      this.emit("alert", {
        rule,
        event,
        type: "instant",
        severity: rule.severity,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Window management
  // ---------------------------------------------------------------------------

  _flushWindow(windowKey) {
    const window = this.windows.get(windowKey);
    if (!window) return;

    // Clear timer
    if (window.timer) {
      clearTimeout(window.timer);
    }

    // Build summary
    const summary = this._buildSummary(window);

    if (window.events.length > 0) {
      this.emit("alert:aggregated", {
        rule: window.rule,
        summary,
        events: window.events,
        type: "aggregated",
        severity: window.rule.severity || "medium",
      });
    }

    // Remove the window
    this.windows.delete(windowKey);
  }

  // ---------------------------------------------------------------------------
  // Summary building
  // ---------------------------------------------------------------------------

  _buildSummary(window) {
    const { rule, events, groupKey, startTime } = window;
    const aggConfig = rule.aggregation || {};
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(0);

    const summary = {
      rule_id: rule.rule_id,
      rule_name: rule.name || rule.rule_id,
      group_key: groupKey,
      event_count: events.length,
      duration_sec: Number(durationSec),
      first_block: events[0]?.blockNumber,
      last_block: events[events.length - 1]?.blockNumber,
    };

    // Compute aggregate metric based on summary type
    if (aggConfig.summary === "total_amount") {
      const total = events.reduce((sum, evt) => {
        const raw = evt.args._rawValue || evt.args.value || "0";
        try {
          return sum + BigInt(raw);
        } catch {
          return sum;
        }
      }, 0n);
      summary.total_amount_raw = total.toString();
      // Try human-readable (assume 6 decimals for stablecoins)
      summary.total_amount_display = _formatAmount(total);
    }

    if (aggConfig.summary === "count") {
      summary.total_count = events.length;
    }

    // Unique addresses involved
    const froms = new Set(events.map((e) => e.args.from).filter(Boolean));
    const tos = new Set(events.map((e) => e.args.to).filter(Boolean));
    summary.unique_senders = froms.size;
    summary.unique_receivers = tos.size;

    return summary;
  }

  // ---------------------------------------------------------------------------
  // Group key construction
  // ---------------------------------------------------------------------------

  _buildGroupKey(event, groupByFields) {
    if (!groupByFields || groupByFields.length === 0) return "all";

    return groupByFields
      .map((field) => {
        if (field === "contract") return event.contract || "any";
        if (field === "chain") return event.chain || "any";
        return event.args[field] || "any";
      })
      .join("|");
  }

  // ---------------------------------------------------------------------------
  // Stats & cleanup
  // ---------------------------------------------------------------------------

  getStats() {
    return {
      activeWindows: this.windows.size,
      windows: Array.from(this.windows.entries()).map(([key, w]) => ({
        key,
        eventCount: w.events.length,
        ageSec: ((Date.now() - w.startTime) / 1000).toFixed(0),
      })),
    };
  }

  /** Force-flush all open windows (for shutdown). */
  flushAll() {
    for (const key of Array.from(this.windows.keys())) {
      this._flushWindow(key);
    }
  }

  destroy() {
    for (const window of this.windows.values()) {
      if (window.timer) clearTimeout(window.timer);
    }
    this.windows.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _formatAmount(rawBigInt) {
  try {
    // Heuristic: if raw < 10^12, assume 6 decimals (stablecoins); else 18
    if (rawBigInt < 10n ** 12n) {
      const whole = rawBigInt / 1000000n;
      const frac = rawBigInt % 1000000n;
      return `$${whole.toLocaleString?.("en-US") || whole}.${frac.toString().padStart(6, "0").slice(0, 2)}`;
    } else {
      const whole = rawBigInt / (10n ** 18n);
      return `${whole.toLocaleString?.("en-US") || whole} tokens`;
    }
  } catch {
    return rawBigInt.toString();
  }
}

module.exports = Aggregator;
