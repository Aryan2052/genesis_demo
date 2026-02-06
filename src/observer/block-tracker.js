/**
 * Genesis — Block Tracker
 *
 * Follows the chain head and detects reorganizations.
 *
 * Emits:
 *   "block"  — { blockNumber, blockHash, parentHash, timestamp }
 *   "reorg"  — { fromBlock, toBlock, oldHash, newHash, depth }
 *
 * Design:
 *   - Polls via RPC pool (not WebSockets — more resilient)
 *   - Keeps a short sliding window of recent block hashes
 *   - Detects reorgs by comparing parentHash linkage
 */

const EventEmitter = require("events");

const WINDOW_SIZE = 64; // keep last N block hashes for reorg detection

class BlockTracker extends EventEmitter {
  /**
   * @param {import('./rpc-pool')} rpcPool
   * @param {object} chainConfig — chain entry from config.getChain()
   */
  constructor(rpcPool, chainConfig) {
    super();
    this.rpcPool = rpcPool;
    this.chain = chainConfig;
    this.pollIntervalMs = chainConfig.blockTimeSec * 1000 * 0.8; // slightly faster than block time
    this.minPollMs = 1000; // never faster than 1s
    this.pollIntervalMs = Math.max(this.pollIntervalMs, this.minPollMs);

    /** @type {Map<number, {hash: string, parentHash: string}>} */
    this.blockWindow = new Map();
    this.latestBlock = 0;
    this._timer = null;
    this._running = false;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start() {
    if (this._running) return;
    this._running = true;

    console.log(
      `  📡 Block Tracker [${this.chain.slug}]: polling every ${(this.pollIntervalMs / 1000).toFixed(1)}s`
    );

    // Initial fetch
    await this._poll();

    // Start polling loop
    this._timer = setInterval(() => this._poll(), this.pollIntervalMs);
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log(`  🛑 Block Tracker [${this.chain.slug}]: stopped`);
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  async _poll() {
    try {
      const block = await this.rpcPool.callWithFailover(async (provider) => {
        return await provider.getBlock("latest");
      });

      if (!block) {
        console.warn(`  ⚠️  [BlockTracker] getBlock("latest") returned null`);
        return;
      }

      // First poll — just record the starting block
      if (this.latestBlock === 0) {
        console.log(`  📍 [BlockTracker] Starting at block ${block.number}`);
        this._processBlockData(block);
        return;
      }

      if (block.number <= this.latestBlock) return; // no new block

      // Log new blocks
      console.log(`  📦 New block: #${block.number}`);
      const skipped = block.number - this.latestBlock - 1;
      if (skipped > 0) {
        console.log(`  ⏩ [BlockTracker] Catching up: ${skipped} skipped block(s)`);
      }

      // Process every block between latestBlock+1 and block.number
      // (handles cases where we skipped blocks due to slow polling)
      if (block.number > this.latestBlock + 1) {
        // Fetch missed blocks
        for (let n = this.latestBlock + 1; n < block.number; n++) {
          await this._processBlock(n);
        }
      }

      await this._processBlockData(block);
    } catch (err) {
      console.error(`  ⚠️  [BlockTracker] Poll error: ${err.message}`);
    }
  }

  async _processBlock(blockNumber) {
    try {
      const block = await this.rpcPool.callWithFailover(async (provider) => {
        return await provider.getBlock(blockNumber);
      });
      if (block) {
        this._processBlockData(block);
      }
    } catch (err) {
      console.error(`  ⚠️  [BlockTracker] Failed to fetch block ${blockNumber}: ${err.message}`);
    }
  }

  _processBlockData(block) {
    const { number, hash, parentHash, timestamp } = block;

    // --- Reorg detection ---
    if (this.blockWindow.has(number)) {
      const existing = this.blockWindow.get(number);
      if (existing.hash !== hash) {
        // REORG DETECTED — same height, different hash
        const depth = this._calculateReorgDepth(number);
        const reorgEvent = {
          chain: this.chain.slug,
          fromBlock: number - depth,
          toBlock: number,
          oldHash: existing.hash,
          newHash: hash,
          depth,
        };
        console.warn(`  🔄 REORG DETECTED [${this.chain.slug}]: depth=${depth}, blocks ${reorgEvent.fromBlock}→${number}`);
        this.emit("reorg", reorgEvent);

        // Clear invalidated blocks from window
        for (let i = number - depth; i <= number; i++) {
          this.blockWindow.delete(i);
        }
      }
    }

    // Check parentHash linkage
    if (this.blockWindow.has(number - 1)) {
      const parent = this.blockWindow.get(number - 1);
      if (parent.hash !== parentHash) {
        // Parent mismatch — subtle reorg
        console.warn(`  🔄 Parent mismatch at block ${number} [${this.chain.slug}]`);
        this.emit("reorg", {
          chain: this.chain.slug,
          fromBlock: number - 1,
          toBlock: number,
          oldHash: parent.hash,
          newHash: parentHash,
          depth: 1,
        });
      }
    }

    // Store in window
    this.blockWindow.set(number, { hash, parentHash });

    // Trim window
    if (this.blockWindow.size > WINDOW_SIZE) {
      const oldest = Math.min(...this.blockWindow.keys());
      this.blockWindow.delete(oldest);
    }

    // Update latest
    if (number > this.latestBlock) {
      this.latestBlock = number;
    }

    // Emit block event
    this.emit("block", {
      chain: this.chain.slug,
      blockNumber: number,
      blockHash: hash,
      parentHash,
      timestamp,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _calculateReorgDepth(fromBlock) {
    let depth = 1;
    for (let n = fromBlock - 1; n >= fromBlock - WINDOW_SIZE; n--) {
      if (!this.blockWindow.has(n)) break;
      depth++;
    }
    return Math.min(depth, WINDOW_SIZE);
  }

  /** Returns the current finality status for a given block number. */
  getFinalityStatus(blockNumber) {
    const confirmations = this.latestBlock - blockNumber;
    if (confirmations < 0) return "unknown";
    if (confirmations < this.chain.softConfirmBlocks) return "pending";
    if (confirmations < this.chain.finalityBlocks) return "soft_confirmed";
    return "finalized";
  }
}

module.exports = BlockTracker;
