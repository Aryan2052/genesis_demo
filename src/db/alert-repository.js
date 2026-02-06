/**
 * Genesis — Alert Repository
 * 
 * Database operations for alerts (instant + aggregated).
 */

class AlertRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Save an alert to database
   * @param {Object} alert - Alert object from aggregator/evaluator
   */
  async save(alert) {
    const query = `
      INSERT INTO alerts (
        alert_id, alert_type, rule_id, rule_name, severity,
        chain, event_ids, event_count,
        from_block, to_block,
        window_start, window_end, window_duration,
        data, notified, notified_at, notification_channels
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10,
        $11, $12, $13,
        $14, $15, $16, $17
      )
      ON CONFLICT (alert_id) DO UPDATE SET
        event_count = EXCLUDED.event_count,
        data = EXCLUDED.data,
        notified = EXCLUDED.notified,
        notified_at = EXCLUDED.notified_at,
        notification_channels = EXCLUDED.notification_channels
      RETURNING id
    `;

    const params = [
      alert.alertId || this._generateAlertId(alert),
      alert.type || "instant",
      alert.rule.rule_id,
      alert.rule.name,
      alert.rule.severity,
      alert.chain,
      alert.eventIds || [],
      alert.count || 1,
      alert.fromBlock || alert.event?.blockNumber,
      alert.toBlock || alert.event?.blockNumber,
      alert.windowStart || null,
      alert.windowEnd || null,
      alert.windowDuration || null,
      JSON.stringify(alert.data || {}),
      alert.notified || false,
      alert.notifiedAt || null,
      alert.notificationChannels || ["console"],
    ];

    try {
      const result = await this.db.query(query, params);
      return result.rows[0].id;
    } catch (err) {
      console.error(`  💥 [AlertRepository] Save failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Mark alert as notified
   * @param {string} alertId
   * @param {Array<string>} channels
   */
  async markNotified(alertId, channels = ["console"]) {
    const query = `
      UPDATE alerts
      SET notified = true, notified_at = $1, notification_channels = $2
      WHERE alert_id = $3
      RETURNING id
    `;

    const params = [Math.floor(Date.now() / 1000), channels, alertId];

    try {
      const result = await this.db.query(query, params);
      return result.rowCount > 0;
    } catch (err) {
      console.error(`  💥 [AlertRepository] Mark notified failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get recent alerts with filters
   * @param {Object} filters - { chain, ruleId, severity, alertType, notified }
   * @param {number} limit
   */
  async getRecent(filters = {}, limit = 100) {
    let query = `SELECT * FROM alerts WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (filters.chain) {
      query += ` AND chain = $${paramIndex++}`;
      params.push(filters.chain);
    }

    if (filters.ruleId) {
      query += ` AND rule_id = $${paramIndex++}`;
      params.push(filters.ruleId);
    }

    if (filters.severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(filters.severity);
    }

    if (filters.alertType) {
      query += ` AND alert_type = $${paramIndex++}`;
      params.push(filters.alertType);
    }

    if (filters.notified !== undefined) {
      query += ` AND notified = $${paramIndex++}`;
      params.push(filters.notified);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await this.db.query(query, params);
    return result.rows.map(this._mapRow);
  }

  /**
   * Get alert count by filters
   */
  async getCount(filters = {}) {
    let query = `SELECT COUNT(*) as count FROM alerts WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (filters.chain) {
      query += ` AND chain = $${paramIndex++}`;
      params.push(filters.chain);
    }

    if (filters.ruleId) {
      query += ` AND rule_id = $${paramIndex++}`;
      params.push(filters.ruleId);
    }

    if (filters.severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(filters.severity);
    }

    const result = await this.db.query(query, params);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get alerts by rule ID
   * @param {string} ruleId
   * @param {number} limit
   */
  async getByRule(ruleId, limit = 100) {
    const query = `
      SELECT * FROM alerts
      WHERE rule_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const result = await this.db.query(query, [ruleId, limit]);
    return result.rows.map(this._mapRow);
  }

  /**
   * Get stats summary
   */
  async getStats(chain) {
    const query = `
      SELECT
        COUNT(*) as total_alerts,
        COUNT(CASE WHEN severity = 'low' THEN 1 END) as low_count,
        COUNT(CASE WHEN severity = 'medium' THEN 1 END) as medium_count,
        COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_count,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
        COUNT(CASE WHEN alert_type = 'instant' THEN 1 END) as instant_count,
        COUNT(CASE WHEN alert_type = 'aggregated' THEN 1 END) as aggregated_count,
        COUNT(CASE WHEN notified = true THEN 1 END) as notified_count,
        SUM(event_count) as total_events
      FROM alerts
      WHERE chain = $1
    `;

    const result = await this.db.query(query, [chain]);
    return result.rows[0];
  }

  /**
   * Generate alert ID
   */
  _generateAlertId(alert) {
    const timestamp = Date.now();
    const ruleId = alert.rule?.rule_id || "unknown";
    const type = alert.type || "instant";
    return `${type}:${ruleId}:${timestamp}`;
  }

  /**
   * Map database row to alert object
   */
  _mapRow(row) {
    return {
      id: row.id,
      alertId: row.alert_id,
      type: row.alert_type,
      rule: {
        rule_id: row.rule_id,
        name: row.rule_name,
        severity: row.severity,
      },
      chain: row.chain,
      eventIds: row.event_ids,
      count: row.event_count,
      fromBlock: parseInt(row.from_block, 10),
      toBlock: parseInt(row.to_block, 10),
      windowStart: row.window_start,
      windowEnd: row.window_end,
      windowDuration: row.window_duration,
      data: row.data, // Already parsed as JSON by pg
      notified: row.notified,
      notifiedAt: row.notified_at,
      notificationChannels: row.notification_channels,
      createdAt: row.created_at,
    };
  }
}

module.exports = AlertRepository;
