-- Genesis Database Schema
-- PostgreSQL 12+

-- ============================================================================
-- EVENTS TABLE
-- Stores all decoded blockchain events
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
  -- Primary key
  id BIGSERIAL PRIMARY KEY,
  
  -- Event identification
  event_id VARCHAR(100) UNIQUE NOT NULL, -- chainId:blockNumber:txIndex:logIndex
  chain VARCHAR(50) NOT NULL,
  chain_id INTEGER NOT NULL,
  
  -- Block data
  block_number BIGINT NOT NULL,
  block_hash VARCHAR(66) NOT NULL,
  block_timestamp BIGINT NOT NULL, -- Unix timestamp
  
  -- Transaction data
  tx_hash VARCHAR(66) NOT NULL,
  tx_index INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  
  -- Event metadata
  contract_address VARCHAR(42) NOT NULL,
  event_name VARCHAR(100) NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- ERC20_TRANSFER, UNISWAP_V2, etc.
  
  -- Event arguments (JSONB for flexible querying)
  args JSONB NOT NULL,
  
  -- Finality tracking
  finality VARCHAR(20) NOT NULL, -- pending, soft_confirmed, final
  finality_updated_at BIGINT, -- Last finality upgrade timestamp
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_events_chain_block ON events(chain, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract_address, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_events_finality ON events(finality, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_events_tx_hash ON events(tx_hash);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(block_timestamp DESC);

-- GIN index for JSONB args (enables fast JSON queries)
CREATE INDEX IF NOT EXISTS idx_events_args_gin ON events USING GIN (args);

-- ============================================================================
-- ALERTS TABLE
-- Stores all generated alerts (instant + aggregated)
-- ============================================================================

CREATE TABLE IF NOT EXISTS alerts (
  -- Primary key
  id BIGSERIAL PRIMARY KEY,
  
  -- Alert identification
  alert_id VARCHAR(100) UNIQUE NOT NULL,
  alert_type VARCHAR(20) NOT NULL, -- instant, aggregated
  
  -- Rule reference
  rule_id VARCHAR(100) NOT NULL,
  rule_name VARCHAR(200) NOT NULL,
  severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
  
  -- Chain context
  chain VARCHAR(50) NOT NULL,
  
  -- Event references
  event_ids TEXT[], -- Array of event_id references
  event_count INTEGER NOT NULL DEFAULT 1,
  
  -- Block range
  from_block BIGINT NOT NULL,
  to_block BIGINT NOT NULL,
  
  -- Time window (for aggregated alerts)
  window_start BIGINT, -- Unix timestamp
  window_end BIGINT,   -- Unix timestamp
  window_duration INTEGER, -- Seconds
  
  -- Alert data (JSONB for flexibility)
  data JSONB NOT NULL,
  
  -- Notification status
  notified BOOLEAN DEFAULT FALSE,
  notified_at BIGINT,
  notification_channels TEXT[], -- ['console', 'telegram', 'webhook']
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alerts_rule ON alerts(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_chain ON alerts(chain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_notified ON alerts(notified, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_blocks ON alerts(from_block, to_block);

-- GIN index for JSONB data
CREATE INDEX IF NOT EXISTS idx_alerts_data_gin ON alerts USING GIN (data);

-- ============================================================================
-- FINALITY_HISTORY TABLE
-- Tracks finality state changes for events (optional, for audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS finality_history (
  id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(100) NOT NULL REFERENCES events(event_id),
  from_finality VARCHAR(20) NOT NULL,
  to_finality VARCHAR(20) NOT NULL,
  block_number BIGINT NOT NULL, -- Block number when upgrade happened
  changed_at BIGINT NOT NULL, -- Unix timestamp
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finality_history_event ON finality_history(event_id, changed_at DESC);

-- ============================================================================
-- STATS TABLE
-- Stores aggregate statistics for dashboards
-- ============================================================================

CREATE TABLE IF NOT EXISTS stats (
  id BIGSERIAL PRIMARY KEY,
  stat_type VARCHAR(50) NOT NULL, -- daily_events, hourly_alerts, etc.
  chain VARCHAR(50) NOT NULL,
  time_bucket BIGINT NOT NULL, -- Unix timestamp (rounded to hour/day)
  
  -- Counters
  event_count INTEGER DEFAULT 0,
  alert_count INTEGER DEFAULT 0,
  unique_contracts INTEGER DEFAULT 0,
  unique_senders INTEGER DEFAULT 0,
  unique_receivers INTEGER DEFAULT 0,
  
  -- Data (JSONB for flexible metrics)
  data JSONB,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(stat_type, chain, time_bucket)
);

CREATE INDEX IF NOT EXISTS idx_stats_type_chain ON stats(stat_type, chain, time_bucket DESC);

-- ============================================================================
-- HEALTH TABLE
-- Tracks system health metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS health (
  id BIGSERIAL PRIMARY KEY,
  chain VARCHAR(50) NOT NULL,
  
  -- Block tracking
  latest_block BIGINT NOT NULL,
  latest_block_timestamp BIGINT NOT NULL,
  blocks_processed BIGINT DEFAULT 0,
  
  -- Event metrics
  events_decoded BIGINT DEFAULT 0,
  decode_success_rate DECIMAL(5,2), -- Percentage
  
  -- RPC health
  rpc_providers_healthy INTEGER DEFAULT 0,
  rpc_providers_total INTEGER DEFAULT 0,
  
  -- Timestamp
  checked_at BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(chain, checked_at)
);

CREATE INDEX IF NOT EXISTS idx_health_chain ON health(chain, checked_at DESC);
