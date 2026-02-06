/**
 * Genesis — Metrics Collector
 * 
 * Tracks RPC calls, events, alerts, and cost savings in real-time.
 * Provides data for the metrics dashboard.
 */

class MetricsCollector {
  constructor() {
    this.metrics = {
      // RPC Metrics
      rpc: {
        calls_made: 0,
        calls_saved: 0, // Estimated calls we DIDN'T make due to selective indexing
        calls_failed: 0,
        total_latency_ms: 0,
      },
      
      // Event Processing
      events: {
        total_decoded: 0,
        matched_rules: 0,
        filtered_out: 0,
        by_type: {}, // { "ERC20_TRANSFER": 123, ... }
      },
      
      // Alerts
      alerts: {
        total_sent: 0,
        by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
        by_channel: { telegram: 0, webhook: 0, console: 0 },
        failed: 0,
        retried: 0,
      },
      
      // Blocks
      blocks: {
        processed: 0,
        first_block: null,
        latest_block: null,
        reorgs_detected: 0,
      },
      
      // Aggregation
      aggregation: {
        windows_created: 0,
        events_aggregated: 0,
        alerts_deduplicated: 0,
      },
      
      // Timestamps
      started_at: Date.now(),
      last_updated: Date.now(),
    };
  }

  // -------------------------------------------------------------------------
  // RPC Metrics
  // -------------------------------------------------------------------------

  recordRPCCall(latencyMs = 0, failed = false) {
    this.metrics.rpc.calls_made++;
    this.metrics.rpc.total_latency_ms += latencyMs;
    if (failed) this.metrics.rpc.calls_failed++;
    this._update();
  }

  recordRPCSaved(count = 1) {
    // Called when selective indexing skips unnecessary calls
    this.metrics.rpc.calls_saved += count;
    this._update();
  }

  // -------------------------------------------------------------------------
  // Event Metrics
  // -------------------------------------------------------------------------

  recordEventDecoded(eventType) {
    this.metrics.events.total_decoded++;
    this.metrics.events.by_type[eventType] = (this.metrics.events.by_type[eventType] || 0) + 1;
    this._update();
  }

  recordEventMatched() {
    this.metrics.events.matched_rules++;
    this._update();
  }

  recordEventFiltered() {
    this.metrics.events.filtered_out++;
    this._update();
  }

  // -------------------------------------------------------------------------
  // Alert Metrics
  // -------------------------------------------------------------------------

  recordAlertSent(severity, channel) {
    this.metrics.alerts.total_sent++;
    this.metrics.alerts.by_severity[severity] = (this.metrics.alerts.by_severity[severity] || 0) + 1;
    this.metrics.alerts.by_channel[channel] = (this.metrics.alerts.by_channel[channel] || 0) + 1;
    this._update();
  }

  recordAlertFailed() {
    this.metrics.alerts.failed++;
    this._update();
  }

  recordAlertRetried() {
    this.metrics.alerts.retried++;
    this._update();
  }

  // -------------------------------------------------------------------------
  // Block Metrics
  // -------------------------------------------------------------------------

  recordBlockProcessed(blockNumber) {
    this.metrics.blocks.processed++;
    if (!this.metrics.blocks.first_block) {
      this.metrics.blocks.first_block = blockNumber;
    }
    this.metrics.blocks.latest_block = blockNumber;
    this._update();
  }

  recordReorg() {
    this.metrics.blocks.reorgs_detected++;
    this._update();
  }

  // -------------------------------------------------------------------------
  // Aggregation Metrics
  // -------------------------------------------------------------------------

  recordAggregationWindow() {
    this.metrics.aggregation.windows_created++;
    this._update();
  }

  recordEventAggregated(count = 1) {
    this.metrics.aggregation.events_aggregated += count;
    this._update();
  }

  recordAlertDeduplicated() {
    this.metrics.aggregation.alerts_deduplicated++;
    this._update();
  }

  // -------------------------------------------------------------------------
  // Computed Metrics
  // -------------------------------------------------------------------------

  getComputedMetrics() {
    const uptime_sec = Math.floor((Date.now() - this.metrics.started_at) / 1000);
    const total_rpc = this.metrics.rpc.calls_made + this.metrics.rpc.calls_saved;
    const rpc_savings_percent = total_rpc > 0 ? ((this.metrics.rpc.calls_saved / total_rpc) * 100).toFixed(1) : 0;
    
    // Cost calculations (assuming $0.0005 per RPC call)
    const cost_per_call = 0.0005;
    const cost_actual = this.metrics.rpc.calls_made * cost_per_call;
    const cost_without_optimization = total_rpc * cost_per_call;
    const cost_saved = cost_without_optimization - cost_actual;
    
    // Alert noise reduction
    const noise_reduction_percent = this.metrics.events.total_decoded > 0
      ? (((this.metrics.events.total_decoded - this.metrics.alerts.total_sent) / this.metrics.events.total_decoded) * 100).toFixed(1)
      : 0;
    
    // Average latency
    const avg_rpc_latency = this.metrics.rpc.calls_made > 0
      ? (this.metrics.rpc.total_latency_ms / this.metrics.rpc.calls_made).toFixed(0)
      : 0;

    return {
      uptime_sec,
      uptime_formatted: this._formatUptime(uptime_sec),
      
      rpc: {
        total_calls: total_rpc,
        calls_made: this.metrics.rpc.calls_made,
        calls_saved: this.metrics.rpc.calls_saved,
        savings_percent: rpc_savings_percent,
        avg_latency_ms: avg_rpc_latency,
        success_rate: this.metrics.rpc.calls_made > 0
          ? (((this.metrics.rpc.calls_made - this.metrics.rpc.calls_failed) / this.metrics.rpc.calls_made) * 100).toFixed(1)
          : 100,
      },
      
      cost: {
        actual_usd: cost_actual.toFixed(2),
        without_optimization_usd: cost_without_optimization.toFixed(2),
        saved_usd: cost_saved.toFixed(2),
        projected_monthly_usd: (cost_actual * 30 * 24 * 60 * 60 / Math.max(uptime_sec, 1)).toFixed(2),
        projected_monthly_saved_usd: (cost_saved * 30 * 24 * 60 * 60 / Math.max(uptime_sec, 1)).toFixed(2),
      },
      
      events: {
        total_decoded: this.metrics.events.total_decoded,
        matched_rules: this.metrics.events.matched_rules,
        filtered_out: this.metrics.events.filtered_out,
        match_rate_percent: this.metrics.events.total_decoded > 0
          ? ((this.metrics.events.matched_rules / this.metrics.events.total_decoded) * 100).toFixed(1)
          : 0,
      },
      
      alerts: {
        total_sent: this.metrics.alerts.total_sent,
        noise_reduction_percent,
        by_severity: this.metrics.alerts.by_severity,
        by_channel: this.metrics.alerts.by_channel,
        reliability_percent: (this.metrics.alerts.total_sent + this.metrics.alerts.failed) > 0
          ? ((this.metrics.alerts.total_sent / (this.metrics.alerts.total_sent + this.metrics.alerts.failed)) * 100).toFixed(1)
          : 100,
      },
      
      blocks: {
        processed: this.metrics.blocks.processed,
        range: this.metrics.blocks.first_block && this.metrics.blocks.latest_block
          ? `${this.metrics.blocks.first_block} → ${this.metrics.blocks.latest_block}`
          : 'N/A',
        reorgs_detected: this.metrics.blocks.reorgs_detected,
      },
      
      aggregation: {
        windows_created: this.metrics.aggregation.windows_created,
        events_aggregated: this.metrics.aggregation.events_aggregated,
        reduction_ratio: this.metrics.aggregation.windows_created > 0
          ? (this.metrics.aggregation.events_aggregated / this.metrics.aggregation.windows_created).toFixed(1)
          : 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Full Metrics Export
  // -------------------------------------------------------------------------

  getAll() {
    return {
      raw: this.metrics,
      computed: this.getComputedMetrics(),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  _update() {
    this.metrics.last_updated = Date.now();
  }

  _formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }

  reset() {
    this.metrics = {
      rpc: { calls_made: 0, calls_saved: 0, calls_failed: 0, total_latency_ms: 0 },
      events: { total_decoded: 0, matched_rules: 0, filtered_out: 0, by_type: {} },
      alerts: { total_sent: 0, by_severity: {}, by_channel: {}, failed: 0, retried: 0 },
      blocks: { processed: 0, first_block: null, latest_block: null, reorgs_detected: 0 },
      aggregation: { windows_created: 0, events_aggregated: 0, alerts_deduplicated: 0 },
      started_at: Date.now(),
      last_updated: Date.now(),
    };
  }
}

// Singleton instance
const metricsCollector = new MetricsCollector();

module.exports = metricsCollector;
