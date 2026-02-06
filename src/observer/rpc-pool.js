/**
 * Genesis — RPC Pool
 *
 * Manages multiple RPC providers for a single chain.
 * Features:
 *   - Round-robin with automatic failover
 *   - Health checks (marks dead providers, retries periodically)
 *   - Latency tracking
 *
 * Usage:
 *   const pool = new RpcPool(chainConfig);
 *   const provider = pool.getProvider();   // best healthy provider
 *   const provider = pool.getAll();        // all healthy providers
 */

const { ethers } = require("ethers");
const EventEmitter = require("events");

class RpcPool extends EventEmitter {
  /**
   * @param {object} chainConfig — a chain entry from config.getChain()
   */
  constructor(chainConfig) {
    super();
    this.chain = chainConfig;
    this.providers = [];
    this._index = 0;

    this._initProviders();
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------
  _initProviders() {
    for (const url of this.chain.rpcEndpoints) {
      // Skip empty URLs (missing API keys)
      if (!url || url.length < 10) continue;

      const provider = new ethers.JsonRpcProvider(url, undefined, {
        staticNetwork: ethers.Network.from(this.chain.chainId),
        batchMaxCount: 1,             // disable batching for low latency
      });

      this.providers.push({
        url,
        provider,
        healthy: true,
        latencyMs: 0,
        lastCheck: 0,
        errors: 0,
      });
    }

    if (this.providers.length === 0) {
      throw new Error(
        `[RpcPool] No valid RPC endpoints for chain "${this.chain.slug}". Check your .env file.`
      );
    }

    console.log(
      `  ⛓️  RPC Pool [${this.chain.name}]: ${this.providers.length} provider(s) loaded`
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns the best healthy provider (round-robin among healthy ones). */
  getProvider() {
    const healthy = this.providers.filter((p) => p.healthy);
    if (healthy.length === 0) {
      // All dead — force-reset and try the first one (silent — auto-recovery is expected)
      this.providers.forEach((p) => (p.healthy = true));
      return this.providers[0].provider;
    }
    const entry = healthy[this._index % healthy.length];
    this._index++;
    return entry.provider;
  }

  /** Returns all healthy provider entries. */
  getHealthy() {
    return this.providers.filter((p) => p.healthy);
  }

  /** Mark a provider as failed — will be skipped until health check passes. */
  markFailed(provider, error) {
    const entry = this.providers.find((p) => p.provider === provider);
    if (entry) {
      entry.healthy = false;
      entry.errors++;
      entry.lastCheck = Date.now();

      // Only log non-transient errors verbosely; transient ones (ECONNRESET, ETIMEDOUT) are expected on free RPCs
      const msg = error?.message || String(error);
      const isTransient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|rate|limit|429|503/i.test(msg);

      if (isTransient) {
        // Quiet one-liner for expected drops
        const healthy = this.providers.filter((p) => p.healthy).length;
        if (healthy > 0) {
          // Another provider will handle it — no need to alarm the user
        } else {
          console.warn(`  ⚠️  [RPC] All providers temporarily down — auto-retrying...`);
        }
      } else {
        // Unexpected error — log in full
        console.warn(`  ❌ [RpcPool] Provider failed (${_shortUrl(entry.url)}): ${msg}`);
      }

      this.emit("provider:failed", { url: entry.url, chain: this.chain.slug, error });
    }
  }

  /** Run a health check on all providers. Re-enables recovered ones. */
  async healthCheck() {
    const results = await Promise.allSettled(
      this.providers.map(async (entry) => {
        const start = Date.now();
        try {
          await entry.provider.getBlockNumber();
          entry.healthy = true;
          entry.latencyMs = Date.now() - start;
          entry.lastCheck = Date.now();
        } catch (err) {
          entry.healthy = false;
          entry.latencyMs = -1;
          entry.lastCheck = Date.now();
          entry.errors++;
        }
        return entry;
      })
    );

    const healthy = this.providers.filter((p) => p.healthy).length;
    console.log(
      `  🏥 [RpcPool] Health check [${this.chain.slug}]: ${healthy}/${this.providers.length} healthy`
    );
    this.emit("healthcheck", {
      chain: this.chain.slug,
      healthy,
      total: this.providers.length,
    });
  }

  /** Execute a call with automatic failover across providers. */
  async callWithFailover(fn) {
    const tried = new Set();
    while (tried.size < this.providers.length) {
      const provider = this.getProvider();
      if (tried.has(provider)) continue;
      tried.add(provider);
      try {
        return await fn(provider);
      } catch (err) {
        this.markFailed(provider, err);
      }
    }
    throw new Error(`[RpcPool] All ${this.providers.length} providers failed for ${this.chain.slug}`);
  }

  /** Clean shutdown. */
  destroy() {
    for (const entry of this.providers) {
      entry.provider.destroy();
    }
    this.providers = [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}`;
  } catch {
    return url.slice(0, 30);
  }
}

module.exports = RpcPool;
