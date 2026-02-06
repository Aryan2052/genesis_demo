/**
 * Genesis — Rule Loader
 *
 * Reads JSON rule files from the rules/ directory.
 * Validates them against the expected schema.
 * Supports hot-reload: watches the directory for changes.
 *
 * Emits:
 *   "rules:loaded"  — { count, rules }
 *   "rules:changed" — { added, removed, updated }
 */

const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

const RULES_DIR = path.resolve(__dirname, "../../rules");

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ["rule_id", "event_type"];
const VALID_SEVERITIES = ["low", "medium", "high", "critical"];
const VALID_FINALITIES = ["pending", "soft_confirmed", "finalized"];

function validateRule(rule, filename) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (!rule[field]) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  if (rule.severity && !VALID_SEVERITIES.includes(rule.severity)) {
    errors.push(`Invalid severity: "${rule.severity}". Must be one of: ${VALID_SEVERITIES.join(", ")}`);
  }

  if (rule.finality && !VALID_FINALITIES.includes(rule.finality)) {
    errors.push(`Invalid finality: "${rule.finality}". Must be one of: ${VALID_FINALITIES.join(", ")}`);
  }

  if (rule.cooldown_sec != null && (typeof rule.cooldown_sec !== "number" || rule.cooldown_sec < 0)) {
    errors.push(`Invalid cooldown_sec: must be a non-negative number`);
  }

  if (rule.aggregation?.window_sec != null && rule.aggregation.window_sec < 1) {
    errors.push(`Invalid aggregation.window_sec: must be >= 1`);
  }

  if (errors.length > 0) {
    console.warn(`  ⚠️  [RuleLoader] Invalid rule in ${filename}:`);
    errors.forEach((e) => console.warn(`     - ${e}`));
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Rule Loader
// ---------------------------------------------------------------------------

class RuleLoader extends EventEmitter {
  constructor() {
    super();

    /** @type {Map<string, object>} rule_id → rule */
    this.rules = new Map();
    this._watcher = null;
  }

  // ---------------------------------------------------------------------------
  // Load all rules from disk
  // ---------------------------------------------------------------------------

  load() {
    if (!fs.existsSync(RULES_DIR)) {
      console.warn(`  ⚠️  [RuleLoader] Rules directory not found: ${RULES_DIR}`);
      console.warn(`     Creating it now...`);
      fs.mkdirSync(RULES_DIR, { recursive: true });
      return;
    }

    const files = fs.readdirSync(RULES_DIR).filter((f) => f.endsWith(".json"));
    const loaded = [];

    for (const file of files) {
      try {
        const filePath = path.join(RULES_DIR, file);
        const raw = fs.readFileSync(filePath, "utf-8");
        const rule = JSON.parse(raw);

        if (!validateRule(rule, file)) continue;

        // Skip disabled rules
        if (rule.enabled === false) {
          console.log(`  ⏸️  [RuleLoader] Skipped (disabled): ${rule.rule_id}`);
          continue;
        }

        this.rules.set(rule.rule_id, rule);
        loaded.push(rule.rule_id);
      } catch (err) {
        console.warn(`  ⚠️  [RuleLoader] Failed to parse ${file}: ${err.message}`);
      }
    }

    console.log(`  📋 [RuleLoader] Loaded ${loaded.length} rule(s): ${loaded.join(", ")}`);
    this.emit("rules:loaded", { count: loaded.length, rules: Array.from(this.rules.values()) });
  }

  // ---------------------------------------------------------------------------
  // Hot-reload: watch for file changes
  // ---------------------------------------------------------------------------

  watch() {
    if (!fs.existsSync(RULES_DIR)) return;

    try {
      this._watcher = fs.watch(RULES_DIR, { persistent: false }, (eventType, filename) => {
        if (!filename?.endsWith(".json")) return;

        console.log(`  🔄 [RuleLoader] Rules changed — reloading...`);
        const oldIds = new Set(this.rules.keys());
        this.rules.clear();
        this.load();
        const newIds = new Set(this.rules.keys());

        const added = [...newIds].filter((id) => !oldIds.has(id));
        const removed = [...oldIds].filter((id) => !newIds.has(id));

        this.emit("rules:changed", { added, removed });
      });
    } catch {
      // fs.watch not available on all platforms — graceful degradation
    }
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /** Get all active rules. */
  getAll() {
    return Array.from(this.rules.values());
  }

  /** Get rules that match a specific chain. */
  getForChain(chainSlug) {
    return this.getAll().filter(
      (r) => !r.chain || r.chain === chainSlug
    );
  }

  /** Get a single rule by ID. */
  get(ruleId) {
    return this.rules.get(ruleId) || null;
  }

  /** Extract unique contracts that rules care about (for selective indexing). */
  getWatchedContracts() {
    const contracts = new Set();
    for (const rule of this.rules.values()) {
      if (rule.contracts) {
        for (const addr of rule.contracts) {
          contracts.add(addr.toLowerCase());
        }
      }
    }
    return Array.from(contracts);
  }

  /** Extract unique event types that rules care about. */
  getWatchedEventTypes() {
    const types = new Set();
    for (const rule of this.rules.values()) {
      if (rule.event_type) types.add(rule.event_type);
    }
    return Array.from(types);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  stop() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }
}

module.exports = RuleLoader;
