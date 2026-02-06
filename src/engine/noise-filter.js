/**
 * Genesis — Noise Filter
 *
 * Anti-spam layer that sits between the Rule Evaluator and Notification Dispatcher.
 *
 * Techniques:
 *   1. Cooldowns — suppress duplicate alerts for the same rule within N seconds
 *   2. Dedup — skip events with the same ID (reorg replays)
 *   3. Severity threshold — only pass alerts above a minimum severity
 *
 * Future (Phase 5):
 *   4. Z-score anomaly detection
 *   5. ML-based noise classification
 */

class NoiseFilter {
  constructor() {
    /**
     * Cooldown tracker: rule_id → last alert timestamp
     * @type {Map<string, number>}
     */
    this.cooldowns = new Map();

    /**
     * Seen event IDs (dedup)
     * @type {Set<string>}
     */
    this.seenEvents = new Set();

    /** Maximum dedup set size before pruning */
    this.maxSeenSize = 50000;

    /** Minimum severity to pass through (configurable) */
    this.minSeverity = "low"; // "low" | "medium" | "high" | "critical"

    // Stats
    this.stats = {
      passed: 0,
      suppressed_cooldown: 0,
      suppressed_dedup: 0,
      suppressed_severity: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Main filter
  // ---------------------------------------------------------------------------

  /**
   * Check if an alert should pass through or be suppressed.
   *
   * @param {{ rule: object, event: object, type: string, severity: string }} alert
   * @returns {boolean} true = allow, false = suppress
   */
  shouldPass(alert) {
    const { rule, event, severity } = alert;

    // 1. Severity check
    if (!this._meetsSeverity(severity)) {
      this.stats.suppressed_severity++;
      return false;
    }

    // 2. Dedup check (by event ID)
    if (event?.id && this.seenEvents.has(`${rule.rule_id}::${event.id}`)) {
      this.stats.suppressed_dedup++;
      return false;
    }

    // 3. Cooldown check
    if (rule.cooldown_sec > 0) {
      const lastAlert = this.cooldowns.get(rule.rule_id) || 0;
      const elapsed = (Date.now() - lastAlert) / 1000;

      if (elapsed < rule.cooldown_sec) {
        this.stats.suppressed_cooldown++;
        return false;
      }
    }

    // --- Passed all checks ---
    this.stats.passed++;

    // Record cooldown
    this.cooldowns.set(rule.rule_id, Date.now());

    // Record dedup
    if (event?.id) {
      const dedupKey = `${rule.rule_id}::${event.id}`;
      this.seenEvents.add(dedupKey);

      // Prune if too large
      if (this.seenEvents.size > this.maxSeenSize) {
        const entries = Array.from(this.seenEvents);
        this.seenEvents = new Set(entries.slice(entries.length - this.maxSeenSize / 2));
      }
    }

    return true;
  }

  /**
   * Check if an aggregated alert should pass through.
   * Aggregated alerts use rule-level cooldowns only (no per-event dedup).
   *
   * @param {{ rule: object, summary: object, type: string, severity: string }} alert
   * @returns {boolean}
   */
  shouldPassAggregated(alert) {
    const { rule, severity } = alert;

    // Severity check
    if (!this._meetsSeverity(severity)) {
      this.stats.suppressed_severity++;
      return false;
    }

    // Cooldown check
    if (rule.cooldown_sec > 0) {
      const lastAlert = this.cooldowns.get(`agg::${rule.rule_id}`) || 0;
      const elapsed = (Date.now() - lastAlert) / 1000;

      if (elapsed < rule.cooldown_sec) {
        this.stats.suppressed_cooldown++;
        return false;
      }
    }

    this.stats.passed++;
    this.cooldowns.set(`agg::${rule.rule_id}`, Date.now());
    return true;
  }

  // ---------------------------------------------------------------------------
  // Severity comparison
  // ---------------------------------------------------------------------------

  _meetsSeverity(alertSeverity) {
    const SEVERITY_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };
    const alertLevel = SEVERITY_ORDER[alertSeverity] ?? 0;
    const minLevel = SEVERITY_ORDER[this.minSeverity] ?? 0;
    return alertLevel >= minLevel;
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  setMinSeverity(level) {
    this.minSeverity = level;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats() {
    const total = this.stats.passed +
      this.stats.suppressed_cooldown +
      this.stats.suppressed_dedup +
      this.stats.suppressed_severity;

    return {
      ...this.stats,
      total,
      suppressionRate: total > 0
        ? `${(((total - this.stats.passed) / total) * 100).toFixed(1)}%`
        : "0%",
    };
  }

  reset() {
    this.cooldowns.clear();
    this.seenEvents.clear();
    this.stats = {
      passed: 0,
      suppressed_cooldown: 0,
      suppressed_dedup: 0,
      suppressed_severity: 0,
    };
  }
}

module.exports = NoiseFilter;
