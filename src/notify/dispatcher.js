/**
 * Notification Dispatcher
 * Routes alerts to configured channels with retry logic and idempotency
 */

const TelegramChannel = require('./channels/telegram');
const WebhookChannel = require('./channels/webhook');
const ConsoleChannel = require('./channels/console');
const RetryEngine = require('./retry');

class NotificationDispatcher {
  constructor(config) {
    this.config = config;
    
    // Initialize channels
    this.channels = {
      telegram: new TelegramChannel(config),
      webhook: new WebhookChannel(config),
      console: new ConsoleChannel(config)
    };
    
    // Initialize retry engine
    this.retryEngine = new RetryEngine({
      maxRetries: config.NOTIFICATION_MAX_RETRIES || 3,
      baseDelay: config.NOTIFICATION_RETRY_DELAY || 1000,
      maxDelay: 30000
    });
    
    // Idempotency tracking (in-memory for MVP, would use Redis in production)
    this.sentAlerts = new Set();
    this.maxIdempotencyCache = config.MAX_IDEMPOTENCY_CACHE || 10000;
    
    console.log('✅ Notification dispatcher initialized');
  }

  /**
   * Dispatch alert to all enabled channels
   */
  async dispatch(alert) {
    // Generate idempotency key
    const idempotencyKey = this.generateIdempotencyKey(alert);
    
    // Check if already sent
    if (this.sentAlerts.has(idempotencyKey)) {
      console.log('⏭️  Alert already sent (idempotent), skipping:', idempotencyKey);
      return { success: true, cached: true };
    }
    
    const results = {
      alert_id: alert.id,
      idempotency_key: idempotencyKey,
      channels: {},
      timestamp: Date.now()
    };
    
    // Send to each enabled channel
    const channelPromises = [];
    
    for (const [name, channel] of Object.entries(this.channels)) {
      if (channel.enabled) {
        channelPromises.push(
          this.sendToChannel(name, channel, alert)
            .then(result => {
              results.channels[name] = result;
            })
            .catch(error => {
              results.channels[name] = { success: false, error: error.message };
            })
        );
      }
    }
    
    await Promise.all(channelPromises);
    
    // Mark as sent (idempotency)
    this.markAsSent(idempotencyKey);
    
    // Log summary
    const successful = Object.values(results.channels).filter(r => r.success).length;
    const total = Object.keys(results.channels).length;
    console.log(`✅ Alert dispatched to ${successful}/${total} channels`);
    
    return results;
  }

  /**
   * Send alert to a specific channel with retry
   */
  async sendToChannel(name, channel, alert) {
    const result = await this.retryEngine.executeWithRetry(
      () => channel.send(alert),
      { channel: name, alert_id: alert.id }
    );
    
    if (result.success) {
      return { success: true, ...result.result };
    } else {
      console.error(`❌ Failed to send to ${name} after ${result.attempts} attempts`);
      return { success: false, error: result.error.message, attempts: result.attempts };
    }
  }

  /**
   * Generate idempotency key for alert
   */
  generateIdempotencyKey(alert) {
    if (alert.alert_type === 'aggregated') {
      // For aggregated alerts: rule + from_block + to_block + event_count
      return `agg:${alert.rule_name}:${alert.from_block}:${alert.to_block}:${alert.event_count}`;
    } else {
      // For single event alerts: rule + event_id
      return `single:${alert.rule_name}:${alert.event?.event_id || alert.event_id}`;
    }
  }

  /**
   * Mark alert as sent (idempotency tracking)
   */
  markAsSent(idempotencyKey) {
    this.sentAlerts.add(idempotencyKey);
    
    // Simple LRU: if cache too large, clear oldest half
    if (this.sentAlerts.size > this.maxIdempotencyCache) {
      const toKeep = Array.from(this.sentAlerts).slice(-Math.floor(this.maxIdempotencyCache / 2));
      this.sentAlerts = new Set(toKeep);
    }
  }

  /**
   * Test all channels
   */
  async testChannels() {
    console.log('\n🧪 Testing notification channels...\n');
    
    for (const [name, channel] of Object.entries(this.channels)) {
      if (channel.enabled) {
        console.log(`Testing ${name}...`);
        const result = await channel.test();
        console.log(result.success ? `✅ ${name} OK` : `❌ ${name} FAILED: ${result.error}`);
      } else {
        console.log(`⏭️  ${name} disabled`);
      }
    }
    
    console.log('');
  }

  /**
   * Get dead letter queue
   */
  getDeadLetterQueue() {
    return this.retryEngine.getDeadLetterQueue();
  }

  /**
   * Clear dead letter queue
   */
  clearDeadLetterQueue() {
    return this.retryEngine.clearDeadLetterQueue();
  }
}

module.exports = NotificationDispatcher;
