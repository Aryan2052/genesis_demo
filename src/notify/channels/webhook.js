/**
 * Webhook Notification Channel
 * Sends alerts via HTTP POST with HMAC signature
 */

const axios = require('axios');
const crypto = require('crypto');
const { formatWebhookAlert } = require('../templates');

class WebhookChannel {
  constructor(config) {
    this.config = config;
    this.enabled = !!config.WEBHOOK_URL;
    this.url = config.WEBHOOK_URL;
    this.secret = config.WEBHOOK_SECRET || '';
    
    if (this.enabled) {
      console.log('✅ Webhook channel initialized:', this.url);
    } else {
      console.log('⚠️  Webhook channel disabled (no URL configured)');
    }
  }

  /**
   * Generate HMAC signature
   */
  generateSignature(payload) {
    if (!this.secret) return null;
    
    const hmac = crypto.createHmac('sha256', this.secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  /**
   * Send alert to webhook
   */
  async send(alert) {
    if (!this.enabled) {
      throw new Error('Webhook channel not configured');
    }

    try {
      const payload = formatWebhookAlert(alert);
      const signature = this.generateSignature(payload);
      
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Genesis-Alert-System/1.0'
      };
      
      if (signature) {
        headers['X-Genesis-Signature'] = signature;
      }
      
      const response = await axios.post(this.url, payload, {
        headers,
        timeout: 10000 // 10s timeout
      });

      return {
        success: true,
        channel: 'webhook',
        status: response.status,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ Webhook send failed:', error.message);
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
      const testPayload = {
        type: 'test',
        message: 'Genesis Alert System - Connection Test',
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      const signature = this.generateSignature(testPayload);
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Genesis-Alert-System/1.0'
      };
      
      if (signature) {
        headers['X-Genesis-Signature'] = signature;
      }
      
      await axios.post(this.url, testPayload, { headers, timeout: 5000 });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = WebhookChannel;
