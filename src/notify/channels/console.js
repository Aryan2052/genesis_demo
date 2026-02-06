/**
 * Console Notification Channel
 * Pretty-prints alerts to console (for development/demo)
 */

const { formatConsoleAlert } = require('../templates');

class ConsoleChannel {
  constructor(config) {
    this.config = config;
    this.enabled = config.CONSOLE_ALERTS !== 'false'; // Enabled by default
    
    if (this.enabled) {
      console.log('✅ Console channel initialized');
    }
  }

  /**
   * Send alert to console
   */
  async send(alert) {
    if (!this.enabled) {
      return { success: false, channel: 'console', reason: 'disabled' };
    }

    try {
      const message = formatConsoleAlert(alert);
      
      // Color based on severity
      const colors = {
        critical: '\x1b[41m\x1b[37m', // Red background, white text
        high: '\x1b[31m',              // Red text
        medium: '\x1b[33m',            // Yellow text
        low: '\x1b[36m'                // Cyan text
      };
      const reset = '\x1b[0m';
      const color = colors[alert.severity] || colors.low;
      
      console.log(color + message + reset);

      return {
        success: true,
        channel: 'console',
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ Console send failed:', error.message);
      throw error;
    }
  }

  /**
   * Test connection (always succeeds for console)
   */
  async test() {
    return { success: true };
  }
}

module.exports = ConsoleChannel;
