/**
 * Genesis — Notification Dispatcher
 *
 * Routes alerts to one or more notification channels.
 * Phase 1: console only.
 * Phase 4: adds webhook, telegram, email.
 */

class Dispatcher {
  constructor() {
    /** @type {Map<string, object>} */
    this.channels = new Map();
  }

  /**
   * Register a notification channel.
   * @param {string} name
   * @param {object} channel — must implement notify(), notifyFinalityUpgrade(), notifyRevert()
   */
  addChannel(name, channel) {
    this.channels.set(name, channel);
  }

  /** Dispatch a new event to all channels (Phase 1 — raw events). */
  notify(event) {
    for (const channel of this.channels.values()) {
      try {
        channel.notify(event);
      } catch (err) {
        console.error(`  ⚠️  [Dispatcher] Channel error: ${err.message}`);
      }
    }
  }

  /** Dispatch a rule-matched instant alert (Phase 2). */
  notifyAlert(alert) {
    for (const channel of this.channels.values()) {
      try {
        if (typeof channel.notifyAlert === "function") {
          channel.notifyAlert(alert);
        } else {
          // Fallback to Phase 1 notify
          channel.notify(alert.event);
        }
      } catch (err) {
        console.error(`  ⚠️  [Dispatcher] Channel error: ${err.message}`);
      }
    }
  }

  /** Dispatch an aggregated alert (Phase 2). */
  notifyAggregated(alert) {
    for (const channel of this.channels.values()) {
      try {
        if (typeof channel.notifyAggregated === "function") {
          channel.notifyAggregated(alert);
        }
      } catch (err) {
        console.error(`  ⚠️  [Dispatcher] Channel error: ${err.message}`);
      }
    }
  }

  /** Dispatch a finality upgrade to all channels. */
  notifyFinalityUpgrade(data) {
    for (const channel of this.channels.values()) {
      if (typeof channel.notifyFinalityUpgrade === "function") {
        try {
          channel.notifyFinalityUpgrade(data);
        } catch (err) {
          console.error(`  ⚠️  [Dispatcher] Channel error: ${err.message}`);
        }
      }
    }
  }

  /** Dispatch a revert notification to all channels. */
  notifyRevert(data) {
    for (const channel of this.channels.values()) {
      if (typeof channel.notifyRevert === "function") {
        try {
          channel.notifyRevert(data);
        } catch (err) {
          console.error(`  ⚠️  [Dispatcher] Channel error: ${err.message}`);
        }
      }
    }
  }
}

module.exports = Dispatcher;
