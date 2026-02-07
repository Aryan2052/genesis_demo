/**
 * Genesis — Anomaly Detector
 * 
 * Uses statistical methods (z-score) to detect unusual blockchain activity.
 * Goes beyond simple thresholds to identify statistical outliers.
 * 
 * Example: "This $500K USDT transfer is 3.5σ above the 7-day average"
 */

class AnomalyDetector {
  constructor() {
    // Store historical data for statistical analysis
    this.history = {
      transfer_amounts: [], // Track transfer amounts by token
      tx_counts: [], // Track transaction counts per time window
      gas_prices: [], // Track gas prices
      max_history_size: 1000, // Keep last 1000 data points
    };

    // Anomaly thresholds
    this.thresholds = {
      z_score_critical: 3.0, // 3σ = 99.7% confidence
      z_score_high: 2.0, // 2σ = 95% confidence
      z_score_medium: 1.5, // 1.5σ = 87% confidence
    };
  }

  // -------------------------------------------------------------------------
  // Track Historical Data
  // -------------------------------------------------------------------------

  /**
   * Record a transfer amount for statistical analysis
   * @param {string} token - Token symbol (e.g., "USDT", "USDC")
   * @param {string} amountRaw - Raw amount as string
   * @param {number} decimals - Token decimals
   */
  recordTransfer(token, amountRaw, decimals = 6) {
    const amount = Number(amountRaw) / Math.pow(10, decimals);
    
    if (!this.history.transfer_amounts[token]) {
      this.history.transfer_amounts[token] = [];
    }

    this.history.transfer_amounts[token].push({
      amount,
      timestamp: Date.now(),
    });

    // Keep history size manageable
    if (this.history.transfer_amounts[token].length > this.thresholds.max_history_size) {
      this.history.transfer_amounts[token].shift();
    }
  }

  // -------------------------------------------------------------------------
  // Statistical Calculations
  // -------------------------------------------------------------------------

  /**
   * Calculate mean (average) of an array
   */
  _mean(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   */
  _stdDev(values) {
    if (values.length < 2) return 0;
    const mean = this._mean(values);
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = this._mean(squaredDiffs);
    return Math.sqrt(variance);
  }

  /**
   * Calculate z-score for a value
   * Z-score = (value - mean) / stdDev
   * 
   * Interpretation:
   *   |z| < 1.0: Normal (within 1σ)
   *   |z| < 2.0: Unusual (within 2σ, ~95%)
   *   |z| < 3.0: Very unusual (within 3σ, ~99.7%)
   *   |z| ≥ 3.0: Anomaly (outside 3σ)
   */
  _zScore(value, mean, stdDev) {
    if (stdDev === 0) return 0;
    return (value - mean) / stdDev;
  }

  // -------------------------------------------------------------------------
  // Anomaly Detection
  // -------------------------------------------------------------------------

  /**
   * Check if a transfer amount is anomalous
   * @param {string} token - Token symbol
   * @param {number} amount - Transfer amount (normalized)
   * @returns {Object|null} Anomaly info or null if normal
   */
  detectTransferAnomaly(token, amount) {
    const history = this.history.transfer_amounts[token];
    
    if (!history || history.length < 10) {
      // Need at least 10 data points for meaningful statistics
      return null;
    }

    // Get recent amounts (last 100 or all if less)
    const recentAmounts = history.slice(-100).map(h => h.amount);
    const mean = this._mean(recentAmounts);
    const stdDev = this._stdDev(recentAmounts);
    const zScore = this._zScore(amount, mean, stdDev);
    const absZ = Math.abs(zScore);

    // Determine if anomalous
    let severity = null;
    let description = '';

    if (absZ >= this.thresholds.z_score_critical) {
      severity = 'critical';
      description = `Extreme anomaly: ${absZ.toFixed(1)}σ ${zScore > 0 ? 'above' : 'below'} average`;
    } else if (absZ >= this.thresholds.z_score_high) {
      severity = 'high';
      description = `Significant anomaly: ${absZ.toFixed(1)}σ ${zScore > 0 ? 'above' : 'below'} average`;
    } else if (absZ >= this.thresholds.z_score_medium) {
      severity = 'medium';
      description = `Unusual activity: ${absZ.toFixed(1)}σ ${zScore > 0 ? 'above' : 'below'} average`;
    } else {
      return null; // Normal activity
    }

    return {
      token,
      amount,
      z_score: zScore,
      abs_z_score: absZ,
      severity,
      description,
      stats: {
        mean: mean.toFixed(2),
        std_dev: stdDev.toFixed(2),
        sample_size: recentAmounts.length,
      },
      confidence_level: this._getConfidenceLevel(absZ),
    };
  }

  /**
   * Get confidence level for z-score
   */
  _getConfidenceLevel(absZ) {
    if (absZ >= 3.0) return '99.7%';
    if (absZ >= 2.5) return '98.8%';
    if (absZ >= 2.0) return '95.4%';
    if (absZ >= 1.5) return '86.6%';
    return '<85%';
  }

  // -------------------------------------------------------------------------
  // Batch Detection
  // -------------------------------------------------------------------------

  /**
   * Detect anomalies in a batch of events
   * @param {Array} events - Array of GenesisEvents
   * @returns {Array} Array of anomaly alerts
   */
  detectBatchAnomalies(events) {
    const anomalies = [];

    for (const event of events) {
      // Only check transfer events with amounts
      if (!event.eventType.includes('TRANSFER') || !event.args._rawValue) {
        continue;
      }

      // Determine token and decimals
      const token = this._getTokenSymbol(event.contract);
      const decimals = this._getTokenDecimals(event.contract);
      const amount = Number(event.args._rawValue) / Math.pow(10, decimals);

      // Record for historical tracking
      this.recordTransfer(token, event.args._rawValue, decimals);

      // Check for anomaly
      const anomaly = this.detectTransferAnomaly(token, amount);
      
      if (anomaly) {
        anomalies.push({
          event,
          anomaly,
          alert_type: 'anomaly_detected',
          message: `🚨 Anomaly: ${this._formatAmount(amount)} ${token} transfer is ${anomaly.description}`,
        });
      }
    }

    return anomalies;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  _getTokenSymbol(contract) {
    const tokens = {
      '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC',
      '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI',
    };
    return tokens[contract] || 'TOKEN';
  }

  _getTokenDecimals(contract) {
    const decimals = {
      '0xdAC17F958D2ee523a2206206994597C13D831ec7': 6, // USDT
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 6, // USDC
      '0x6B175474E89094C44Da98b954EedeAC495271d0F': 18, // DAI
    };
    return decimals[contract] || 18;
  }

  _formatAmount(amount) {
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(2)}M`;
    } else if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(2)}K`;
    }
    return `$${amount.toFixed(2)}`;
  }

  // -------------------------------------------------------------------------
  // Statistics Export
  // -------------------------------------------------------------------------

  /**
   * Get current statistics for all tracked tokens
   */
  getStats() {
    const stats = {};

    for (const [token, history] of Object.entries(this.history.transfer_amounts)) {
      if (history.length === 0) continue;

      const amounts = history.map(h => h.amount);
      const mean = this._mean(amounts);
      const stdDev = this._stdDev(amounts);
      const min = Math.min(...amounts);
      const max = Math.max(...amounts);

      stats[token] = {
        sample_size: amounts.length,
        mean: mean.toFixed(2),
        std_dev: stdDev.toFixed(2),
        min: min.toFixed(2),
        max: max.toFixed(2),
        latest: amounts[amounts.length - 1].toFixed(2),
      };
    }

    return stats;
  }

  /**
   * Reset all historical data
   */
  reset() {
    this.history = {
      transfer_amounts: [],
      tx_counts: [],
      gas_prices: [],
      max_history_size: 1000,
    };
  }
}

module.exports = AnomalyDetector;
