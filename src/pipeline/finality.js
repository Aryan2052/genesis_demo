/**
 * Genesis — Finality Tracker
 *
 * Tracks events through the finality lifecycle:
 *   pending → soft_confirmed → finalized
 *                                  ↘ reverted (if reorg)
 *
 * KEY INNOVATION:
 *   Events aren't binary "confirmed" or "not". They carry a confidence score
 *   that upgrades over time as more blocks confirm them.
 *
 * Emits:
 *   "finality:upgraded"  — event moved from pending → soft or soft → final
 *   "finality:reverted"  — event invalidated by reorg
 */

const EventEmitter = require("events");
const { FinalityStatus } = require("./event-model");

class FinalityTracker extends EventEmitter {
  /**
   * @param {object} chainConfig — chain entry from config.getChain()
   */
  constructor(chainConfig) {
    super();
    this.chain = chainConfig;

    /**
     * Events being tracked for finality upgrades.
     * Key: event.id → { event, currentStatus }
     * @type {Map<string, { event: object, currentStatus: string }>}
     */
    this.tracked = new Map();

    // Limits to prevent memory leaks
    this.maxTracked = 10000;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start tracking a new event.
   * @param {import('./event-model').GenesisEvent} event
   */
  track(event) {
    if (this.tracked.size >= this.maxTracked) {
      // Evict oldest entries
      const oldest = this.tracked.keys().next().value;
      this.tracked.delete(oldest);
    }

    this.tracked.set(event.id, {
      event,
      currentStatus: event.finality,
    });
  }

  /**
   * Called on each new block — updates confirmations and finality status.
   * @param {number} latestBlock — current chain head
   */
  onNewBlock(latestBlock) {
    for (const [id, entry] of this.tracked) {
      const { event, currentStatus } = entry;
      const confirmations = latestBlock - event.blockNumber;

      if (confirmations < 0) continue;

      event.confirmations = confirmations;

      // Determine new status
      let newStatus;
      if (confirmations < this.chain.softConfirmBlocks) {
        newStatus = FinalityStatus.PENDING;
      } else if (confirmations < this.chain.finalityBlocks) {
        newStatus = FinalityStatus.SOFT_CONFIRMED;
      } else {
        newStatus = FinalityStatus.FINALIZED;
      }

      // Emit upgrade if status changed
      if (newStatus !== currentStatus && currentStatus !== FinalityStatus.REVERTED) {
        entry.currentStatus = newStatus;
        event.finality = newStatus;

        this.emit("finality:upgraded", {
          event,
          from: currentStatus,
          to: newStatus,
        });

        // Once finalized, stop tracking (it's permanent)
        if (newStatus === FinalityStatus.FINALIZED) {
          this.tracked.delete(id);
        }
      }
    }
  }

  /**
   * Called when a reorg is detected — reverts all events in the reorged range.
   * @param {{ fromBlock: number, toBlock: number }} reorg
   */
  onReorg(reorg) {
    const reverted = [];

    for (const [id, entry] of this.tracked) {
      const { event } = entry;
      if (
        event.blockNumber >= reorg.fromBlock &&
        event.blockNumber <= reorg.toBlock
      ) {
        entry.currentStatus = FinalityStatus.REVERTED;
        event.finality = FinalityStatus.REVERTED;
        reverted.push(event);
        this.tracked.delete(id);
      }
    }

    if (reverted.length > 0) {
      console.warn(
        `  🔄 [FinalityTracker] Reverted ${reverted.length} event(s) due to reorg at blocks ${reorg.fromBlock}→${reorg.toBlock}`
      );
      for (const event of reverted) {
        this.emit("finality:reverted", { event });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats() {
    const byStatus = {};
    for (const { currentStatus } of this.tracked.values()) {
      byStatus[currentStatus] = (byStatus[currentStatus] || 0) + 1;
    }
    return {
      chain: this.chain.slug,
      totalTracked: this.tracked.size,
      byStatus,
    };
  }
}

module.exports = FinalityTracker;
