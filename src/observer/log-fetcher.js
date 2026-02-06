/**
 * Genesis — Selective Log Fetcher
 *
 * Fetches logs from the chain using eth_getLogs with precise
 * topic + address filters derived from active watch targets.
 *
 * KEY IDEA (Selective Indexing):
 *   Only fetch logs for contracts and topics that active rules care about.
 *   Everything else is ignored at the RPC level — never even downloaded.
 *   This is the source of the 70-90% RPC cost reduction.
 *
 * Emits:
 *   "logs" — { blockNumber, logs: [...rawLogs] }
 */

const { ethers } = require("ethers");
const EventEmitter = require("events");

class LogFetcher extends EventEmitter {
  /**
   * @param {import('./rpc-pool')} rpcPool
   * @param {object} chainConfig
   */
  constructor(rpcPool, chainConfig) {
    super();
    this.rpcPool = rpcPool;
    this.chain = chainConfig;

    /**
     * Watch targets — the set of (address, topics) we care about.
     * Derived from active rules.
     *
     * @type {Map<string, { address: string, topics: string[][] }>}
     */
    this.watchTargets = new Map();
  }

  // ---------------------------------------------------------------------------
  // Watch target management (driven by Rule Engine in Phase 2)
  // ---------------------------------------------------------------------------

  /**
   * Add a contract + event signature to watch.
   * @param {string} id — unique ID (usually rule_id)
   * @param {string} address — contract address (or null for any)
   * @param {string[]} eventSignatures — human-readable event sigs
   */
  addTarget(id, address, eventSignatures) {
    // Compute topic0 hashes from event signatures
    // ethers.id computes keccak256 of the full canonical signature
    // For "Transfer(address,address,uint256)" → topic0
    const topic0s = eventSignatures.map((sig) => {
      // "event Transfer(address indexed from, address indexed to, uint256 value)"
      // Step 1: strip "event " keyword
      let s = sig.replace(/^event\s+/, "").trim();
      // "Transfer(address indexed from, address indexed to, uint256 value)"

      // Step 2: extract function name and params
      const parenIdx = s.indexOf("(");
      const name = s.slice(0, parenIdx);
      const paramStr = s.slice(parenIdx + 1, s.lastIndexOf(")"));

      // Step 3: parse each param, keep only the type
      const params = paramStr.split(",").map((p) => {
        const parts = p.trim().split(/\s+/);
        // parts could be: ["address", "indexed", "from"] or ["uint256", "value"] or ["address"]
        // The type is always the first part
        return parts[0];
      });

      // Step 4: build canonical signature with no spaces
      const canonical = `${name}(${params.join(",")})`;
      const topic0 = ethers.id(canonical);

      console.log(`    📎 [LogFetcher] topic0: ${sig} → ${canonical} → ${topic0.slice(0, 10)}...`);
      return topic0;
    });

    this.watchTargets.set(id, {
      address: address?.toLowerCase() || null,
      topic0s,
      eventSignatures,
    });

    console.log(
      `  🎯 [LogFetcher] Watching: ${address || "any"} for ${eventSignatures.length} event(s) [${id}]`
    );
  }

  /** Remove a watch target. */
  removeTarget(id) {
    this.watchTargets.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Fetch logs for a specific block range
  // ---------------------------------------------------------------------------

  /**
   * Fetch logs for the given block range, filtered by active watch targets.
   * @param {number} fromBlock
   * @param {number} toBlock
   * @returns {Promise<ethers.Log[]>}
   */
  async fetchLogs(fromBlock, toBlock) {
    if (this.watchTargets.size === 0) return [];

    // Build a single filter that covers all watch targets
    const filter = this._buildFilter(fromBlock, toBlock);
    if (!filter) return [];

    try {
      const logs = await this.rpcPool.callWithFailover(async (provider) => {
        return await provider.getLogs(filter);
      });

      if (logs.length > 0) {
        this.emit("logs", {
          chain: this.chain.slug,
          fromBlock,
          toBlock,
          count: logs.length,
          logs,
        });
      }

      return logs;
    } catch (err) {
      console.error(`  ⚠️  [LogFetcher] Failed to fetch logs ${fromBlock}→${toBlock}: ${err.message}`);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Filter construction
  // ---------------------------------------------------------------------------

  /**
   * Build an eth_getLogs filter from all active watch targets.
   *
   * Strategy:
   *   - If all targets watch the same address → use single address
   *   - If mixed → use address array (or null for "any")
   *   - topic[0] is always the union of all watched event signatures
   */
  _buildFilter(fromBlock, toBlock) {
    const addresses = new Set();
    const topic0Set = new Set();
    let hasWildcardAddress = false;

    for (const target of this.watchTargets.values()) {
      if (target.address) {
        addresses.add(target.address);
      } else {
        hasWildcardAddress = true;
      }
      for (const t of target.topic0s) {
        topic0Set.add(t);
      }
    }

    if (topic0Set.size === 0) return null;

    const filter = {
      fromBlock,
      toBlock,
      topics: [Array.from(topic0Set)],
    };

    // Address filter: skip if any target watches "any address"
    if (!hasWildcardAddress && addresses.size > 0) {
      filter.address = addresses.size === 1
        ? Array.from(addresses)[0]
        : Array.from(addresses);
    }

    return filter;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats() {
    return {
      chain: this.chain.slug,
      activeTargets: this.watchTargets.size,
      watchedAddresses: [...new Set(
        Array.from(this.watchTargets.values())
          .map((t) => t.address)
          .filter(Boolean)
      )],
    };
  }
}

module.exports = LogFetcher;
