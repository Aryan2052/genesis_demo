/**
 * Telegram Notification Channel
 * Sends alerts to Telegram bot using Bot API
 */

const TelegramBot = require('node-telegram-bot-api');
const { formatTelegramAlert } = require('../templates');

class TelegramChannel {
  constructor(config) {
    this.config = config;
    this.enabled = !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID);
    
    if (this.enabled) {
      this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });
      this.chatId = config.TELEGRAM_CHAT_ID;
      console.log('✅ Telegram channel initialized');
    } else {
      console.log('⚠️  Telegram channel disabled (missing credentials)');
    }
  }

  /**
   * Send alert to Telegram
   */
  async send(alert) {
    if (!this.enabled) {
      throw new Error('Telegram channel not configured');
    }

    try {
      const message = formatTelegramAlert(alert);
      
      const result = await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      });

      return {
        success: true,
        channel: 'telegram',
        messageId: result.message_id,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ Telegram send failed:', error.message);
      throw error;
    }
  }

  /**
   * Test connection
   */
  async test() {
    if (!this.enabled) {
      return { success: false, error: 'Not configured' };
    }

    try {
      await this.bot.sendMessage(this.chatId, '✅ Genesis Alert System - Connection Test', {
        parse_mode: 'Markdown'
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = TelegramChannel;
