# 🗄️ Genesis Database Guide

## Overview

Genesis uses **SQLite** for persistent storage of blockchain events and alerts. The database automatically saves to disk every 5 seconds and persists across restarts.

**Database Location:** `data/genesis.db` (1.2 MB currently)

---

## 📊 Current Database State

### Statistics
```
Total Events:  8,587 events
Total Alerts:  2 alerts
Event Types:   2 types (ERC20_TRANSFER, ERC20_APPROVAL)
Finality:      100% pending (will upgrade as blocks confirm)
Time Range:    Last ~1 hour of Ethereum mainnet activity
```

### Event Breakdown
- **ERC20_TRANSFER**: 8,380 events (97.6%)
- **ERC20_APPROVAL**: 207 events (2.4%)

### Monitored Contracts
- **USDC** (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`)
- **USDT** (`0xdAC17F958D2ee523a2206206994597C13D831ec7`)
- **DAI** (`0x6B175474E89094C44Da98b954EedeAC495271d0F`)
- **Uniswap V3 Pools**, **Aave**, etc.

---

## 📚 Database Schema

### Table: `events`
Stores all decoded blockchain events with finality tracking.

**Columns:**
```sql
id                   INTEGER PRIMARY KEY (auto-increment)
event_id             TEXT UNIQUE (format: chainId:blockHash:txHash:logIndex)
chain                TEXT (e.g., "ethereum")
chain_id             INTEGER (e.g., 1)
block_number         INTEGER
block_hash           TEXT
block_timestamp      INTEGER (Unix timestamp)
tx_hash              TEXT
log_index            INTEGER
contract_address     TEXT
event_name           TEXT (e.g., "Transfer", "Approval")
event_type           TEXT (e.g., "ERC20_TRANSFER")
args                 TEXT (JSON-encoded event arguments)
finality             TEXT (pending → soft_confirmed → finalized)
finality_updated_at  INTEGER (Unix timestamp)
created_at           INTEGER (Unix timestamp)
updated_at           INTEGER (Unix timestamp)
```

**Indexes:**
- `idx_events_chain_block` — Fast queries by chain + block number
- `idx_events_contract` — Fast queries by contract address
- `idx_events_type` — Fast queries by event type
- `idx_events_finality` — Fast queries by finality status

### Table: `alerts`
Stores generated alerts (both instant and aggregated).

**Columns:**
```sql
id                    INTEGER PRIMARY KEY
alert_id              TEXT UNIQUE
alert_type            TEXT ("instant" or "aggregated")
rule_id               TEXT (e.g., "whale_usdt_transfer")
rule_name             TEXT (e.g., "🐋 Whale USDT Transfer")
severity              TEXT (critical, high, medium, low)
chain                 TEXT
event_ids             TEXT (JSON array of event IDs)
event_count           INTEGER
from_block            INTEGER
to_block              INTEGER
window_start          INTEGER (for aggregated alerts)
window_end            INTEGER (for aggregated alerts)
data                  TEXT (JSON with full alert data)
notified              INTEGER (0 or 1)
notification_channels TEXT (JSON array, e.g., ["telegram", "console"])
created_at            INTEGER
```

---

## 🔍 How to Query the Database

### Method 1: Using EventRepository

```javascript
const { Database, EventRepository } = require("./src/db");
const config = require("./src/config");

const db = new Database(config.database);
await db.connect();
const eventRepo = new EventRepository(db);

// Get events by block range
const events = await eventRepo.getByBlockRange("ethereum", 24397100, 24397110, 100);

// Get events by contract
const usdcEvents = await eventRepo.getByContract("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 50);

await db.close();
```

### Method 2: Raw SQL Queries

```javascript
const db = new Database(config.database);
await db.connect();

// Custom query
const result = await db.query(`
  SELECT 
    block_number,
    event_name,
    contract_address,
    COUNT(*) as count
  FROM events
  WHERE event_type = 'ERC20_TRANSFER'
    AND block_number >= 24397100
  GROUP BY block_number, event_name, contract_address
  ORDER BY count DESC
  LIMIT 10
`);

console.log(result.rows);
await db.close();
```

### Method 3: Using Provided Scripts

```bash
# Inspect database contents
node scripts/inspect-db.js

# Run query examples
node scripts/query-examples.js
```

---

## 📦 Sample Event Record

```json
{
  "id": 8587,
  "event_id": "1:0xdf6c9034...cadb9:0x19ed37c0...7dc6:401",
  "chain": "ethereum",
  "chain_id": 1,
  "block_number": 24397119,
  "block_hash": "0xdf6c9034...cadb9",
  "block_timestamp": 1770372899,
  "tx_hash": "0x19ed37c0...7dc6",
  "log_index": 401,
  "contract_address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "event_name": "Transfer",
  "event_type": "ERC20_TRANSFER",
  "args": {
    "from": "0x...",
    "to": "0x...",
    "value": "1000000",
    "_rawValue": "1000000"
  },
  "finality": "pending",
  "finality_updated_at": 1770372902,
  "created_at": 1770372902,
  "updated_at": 1770372902
}
```

---

## ⚡ How Data Flows

```
┌─────────────────────┐
│ Blockchain (RPC)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Event Decoder       │  ← Decodes raw logs into GenesisEvents
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ EventRepository     │  ← Saves events to SQLite
│ .saveBatch()        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ SQLite Database     │  ← Persisted to data/genesis.db
│ (events table)      │
└─────────────────────┘
```

### Auto-Save Mechanism

Genesis saves the database:
1. **Every 5 seconds** (auto-save timer)
2. **After transactions commit** (manual save)
3. **On graceful shutdown** (cleanup)

This ensures data is never lost even if the process crashes.

---

## 🔄 Finality Progression

Events move through finality states as blocks confirm:

```
pending (0 blocks)
   ↓
soft_confirmed (3+ blocks)
   ↓
finalized (12+ blocks)
```

**Database updates:**
```javascript
// Finality Tracker detects block confirmations
finalityTracker.on("finality:upgraded", async (data) => {
  // Update all events that reached new finality
  await eventRepo.updateFinalityBatch([
    { eventId: "1:0xabc...:0xdef...:123", finality: "soft_confirmed" },
    { eventId: "1:0xabc...:0xghi...:456", finality: "finalized" }
  ]);
});
```

---

## 🚨 Alerts Storage

When a rule triggers, Genesis creates an alert record:

```javascript
// Example: Whale USDT transfer
{
  "alert_id": "instant:whale_usdt_transfer:1770372900123",
  "alert_type": "instant",
  "rule_id": "whale_usdt_transfer",
  "rule_name": "🐋 Whale USDT Transfer",
  "severity": "high",
  "chain": "ethereum",
  "event_count": 1,
  "from_block": 24397110,
  "to_block": 24397110,
  "data": "{...full alert payload...}",
  "notified": 1,
  "notification_channels": "[\"telegram\", \"console\"]",
  "created_at": 1770372900
}
```

---

## 📈 Query Performance

Genesis uses **indexes** for fast queries:

### Indexed Queries (Fast ⚡)
```sql
-- Query by block range (uses idx_events_chain_block)
SELECT * FROM events WHERE chain = 'ethereum' AND block_number >= 24397100;

-- Query by contract (uses idx_events_contract)
SELECT * FROM events WHERE contract_address = '0xA0b86...';

-- Query by type (uses idx_events_type)
SELECT * FROM events WHERE event_type = 'ERC20_TRANSFER';
```

### Non-Indexed Queries (Slower 🐌)
```sql
-- Full table scan (no index on args)
SELECT * FROM events WHERE args LIKE '%whale%';
```

**Tip:** Use indexed columns in `WHERE` clauses for best performance.

---

## 🛠️ Common Operations

### 1. Reset Database
```bash
# Delete database file
rm data/genesis.db

# Restart Genesis to create fresh database
node src/app.js
```

### 2. Backup Database
```bash
# Copy database file
cp data/genesis.db data/genesis_backup_$(date +%Y%m%d).db
```

### 3. Export to JSON
```javascript
const db = new Database(config.database);
await db.connect();

const result = await db.query("SELECT * FROM events");
const json = JSON.stringify(result.rows, null, 2);
fs.writeFileSync("events_export.json", json);
```

### 4. Count Events by Contract
```javascript
const result = await db.query(`
  SELECT contract_address, COUNT(*) as count
  FROM events
  GROUP BY contract_address
  ORDER BY count DESC
`);

for (const row of result.rows) {
  console.log(`${row.contract_address}: ${row.count} events`);
}
```

---

## 🔬 Advanced: Event Arguments

Event arguments are stored as JSON strings. To query them:

```javascript
// Fetch event
const result = await db.query(`
  SELECT args FROM events WHERE id = 8587
`);

// Parse JSON
const args = JSON.parse(result.rows[0].args);
console.log(args.from);    // "0x..."
console.log(args.to);      // "0x..."
console.log(args.value);   // "1000000"
```

**Example Transfer Event Args:**
```json
{
  "from": "0x1234567890123456789012345678901234567890",
  "to": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  "value": "1000000",
  "_rawValue": "1000000"
}
```

**Example Approval Event Args:**
```json
{
  "owner": "0x...",
  "spender": "0x...",
  "value": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  "_rawValue": "115792089237316195423570985008687907853269984665640564039457584007913129639935"
}
```

---

## 📊 Database Size Management

Current: **1.2 MB** (8,587 events)

Projected growth:
- **1 hour**: ~10K events ≈ 1.5 MB
- **1 day**: ~240K events ≈ 35 MB
- **1 week**: ~1.7M events ≈ 250 MB
- **1 month**: ~7M events ≈ 1 GB

**Cleanup strategies:**

### Option 1: Prune Old Events
```sql
-- Delete events older than 7 days
DELETE FROM events 
WHERE created_at < strftime('%s', 'now', '-7 days');

-- Vacuum to reclaim space
VACUUM;
```

### Option 2: Archive and Reset
```bash
# Move old database to archive
mv data/genesis.db data/genesis_$(date +%Y%m%d).db

# Fresh start
node src/app.js
```

### Option 3: Implement Auto-Pruning
Add to `src/db/database.js`:
```javascript
setInterval(async () => {
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
  await db.query("DELETE FROM events WHERE created_at < ?", [sevenDaysAgo]);
  console.log("🧹 [Database] Pruned old events");
}, 24 * 60 * 60 * 1000); // Run daily
```

---

## ✅ Summary

**What's Stored:**
- ✅ 8,587 decoded blockchain events (USDT, USDC, DAI transfers/approvals)
- ✅ 2 aggregated alerts
- ✅ Full event metadata (block, tx, contract, args, finality)
- ✅ Alert history with notification status

**How to Access:**
- ✅ `EventRepository` for programmatic access
- ✅ Raw SQL queries for custom analytics
- ✅ `scripts/inspect-db.js` for quick inspection
- ✅ `scripts/query-examples.js` for examples

**Auto-Managed:**
- ✅ Saves every 5 seconds
- ✅ Transaction support for batch operations
- ✅ Finality updates as blocks confirm
- ✅ Indexed for fast queries

---

**📖 Next Steps:**
- Run `node scripts/inspect-db.js` to explore the database
- Run `node scripts/query-examples.js` to see query patterns
- Check `db/schema.sql` for full schema details
