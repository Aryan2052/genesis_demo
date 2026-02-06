/**
 * Genesis — Rule Evaluator
 *
 * Takes decoded GenesisEvents and checks them against active rules.
 * Returns matched rules with severity for each event.
 *
 * Supports conditions on:
 *   - from / to (address match)
 *   - contract (address match)
 *   - amount_raw (gte, lte, gt, lt, eq — string BigInt comparisons)
 *   - event_type (exact match)
 *   - Custom field matches on event.args
 *
 * This is the core "filter before indexing deeply" logic.
 */

class RuleEvaluator {
  /**
   * @param {import('./rule-loader')} ruleLoader
   */
  constructor(ruleLoader) {
    this.ruleLoader = ruleLoader;
  }

  // ---------------------------------------------------------------------------
  // Main evaluation
  // ---------------------------------------------------------------------------

  /**
   * Evaluate an event against all active rules.
   * Returns an array of { rule, event } matches.
   *
   * @param {import('../pipeline/event-model').GenesisEvent} event
   * @returns {{ rule: object, event: object }[]}
   */
  evaluate(event) {
    const matches = [];

    for (const rule of this.ruleLoader.getAll()) {
      if (this._matchesRule(event, rule)) {
        matches.push({ rule, event });
      }
    }

    return matches;
  }

  /**
   * Evaluate a batch of events. Returns all matches.
   * @param {import('../pipeline/event-model').GenesisEvent[]} events
   * @returns {{ rule: object, event: object }[]}
   */
  evaluateBatch(events) {
    const allMatches = [];
    for (const event of events) {
      const matches = this.evaluate(event);
      allMatches.push(...matches);
    }
    return allMatches;
  }

  // ---------------------------------------------------------------------------
  // Matching logic
  // ---------------------------------------------------------------------------

  _matchesRule(event, rule) {
    // 1. Chain match
    if (rule.chain && event.chain !== rule.chain) return false;

    // 2. Event type match
    if (rule.event_type && event.eventType !== rule.event_type) return false;

    // 3. Contract match (selective indexing — the big cost saver)
    if (rule.contracts && rule.contracts.length > 0) {
      const eventContract = event.contract?.toLowerCase();
      const ruleContracts = rule.contracts.map((c) => c.toLowerCase());
      if (!ruleContracts.includes(eventContract)) return false;
    }

    // 4. Finality match — only alert if event meets minimum finality
    if (rule.finality) {
      if (!this._meetsFinalityRequirement(event.finality, rule.finality)) return false;
    }

    // 5. Conditions on event args
    if (rule.conditions && Object.keys(rule.conditions).length > 0) {
      if (!this._matchesConditions(event, rule.conditions)) return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Condition matching
  // ---------------------------------------------------------------------------

  _matchesConditions(event, conditions) {
    for (const [field, condition] of Object.entries(conditions)) {
      // Special fields
      if (field === "from") {
        if (!this._matchAddress(event.args.from, condition)) return false;
        continue;
      }
      if (field === "to") {
        if (!this._matchAddress(event.args.to, condition)) return false;
        continue;
      }
      if (field === "amount_raw") {
        // Compare as BigInt against event.args.value or event.args._rawValue
        const eventValue = event.args._rawValue || event.args.value;
        if (!eventValue) return false;
        if (!this._matchBigInt(eventValue, condition)) return false;
        continue;
      }

      // Generic field match on event.args
      const eventValue = event.args[field];
      if (eventValue === undefined) return false;

      if (typeof condition === "object") {
        if (!this._matchComparison(eventValue, condition)) return false;
      } else {
        // Exact match
        if (String(eventValue).toLowerCase() !== String(condition).toLowerCase()) return false;
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Comparison helpers
  // ---------------------------------------------------------------------------

  _matchAddress(eventAddr, ruleAddr) {
    if (!eventAddr) return false;
    if (typeof ruleAddr === "string") {
      return eventAddr.toLowerCase() === ruleAddr.toLowerCase();
    }
    if (Array.isArray(ruleAddr)) {
      return ruleAddr.some((a) => eventAddr.toLowerCase() === a.toLowerCase());
    }
    return false;
  }

  _matchBigInt(eventValue, condition) {
    try {
      const val = BigInt(eventValue);

      for (const [op, threshold] of Object.entries(condition)) {
        const thresholdBig = BigInt(threshold);

        switch (op) {
          case "gt":  if (!(val > thresholdBig)) return false; break;
          case "gte": if (!(val >= thresholdBig)) return false; break;
          case "lt":  if (!(val < thresholdBig)) return false; break;
          case "lte": if (!(val <= thresholdBig)) return false; break;
          case "eq":  if (!(val === thresholdBig)) return false; break;
          default:
            console.warn(`  ⚠️  [RuleEvaluator] Unknown operator: "${op}"`);
            return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  _matchComparison(eventValue, condition) {
    for (const [op, target] of Object.entries(condition)) {
      const a = Number(eventValue);
      const b = Number(target);
      if (isNaN(a) || isNaN(b)) return false;

      switch (op) {
        case "gt":  if (!(a > b)) return false; break;
        case "gte": if (!(a >= b)) return false; break;
        case "lt":  if (!(a < b)) return false; break;
        case "lte": if (!(a <= b)) return false; break;
        case "eq":  if (!(a === b)) return false; break;
        default: return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Finality comparison
  // ---------------------------------------------------------------------------

  _meetsFinalityRequirement(eventFinality, requiredFinality) {
    const FINALITY_ORDER = {
      pending: 0,
      soft_confirmed: 1,
      finalized: 2,
    };

    const eventLevel = FINALITY_ORDER[eventFinality] ?? -1;
    const requiredLevel = FINALITY_ORDER[requiredFinality] ?? 0;

    return eventLevel >= requiredLevel;
  }
}

module.exports = RuleEvaluator;
