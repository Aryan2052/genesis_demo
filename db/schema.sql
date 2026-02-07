-- Genesis Database Schema
-- SQLite 3

-- ============================================================================
-- EVENTS TABLE
-- Stores all decoded blockchain events
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
  -- Primary key
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Event identification
  event_id TEXT UNIQUE NOT NULL,
  chain TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  
  -- Block data
  block_number INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  block_timestamp INTEGER NOT NULL,
  
  -- Transaction data
  tx_hash TEXT NOT NULL,
  tx_index INTEGER,  -- Nullable - not always available from log data
  log_index INTEGER NOT NULL,
  
  -- Event metadata
  contract_address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  
  -- Event arguments (JSON for flexible querying)
  args TEXT NOT NULL,
  
  -- Finality tracking
  finality TEXT NOT NULL,
  finality_updated_at INTEGER,
  
  -- Metadata
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_events_chain_block ON events(chain, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract_address, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_events_finality ON events(finality, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_events_tx_hash ON events(tx_hash);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(block_timestamp DESC);

-- ============================================================================
-- ALERTS TABLE
-- Stores all generated alerts (instant + aggregated)
-- ============================================================================

CREATE TABLE IF NOT EXISTS alerts (
  -- Primary key
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Alert identification
  alert_id TEXT UNIQUE NOT NULL,
  alert_type TEXT NOT NULL,
  
  -- Rule reference
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  severity TEXT NOT NULL,
  
  -- Chain context
  chain TEXT NOT NULL,
  
  -- Event references (stored as JSON array)
  event_ids TEXT,
  event_count INTEGER NOT NULL DEFAULT 1,
  
  -- Block range
  from_block INTEGER NOT NULL,
  to_block INTEGER NOT NULL,
  
  -- Time window (for aggregated alerts)
  window_start INTEGER,
  window_end INTEGER,
  window_duration INTEGER,
  
  -- Alert data (JSON for flexibility)
  data TEXT NOT NULL,
  
  -- Notification status
  notified INTEGER DEFAULT 0,
  notified_at INTEGER,
  notification_channels TEXT,
  
  -- Metadata
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alerts_rule ON alerts(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_chain ON alerts(chain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_notified ON alerts(notified, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_blocks ON alerts(from_block, to_block);

-- ============================================================================
-- FINALITY_HISTORY TABLE
-- Tracks finality state changes for events (optional, for audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS finality_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  from_finality TEXT NOT NULL,
  to_finality TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (event_id) REFERENCES events(event_id)
);

CREATE INDEX IF NOT EXISTS idx_finality_history_event ON finality_history(event_id, changed_at DESC);

-- ============================================================================
-- STATS TABLE
-- Stores aggregate statistics for dashboards
-- ============================================================================

CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stat_type TEXT NOT NULL,
  chain TEXT NOT NULL,
  time_bucket INTEGER NOT NULL,
  
  -- Counters
  event_count INTEGER DEFAULT 0,
  alert_count INTEGER DEFAULT 0,
  unique_contracts INTEGER DEFAULT 0,
  unique_senders INTEGER DEFAULT 0,
  unique_receivers INTEGER DEFAULT 0,
  
  -- Data (JSON for flexible metrics)
  data TEXT,
  
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  
  UNIQUE(stat_type, chain, time_bucket)
);

CREATE INDEX IF NOT EXISTS idx_stats_type_chain ON stats(stat_type, chain, time_bucket DESC);

-- ============================================================================
-- HEALTH TABLE
-- Tracks system health metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  
  -- Block tracking
  latest_block INTEGER NOT NULL,
  latest_block_timestamp INTEGER NOT NULL,
  blocks_processed INTEGER DEFAULT 0,
  
  -- Event metrics
  events_decoded INTEGER DEFAULT 0,
  decode_success_rate REAL,
  
  -- RPC health
  rpc_providers_healthy INTEGER DEFAULT 0,
  rpc_providers_total INTEGER DEFAULT 0,
  
  -- Timestamp
  checked_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  
  UNIQUE(chain, checked_at)
);

CREATE INDEX IF NOT EXISTS idx_health_chain ON health(chain, checked_at DESC);

-- ============================================================================
-- TELEGRAM_USERS TABLE
-- Stores registered Telegram bot users
-- ============================================================================

CREATE TABLE IF NOT EXISTS telegram_users (
  chat_id TEXT PRIMARY KEY,
  username TEXT,
  registered_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- ============================================================================
-- TELEGRAM_PREFERENCES TABLE
-- Stores per-user alert subscription preferences
-- Users only receive alerts matching their preferences — no spam
-- ============================================================================

CREATE TABLE IF NOT EXISTS telegram_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  alert_type INTEGER NOT NULL,         -- 0=LargeTransfer, 1=WhaleMovement, 2=RapidFlow, 3=Custom
  alert_type_name TEXT NOT NULL,        -- human-readable key
  threshold INTEGER NOT NULL,           -- minimum amount in raw units (6 decimals)
  chain TEXT NOT NULL DEFAULT 'localhost',
  chain_id INTEGER NOT NULL DEFAULT 31337,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (chat_id) REFERENCES telegram_users(chat_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_prefs_chat ON telegram_preferences(chat_id);
CREATE INDEX IF NOT EXISTS idx_tg_prefs_type ON telegram_preferences(alert_type);
