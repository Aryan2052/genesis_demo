# Genesis — Implementation Plan

> A production-grade, signal-first blockchain monitoring system.
> Built incrementally on top of the existing `usdt_listener.js` proof-of-concept.

---

## 🧭 Current State → Target State

| Aspect | Now (PoC) | Target (Genesis) |
|---|---|---|
| Chains | Ethereum only | EVM-agnostic (Ethereum, Polygon, Arbitrum…) |
| Events | Raw USDT transfers | Any ERC-20/721/1155 + custom events |
| Filtering | None — prints everything | User-defined rules with aggregation |
| Finality | Ignores reorgs | Finality-weighted events with rollback |
| Notifications | Console.log | Webhook, Telegram, Email |
| Indexing | All USDT events | Selective — only what active rules need |
| Infra | Single Infura RPC | RPC pool with failover |
| Config | Hardcoded | `.env` + JSON rule files |

---

## 🏗️ Architecture → File Map

```
genesis_demo/
├── .env                          # API keys, secrets
├── package.json                  # Monorepo root
├── README.md
├── PLAN.md                       # ← this file
│
├── src/
│   ├── config/
│   │   ├── index.js              # Loads .env + defaults
│   │   ├── chains.json           # Chain definitions (RPC URLs, block times)
│   │   └── abis/                 # ABI fragments per event type
│   │       ├── erc20.json
│   │       ├── erc721.json
│   │       └── uniswap-v2.json
│   │
│   ├── observer/                 # LAYER 1: Observation
│   │   ├── rpc-pool.js           # Multi-provider with health checks
│   │   ├── block-tracker.js      # Tracks heads, detects reorgs
│   │   └── log-fetcher.js        # Selective eth_getLogs with topic filters
│   │
│   ├── pipeline/                 # LAYER 2: Event Normalization
│   │   ├── decoder.js            # ABI-decodes raw logs → canonical events
│   │   ├── event-model.js        # Canonical event schema + reorg-aware IDs
│   │   └── finality.js           # Finality tracker (pending → soft → final → reverted)
│   │
│   ├── engine/                   # LAYER 3: Rule & Signal Engine
│   │   ├── rule-loader.js        # Loads rules from JSON/DB
│   │   ├── rule-evaluator.js     # Matches events against rules
│   │   ├── aggregator.js         # Time-window aggregation (the "14 txs → $1.3M" logic)
│   │   └── noise-filter.js       # Cooldowns, dedup, z-score anomaly (future)
│   │
│   ├── notify/                   # LAYER 4: Notification Orchestrator
│   │   ├── dispatcher.js         # Routes alerts to channels
│   │   ├── channels/
│   │   │   ├── webhook.js        # HTTP POST with HMAC
│   │   │   ├── telegram.js       # Telegram Bot API
│   │   │   └── console.js        # Pretty console output (dev/demo)
│   │   ├── retry.js              # Exponential backoff + dead-letter
│   │   └── templates.js          # Alert formatting
│   │
│   ├── storage/                  # Optional persistence
│   │   ├── event-store.js        # Append-only event log (SQLite for MVP)
│   │   └── rule-store.js         # User rules CRUD
│   │
│   └── app.js                    # Main entry — wires everything together
│
├── rules/                        # User-defined rule files
│   ├── whale-transfer.json
│   ├── liquidity-removal.json
│   └── governance-proposal.json
│
├── test/
│   ├── observer.test.js
│   ├── decoder.test.js
│   ├── rule-evaluator.test.js
│   └── aggregator.test.js
│
└── scripts/
    ├── demo-polygon.js           # Live demo on Polygon
    └── simulate-reorg.js         # Reorg simulation for testing
```

---

## 🚀 Phased Build Plan

### Phase 1 — Foundation (Week 1-2) ✨ *Start here*
> Goal: Replace `usdt_listener.js` with a properly structured system that can monitor any ERC-20 on any EVM chain.

**Deliverables:**
1. **Config system** — `.env` for secrets, `chains.json` for multi-chain support
2. **RPC Pool** — 2-3 providers with automatic failover + health checks
3. **Block Tracker** — Follows chain head, detects forks/reorgs
4. **Event Decoder** — ABI-decodes any ERC-20 Transfer (not just USDT)
5. **Canonical Event Model** — Every event gets a reorg-safe ID: `(chain_id, block_hash, tx_hash, log_index)`
6. **Console Notifier** — Pretty-prints decoded events (replaces current `console.log`)

**Unique ideas implemented:**
- ✅ Reorg-aware event IDs
- ✅ Multi-chain from day 1
- ✅ Selective log fetching (only topics we care about)

---

### Phase 2 — Rule Engine (Week 3-4) 🧠 *The brain*
> Goal: Users define JSON rules; the system only alerts on what matters.

**Deliverables:**
1. **Rule Schema** — JSON format for defining alert conditions
2. **Rule Loader** — Reads rules from `rules/` directory
3. **Rule Evaluator** — Pattern-matches decoded events against active rules
4. **Selective Indexing** — Only subscribe to contracts/topics referenced by active rules (the 70-90% RPC savings)
5. **Basic Aggregation** — Time-window grouping ("14 txs in 5 min → $1.3M total")

**Unique ideas implemented:**
- ✅ Selective indexing (subscribe only to what rules need)
- ✅ Aggregation-first alerting (not raw event spam)
- ✅ Rule-driven architecture

---

### Phase 3 — Finality & Reorgs (Week 5) 🔒 *The differentiator*
> Goal: Events carry a confidence score; alerts upgrade/rollback with finality.

**Deliverables:**
1. **Finality Tracker** — Tags events as `pending → soft_confirmed → finalized`
2. **Reorg Detector** — Watches for block hash changes at same height
3. **Rollback Events** — Emits `reverted` status for reorged events
4. **User Finality Preference** — Rules specify when to fire (e.g., only after 12 confirmations)

**Unique ideas implemented:**
- ✅ Finality as a spectrum (not binary)
- ✅ Reorg-native design with rollback notifications
- ✅ Per-rule finality thresholds

---

### Phase 4 — Notifications (Week 6) 📣 *The output*
> Goal: Alerts go to Webhooks, Telegram, and Email — not just console.

**Deliverables:**
1. **Webhook Channel** — HTTP POST with HMAC signature
2. **Telegram Channel** — Bot API integration
3. **Retry Engine** — Exponential backoff, dead-letter queue
4. **Alert Templates** — Rich formatting with explorer links
5. **Idempotency** — Dedup keys prevent double-alerts

**Unique ideas implemented:**
- ✅ At-least-once delivery with idempotency
- ✅ HMAC-signed webhooks
- ✅ Dead-letter queue for failed deliveries

---

### Phase 5 — Sustainability & Polish (Week 7-8) 🌱 *The edge*
> Goal: Prove the cost/carbon savings; add anti-spam; prep for demo.

**Deliverables:**
1. **Metrics Dashboard** — Track RPC calls saved, events filtered, alerts sent
2. **Noise Filter** — Cooldowns, z-score anomaly detection
3. **Carbon-Aware Scheduling** — Batch non-urgent checks during low-activity periods
4. **Live Demo Script** — Polygon demo with rule creation → alert delivery → reorg simulation
5. **SQLite Event Store** — Persist finalized events for audit

**Unique ideas implemented:**
- ✅ Measurable cost/carbon reduction metrics
- ✅ Anti-spam (cooldowns + anomaly detection)
- ✅ Carbon-aware scheduling

---

## 🔧 Tech Stack (Concrete Choices)

| Component | Choice | Why |
|---|---|---|
| Runtime | **Node.js 20+** | Already using it; great for streaming |
| Blockchain | **ethers.js v6** | Already installed; clean event API |
| Config | **dotenv** | Simple `.env` loading |
| Streaming | **EventEmitter** (Phase 1) → **Redis Streams** (Phase 5) | Start simple, scale later |
| Rule Engine | **Custom JSON evaluator** | No heavy deps; full control |
| Storage | **SQLite via better-sqlite3** | Zero-config, fast, local |
| Notifications | **axios** (webhooks) + **node-telegram-bot-api** | Battle-tested |
| Testing | **vitest** | Fast, modern, zero-config |
| Scheduling | **node-cron** | Carbon-aware batch windows |

---

## 📐 Key Design Decisions

### 1. Why NOT Kafka/Redpanda for MVP?
Your research mentions Kafka for the streaming bus. For a working MVP/demo, **Node.js EventEmitter → Redis Streams** is the right progression:
- Phase 1-4: EventEmitter (zero infra, works locally)
- Phase 5+: Redis Streams (if scaling to multiple consumers)
- Production: Kafka/Redpanda (when you need durability + partitioning)

### 2. Why SQLite, not Postgres?
- Zero setup — `npm install better-sqlite3` and go
- Perfect for single-node demos
- Trivially replaceable with Postgres later (same SQL)

### 3. Why JSON rules, not a DSL?
- Parseable, validatable, serializable
- Easy to build a UI on top of later
- No parser to maintain

---

## 🎯 What Makes This System Unique (Pitch Points)

1. **Finality-Weighted Events** — No one else treats finality as a spectrum with per-rule thresholds
2. **Reorg-Native** — Built-in rollback semantics, not bolted on
3. **Selective Indexing** — 70-90% cheaper than "index everything" approaches
4. **Aggregation-First** — Users get *decisions*, not data dumps
5. **Sustainability Metrics** — Quantifiable cost/carbon savings
6. **Signal > Noise** — Cooldowns, aggregation, anomaly detection baked in

---

## ⚡ Quick Start (After Phase 1)

```bash
# 1. Clone & install
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your RPC keys

# 3. Run
node src/app.js

# 4. Add a rule
# Drop a JSON file in rules/ — system hot-reloads it
```

---

## 📊 Success Metrics

| Metric | Target |
|---|---|
| RPC calls vs naive indexer | **< 30%** (70% reduction) |
| Alert noise reduction | **< 10%** of raw events become alerts |
| Reorg detection | **100%** of reorgs caught within 2 blocks |
| Notification latency | **< 5s** from block confirmation to alert |
| Demo: rule → alert | **< 30s** end-to-end on Polygon |
