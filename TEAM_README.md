# 🧬 GENESIS — Real-Time On-Chain Intelligence & Monitoring System

> **Hackathon:** Genesis Hackathon — Problem Statement B01 (CyreneAI)
> **Team:** Aryan2052
> **Branch:** `sqlite-migration`
> **Tech Stack:** Solidity ^0.8.24 · Hardhat 3 · ethers.js v6 · Node.js · Express · LangChain + Gemini AI · SQLite · Telegram Bot · SSE

---

## 📋 Table of Contents

1. [What Is Genesis?](#1-what-is-genesis)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Smart Contracts (8 Contracts)](#3-smart-contracts-8-contracts)
4. [Off-Chain Engine Modules](#4-off-chain-engine-modules)
5. [AI Layer (LangChain + Gemini)](#5-ai-layer-langchain--gemini)
6. [Pipeline Orchestrator — The Brain](#6-pipeline-orchestrator--the-brain)
7. [Intelligence Layer (Wallet Profiler + Anomaly Detector)](#7-intelligence-layer-wallet-profiler--anomaly-detector)
8. [Database Layer (SQLite)](#8-database-layer-sqlite)
9. [Notification System (Telegram + SSE)](#9-notification-system-telegram--sse)
10. [Web Dashboards (3 Dashboards)](#10-web-dashboards-3-dashboards)
11. [Rule System (9 JSON Rule Files)](#11-rule-system-9-json-rule-files)
12. [Demo Script — The 12-Step Live Demo](#12-demo-script--the-12-step-live-demo)
13. [Complete File Structure](#13-complete-file-structure)
14. [How To Run](#14-how-to-run)
15. [Environment Variables](#15-environment-variables)
16. [API Endpoints](#16-api-endpoints)

---

## 1. What Is Genesis?

**Genesis** is a production-grade, real-time blockchain monitoring and intelligence system. It watches on-chain activity (deposits, withdrawals, swaps, governance votes, vesting events, etc.), runs every event through a multi-stage analysis pipeline, and delivers human-readable AI-powered alerts via Telegram and live web dashboards.

**In simple terms:** Smart Contracts emit events → Genesis catches them instantly → AI analyzes them → You get a Telegram message explaining what happened in plain English, plus a risk assessment.

### Key Selling Points for Judges:
- **8 custom smart contracts** — not just toy contracts, a full DeFi ecosystem
- **6-stage processing pipeline** — Rules → Noise Filter → Aggregator → Anomaly Detection → Wallet Profiling → AI Enrichment
- **AI-first architecture** — LangChain + Gemini turns raw hex data into human-readable insights
- **Immutable audit trail** — Alerts are stored ON-CHAIN in `AlertRegistry` (tamper-proof)
- **Statistical anomaly detection** — Z-score based outlier detection on transfer amounts
- **Cross-contract wallet profiling** — Tracks wallet behavior across ALL contracts, assigns risk scores
- **3 live dashboards** — Control Panel, Analytics, and Intelligence Dashboard
- **SQLite persistence** — Every event and alert is stored locally for historical queries
- **Telegram real-time alerts** — Instant notifications with AI-generated summaries

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SOLIDITY SMART CONTRACTS                      │
│  GenesisToken · GenesisVault · ThresholdEngine · AlertRegistry  │
│  GenesisVesting · GenesisGovernance · GenesisLiquidityPool      │
│                    (Hardhat Local Node — port 8545)              │
└────────────────────────────┬────────────────────────────────────┘
                             │ Solidity events (emit)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                CONTRACT LISTENER (src/contract-listener.js)      │
│   ethers.js v6 subscriptions → EventEmitter                     │
│   Listens to: Deposit, Withdrawal, LargeMovement, Swap,        │
│   VoteCast, VestingCreated, ThresholdSet, AlertRecorded, etc.   │
└────────────────────────────┬────────────────────────────────────┘
                             │ Node.js EventEmitter
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              PIPELINE ORCHESTRATOR (The Brain)                   │
│                                                                  │
│  Stage 1: EventModel ──── Reorg-safe unique event IDs           │
│  Stage 2: FinalityTracker ── pending → soft → finalized         │
│  Stage 3: RuleEvaluator ──── Match events against JSON rules    │
│  Stage 4: NoiseFilter ────── Cooldowns, dedup, severity gate    │
│  Stage 5: Aggregator ────── Window-based event batching         │
│  Stage 6: AnomalyDetector ── Z-score statistical outliers       │
│  Stage 7: WalletProfiler ── Cross-contract risk scoring         │
│                                                                  │
└──────┬──────────────┬────────────────┬─────────────┬────────────┘
       │              │                │             │
       ▼              ▼                ▼             ▼
  ┌─────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐
  │ AI Layer│  │  Telegram   │  │  SQLite DB │  │ SSE/Web  │
  │ Gemini  │  │  Bot Alerts │  │ Persistence│  │Dashboards│
  └─────────┘  └────────────┘  └────────────┘  └──────────┘
```

### Data Flow (for a single event):

1. A user calls `vault.deposit(10000)` on the Hardhat blockchain
2. Solidity emits `Deposit(user, 10000, newBalance, timestamp)`
3. `ContractListener` catches it via ethers.js event subscription
4. Listener emits `"event"` on its EventEmitter
5. `PipelineOrchestrator.processEvent()` is called:
   - Creates a reorg-safe event ID
   - Tracks finality (pending → confirmed)
   - Evaluates against all loaded rules (JSON files + dynamic local rules)
   - Passes through noise filter (cooldowns + dedup)
   - Feeds into aggregator (window-based batching)
   - Runs anomaly detection (z-score on amount)
   - Profiles the wallet (risk scoring, pattern detection)
6. `InsightFormatter` calls LangChain + Gemini AI to generate a human-readable insight
7. The enriched event is:
   - Broadcast via SSE to all connected dashboards
   - Sent to Telegram as a formatted alert
   - Saved to SQLite database
   - Logged in the intelligence feed

---

## 3. Smart Contracts (8 Contracts)

All contracts are in `contracts/` and compiled with Solidity `^0.8.24` using OpenZeppelin v5.4.

### 3.1 `GenesisToken.sol` — ERC20 Token (deployed TWICE)
- **Purpose:** The monitored token. Deployed as **gUSD** (stablecoin, 6 decimals, 10M supply) and **gETH** (mock ETH for LP pair).
- **Features:** Standard ERC20 + `mint()` (owner only) + `burn()`. Configurable name, symbol, and decimals.
- **Why two tokens?** The liquidity pool needs a trading pair (gUSD/gETH).

### 3.2 `GenesisVault.sol` — Token Vault with Event Monitoring
- **Purpose:** Central vault where users deposit/withdraw tokens. This is the CORE contract Genesis monitors.
- **Events emitted:**
  - `Deposit(user, amount, newBalance, timestamp)`
  - `Withdrawal(user, amount, remainingBalance, timestamp)`
  - `InternalTransfer(from, to, amount, timestamp)`
  - `LargeMovement(user, movementType, amount, thresholdUsed, timestamp)` — auto-triggered when amount ≥ $100K
  - `EmergencyAction(action, triggeredBy, timestamp)` — pause/unpause
- **Security:** ReentrancyGuard, Ownable, `whenNotPaused` modifier, SafeERC20.
- **Blockchain features demonstrated:** Event-driven architecture, per-user balance accounting, circuit-breaker pattern (emergency pause), reentrancy protection.

### 3.3 `ThresholdEngine.sol` — On-Chain Configurable Alert Rules
- **Purpose:** Users can register their OWN alert thresholds on-chain. Genesis reads these to decide when to fire alerts.
- **Features:**
  - Per-user custom rules (token, alert type, threshold, cooldown, description)
  - Global default rules (set by owner)
  - 4 alert types: `LARGE_TRANSFER`, `WHALE_MOVEMENT`, `RAPID_FLOW`, `CUSTOM`
  - Events: `ThresholdSet`, `ThresholdUpdated`, `ThresholdRemoved`, `GlobalThresholdSet`
- **Why this is special:** Fully on-chain configuration — no off-chain database needed for rules. Anyone can query and verify threshold rules.

### 3.4 `AlertRegistry.sol` — Immutable On-Chain Alert Log
- **Purpose:** Tamper-proof, immutable audit trail of every alert Genesis fires.
- **Features:**
  - Alerts can NEVER be edited or deleted (true blockchain immutability)
  - Each alert stores: `triggeredBy`, `token`, `amount`, `severity`, `alertType`, `summary`, `blockNumber`, `timestamp`
  - Authorized recorders only (access control)
  - Events: `AlertRecorded(alertId, triggeredBy, token, amount, severity, alertType, summary, blockNumber, timestamp)`
- **Why this matters:** Anyone can independently verify that an alert was real. The alert history lives on the blockchain, not in a private database.

### 3.5 `GenesisVesting.sol` — Token Vesting with Cliff + Linear Unlock
- **Purpose:** Lock tokens for team/investors with time-based release schedules.
- **Features:**
  - Create vesting schedule: beneficiary, total amount, cliff duration, vesting duration
  - Cliff period — no tokens unlockable until cliff passes
  - Linear vesting — tokens unlock gradually after cliff
  - Claim — beneficiary claims unlocked tokens
  - Revoke — owner can revoke unvested tokens
  - `simulateTimePass(scheduleId, seconds)` — for demo purposes, shifts the start time backward
  - Milestone events: `cliff_reached`, `25_percent`, `50_percent`, `75_percent`, `fully_vested`
- **Events:** `VestingCreated`, `TokensClaimed`, `VestingRevoked`, `UnlockMilestone`

### 3.6 `GenesisGovernance.sol` — On-Chain Governance (Proposals + Voting)
- **Purpose:** Decentralized proposal creation, voting, and execution.
- **Features:**
  - Anyone can create a proposal (with configurable title, description, duration)
  - Token holders vote: For / Against / Abstain (with weight and reason)
  - Configurable voting duration and quorum
  - Proposal states: `Active → Passed/Failed → Executed/Cancelled`
  - `finalizeProposal()` — checks if voting period ended, sets Passed/Failed
  - `executeProposal()` — executes a passed proposal
  - `cancelProposal()` — proposer or owner can cancel
- **Events:** `ProposalCreated`, `VoteCast`, `ProposalStateChanged`, `ProposalExecuted`, `ProposalCancelled`, `GovernanceConfigChanged`

### 3.7 `GenesisLiquidityPool.sol` — AMM DEX (Uniswap-style)
- **Purpose:** Simplified constant-product AMM pool (gUSD/gETH pair).
- **Features:**
  - `addLiquidity(amountA, amountB)` — deposit both tokens, receive LP shares
  - `removeLiquidity(shares)` — withdraw proportional amounts
  - `swap(tokenIn, amountIn, minOut)` — constant-product swap with 0.3% fee
  - LP share tracking (internal, not ERC20)
  - Large swap detection (price impact > 5% auto-alerts)
  - Pool stats: TVL, reserves, total swaps, fees collected
- **Events:** `LiquidityAdded`, `LiquidityRemoved`, `Swap`, `PoolRebalanced`, `LargeSwapDetected`

### 3.8 `GenesisReputation.sol` — (Placeholder)
- Empty file reserved for future on-chain reputation scoring.

---

## 4. Off-Chain Engine Modules

All modules live in `src/engine/` and are connected via the `PipelineOrchestrator`.

### 4.1 `RuleLoader` (`src/engine/rule-loader.js`)
- Loads alert rules from JSON files in `rules/` directory
- Supports hot-reloading (watches for file changes)
- Rules define: event type, contract addresses, conditions (gte/lte/eq), severity, cooldowns, aggregation windows

### 4.2 `RuleEvaluator` (`src/engine/rule-evaluator.js`)
- Takes a normalized event and evaluates it against ALL loaded rules
- Supports condition operators: `gte`, `lte`, `gt`, `lt`, `eq`, `neq`, `in`, `contains`
- Returns list of matching rules with their metadata

### 4.3 `NoiseFilter` (`src/engine/noise-filter.js`)
- Prevents alert fatigue by filtering duplicate/low-severity events
- Features: Per-rule cooldowns, event deduplication, minimum severity gate
- Configurable: `setMinSeverity("low")` passes everything in demo mode

### 4.4 `Aggregator` (`src/engine/aggregator.js`)
- Groups related events within time windows (e.g., "5 whale deposits in 60 seconds")
- Emits `alert:aggregated` with summary (total amount, count, etc.)
- Configurable per-rule: `window_sec`, `group_by` fields, `summary` type

### 4.5 `AnomalyDetector` (`src/engine/anomaly-detector.js`)
- Statistical outlier detection using **z-score analysis**
- Maintains a rolling window of transfer amounts per token
- Flags transfers where `|z-score| > 2.0` as anomalies
- Returns: `{ z_score, mean, std_dev, confidence_level, description }`

### 4.6 `WalletProfiler` (`src/engine/wallet-profiler.js`) — 🆕 Custom Built
- Cross-contract wallet behavior profiling with risk scoring
- Extends EventEmitter, emits `"pattern"` events
- **Tracks per wallet:** Total tx count, total volume, contracts touched, action breakdown
- **Pattern Detection:**
  - `velocity_spike` — >5 transactions in 60 seconds
  - `flash_pattern` — deposit followed by withdrawal within 30 seconds
  - `whale_activity` — single transaction >$100K
  - `multi_contract` — wallet interacts with >3 different contracts
- **Risk Scoring:** Base score per action type + severity bonuses for detected patterns
  - Levels: `low` (0-25) / `medium` (25-50) / `high` (50-75) / `critical` (75-100)
- **API methods:** `recordAction()`, `getProfile(address)`, `getRiskLeaderboard()`, `getRecentPatterns()`, `getStats()`

---

## 5. AI Layer (LangChain + Gemini)

### 5.1 `GenesisLangChainAgent` (`src/ai/langchain-agent.js`)
- Uses **Google Gemini 2.0 Flash** (free tier) via **LangChain.js**
- Converts raw blockchain events into structured insights:
  - Plain English explanation
  - Risk assessment (1-10)
  - Actionable recommendation
  - Severity classification
- **Smart rate limiting:** Auto-disables after 3 consecutive API failures (prevents cascading errors)
- **Graceful degradation:** If AI is unavailable, the system still works with local formatters

### 5.2 `InsightFormatter` (`src/ai/insight-formatter.js`)
- **~20 local formatter functions** for every event type (deposit, withdrawal, swap, vote, vest, etc.)
- Each formatter produces: `{ title, summary, details, severity, recommendation }`
- AI-first with local fallback: tries Gemini first, falls back to local if API fails
- `toTelegram(insight)` — formats insight for Telegram HTML messages

### 5.3 `CyreneAgent` (`src/ai/cyrene-agent.js`)
- Bridge to CyreneAI system (the hackathon's AI partner)
- Prompt templates stored in `config/cyrene-prompts.json`

---

## 6. Pipeline Orchestrator — The Brain

**File:** `src/pipeline-orchestrator.js`

This is the **central nervous system** that connects ALL engine modules into a unified processing pipeline.

### Constructor:
```
new PipelineOrchestrator({ deployment })
```
Takes the parsed `deployments/localhost.json` and:
1. Creates a `FinalityTracker` (soft confirm = 1 block, finalized = 3 blocks)
2. Loads rules from `rules/` directory via `RuleLoader`
3. **Injects dynamic local rules** for deployed contracts (see below)
4. Creates `RuleEvaluator`, `NoiseFilter`, `Aggregator`, `AnomalyDetector`, `WalletProfiler`
5. Wires internal event listeners (finality upgrades, aggregated alerts, wallet patterns)

### Dynamic Local Rules (auto-generated from deployment):
The orchestrator reads the deployment config and creates rules automatically:
- `local_large_deposit` — Vault deposit ≥ $100K → severity: high
- `local_large_withdrawal` — Vault withdrawal ≥ $50K → severity: high
- `local_vault_pause` — Vault emergency pause → severity: critical
- `local_large_swap` — Pool swap ≥ $50K → severity: medium
- `local_governance_proposal` — New proposal → severity: medium
- `local_governance_vote` — Vote cast → severity: low (aggregated in 30s windows)
- `local_onchain_alert` — Alert recorded on-chain → severity: high

### `processEvent(event)` — The Main Pipeline:
```
Stage 1: Normalize → create reorg-safe ID
Stage 2: Track finality (pending → soft → finalized)
Stage 3: Evaluate against ALL rules → get matches
Stage 4: Noise filter each match → pass to aggregator
Stage 5: Anomaly detection on amount → z-score analysis
Stage 6: Wallet profiling → risk score + pattern detection
Returns: { ruleMatches, anomaly, walletProfile, filtered }
```

### `getFullPipelineStats()` — Comprehensive Stats:
Returns deep stats for ALL modules: events processed, rule matches, noise filtered, aggregated alerts, anomalies detected, finality upgrades, plus per-module stats (rule list, filter stats, aggregator stats, wallet stats, finality stats).

---

## 7. Intelligence Layer (Wallet Profiler + Anomaly Detector)

### Intelligence Log:
The pipeline maintains an internal `intelligenceLog[]` array that captures:
- Anomaly events (with z-score, confidence level)
- Wallet pattern events (velocity spikes, flash patterns, whale activity)
- Aggregated alert summaries

### Intelligence API Endpoints:
- `GET /api/intelligence/stats` — Wallet + anomaly stats, recent patterns
- `GET /api/intelligence/wallets` — Risk leaderboard (sorted by risk score)
- `GET /api/intelligence/wallet/:address` — Full profile for a single wallet
- `GET /api/intelligence/patterns` — All detected patterns with breakdown
- `GET /api/intelligence/anomalies` — Statistical anomalies with token stats
- `GET /api/intelligence/pipeline` — **Full pipeline stats** (all modules)

---

## 8. Database Layer (SQLite)

**Files:** `src/db/database.js`, `src/db/event-repository.js`, `src/db/alert-repository.js`, `src/db/index.js`

- Uses **sql.js** (pure JavaScript SQLite — no native binaries needed)
- **Tables:**
  - `events` — All blockchain events (id, chain, chainId, blockNumber, txHash, eventType, args JSON, finality, timestamp)
  - `alerts` — All fired alerts (alertId, type, rule JSON, chain, events JSON, data JSON, notified, notifiedAt, channels)
- Auto-migration on startup
- Saved to `data/genesis.db`
- **API endpoints:**
  - `GET /api/history/stats` — Event count, alert count, event type breakdown
  - `GET /api/history/events` — Paginated event history
  - `GET /api/history/alerts` — Paginated alert history
  - `GET /api/db-status` — Connection health, size, path

---

## 9. Notification System (Telegram + SSE)

### Telegram Bot:
- Configured via `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`
- Sends HTML-formatted messages with:
  - Event title + emoji
  - Plain English summary (AI-generated)
  - Risk level + recommendation
- Rate-limited to prevent flooding

### Server-Sent Events (SSE):
- Endpoint: `GET /api/events`
- Pushes every event to all connected browser clients in real-time
- Events include: raw event data, AI insight, intelligence patterns, anomalies

---

## 10. Web Dashboards (3 Dashboards)

### 10.1 Control Panel (`/` → `public/onchain.html`)
- Real-time event feed (via SSE)
- On-chain vault stats (deposits, withdrawals, balance, paused status)
- On-chain alerts from AlertRegistry
- Threshold engine rules display
- Live event counter

### 10.2 Analytics Dashboard (`/dashboard` → `public/dashboard.html`)
- Historical analytics powered by SQLite
- Event type breakdown charts
- DB stats (size, event count, alert count)
- Recent events table

### 10.3 Intelligence Dashboard (`/intelligence` → `public/intelligence.html`) — 🆕
- **Wallet Risk Leaderboard** — Sorted by risk score, color-coded by level
- **Pattern Detection Feed** — Real-time velocity spikes, flash patterns, whale activity
- **Anomaly Alerts** — Z-score anomalies with confidence levels
- **Token Statistics** — Mean, standard deviation, sample size per token
- Polls intelligence API endpoints every 3 seconds

All dashboards have navigation links to each other.

---

## 11. Rule System (9 JSON Rule Files)

Located in `rules/` directory. Each rule is a JSON file defining:

| Rule File | What It Detects | Target | Severity |
|---|---|---|---|
| `whale-transfer.json` | USDT transfers > $100K | Mainnet USDT | high |
| `flash-loan-alert.json` | Aave V3 flash loans > $100K | Mainnet Aave | medium |
| `protocol-pause.json` | Protocol pause events | Any pausable | critical |
| `large-usdc-movement.json` | USDC transfers > $50K | Mainnet USDC | high |
| `large-uniswap-swap.json` | Uniswap V3 swaps > $50K | Mainnet Uniswap | medium |
| `liquidity-removal.json` | Large liquidity removals | Mainnet Uniswap | high |
| `dangerous-approval.json` | Unlimited token approvals | Any ERC20 | medium |
| `all-stablecoin-activity.json` | All stablecoin activity | USDT/USDC/DAI | low |
| `aave-liquidation.json` | Aave liquidation events | Mainnet Aave | high |

**Note:** These target mainnet Ethereum contracts. For the local Hardhat demo, the PipelineOrchestrator **auto-generates dynamic local rules** from the deployment config (see Section 6).

### Rule Structure:
```json
{
  "rule_id": "whale_usdt_transfer",
  "name": "🐋 Whale USDT Transfer",
  "event_type": "ERC20_TRANSFER",
  "contracts": ["0x..."],
  "conditions": { "amount_raw": { "gte": "100000000000" } },
  "aggregation": { "enabled": true, "window_sec": 60, "group_by": ["from", "contract"] },
  "cooldown_sec": 120,
  "severity": "high"
}
```

---

## 12. Demo Script — The 12-Step Live Demo

**File:** `scripts/run-full-demo.js` (~838 lines)

This is the **single-command demo** that starts the server, listener, and runs all 12 demo steps automatically.

### How It Works:
1. **Phase 1:** Starts Express server (port 3001) + ContractListener + PipelineOrchestrator + SQLite + AI Formatter
2. **Phase 2:** Runs 12 demo steps that execute real blockchain transactions
3. **Phase 3:** Displays comprehensive results (listener stats, AI stats, intelligence stats, pipeline stats, DB stats)

### The 12 Steps:

| Step | What Happens | Events Generated |
|---|---|---|
| 1 | Normal deposits ($10K, $25K) | `Deposit` × 2 |
| 2 | Whale deposit ($500K) | `Deposit` + `LargeMovement` |
| 3 | Withdrawals ($5K, $50K) | `Withdrawal` × 2 |
| 4 | Internal vault transfer ($8K) | `InternalTransfer` |
| 5 | Set custom alert threshold | `ThresholdSet` |
| 6 | Record alert on-chain | `AlertRecorded` |
| 7 | Emergency pause + unpause | `EmergencyAction` × 2 |
| 8 | Create vesting schedule | `VestingCreated` |
| 9 | Simulate time + claim vest | `TokensClaimed` + milestones |
| 10 | Add liquidity to DEX pool | `LiquidityAdded` |
| 11 | Execute swaps on DEX | `Swap` + `LargeSwapDetected` |
| **BONUS** | Intelligence stress test (rapid whale txs) | Multiple fast events |
| 12 | Governance: create proposal → vote → finalize → execute | `ProposalCreated` + `VoteCast` + `ProposalStateChanged` + `ProposalExecuted` |

### Expected Output:
- ~43+ events caught by listener
- 2+ large movement alerts
- Multiple AI-generated insights
- Telegram alerts sent (if configured)
- Wallet risk profiles built
- Anomalies detected
- All events persisted in SQLite

---

## 13. Complete File Structure

```
genesis_demo/
├── contracts/                          # 8 Solidity smart contracts
│   ├── GenesisToken.sol                # ERC20 token (deployed as gUSD + gETH)
│   ├── GenesisVault.sol                # Token vault with monitoring events
│   ├── ThresholdEngine.sol             # On-chain configurable alert thresholds
│   ├── AlertRegistry.sol               # Immutable on-chain alert log
│   ├── GenesisVesting.sol              # Token vesting (cliff + linear)
│   ├── GenesisGovernance.sol           # On-chain governance (proposals/voting)
│   ├── GenesisLiquidityPool.sol        # AMM DEX pool (gUSD/gETH)
│   └── GenesisReputation.sol           # (Placeholder for future)
│
├── src/                                # Node.js backend
│   ├── contract-listener.js            # Direct contract event subscriptions (724 lines)
│   ├── onchain-server.js               # Production Express server (~510 lines)
│   ├── pipeline-orchestrator.js        # 🧠 THE BRAIN — connects all modules (347 lines)
│   ├── app.js                          # Main app entry point
│   ├── api-server.js                   # API server
│   │
│   ├── ai/                             # AI Layer
│   │   ├── langchain-agent.js          # LangChain + Gemini integration (227 lines)
│   │   └── insight-formatter.js        # AI formatter + 20 local formatters (567 lines)
│   │
│   ├── engine/                         # Processing Engine
│   │   ├── rule-loader.js              # Load JSON rules from disk
│   │   ├── rule-evaluator.js           # Condition matching engine
│   │   ├── noise-filter.js             # Cooldowns, dedup, severity gate
│   │   ├── aggregator.js               # Time-window event batching
│   │   ├── anomaly-detector.js         # Z-score statistical outlier detection
│   │   ├── wallet-profiler.js          # 🆕 Cross-contract wallet risk scoring (290 lines)
│   │   └── index.js                    # Barrel export
│   │
│   ├── pipeline/                       # Event Processing Pipeline
│   │   ├── event-model.js              # Reorg-safe event IDs
│   │   ├── decoder.js                  # ABI event decoder
│   │   ├── finality.js                 # Finality tracker (pending→soft→finalized)
│   │   └── index.js                    # Barrel export
│   │
│   ├── observer/                       # Blockchain Observer (mainnet-oriented)
│   │   ├── block-tracker.js            # Block tracking
│   │   ├── log-fetcher.js              # Log fetching
│   │   ├── rpc-pool.js                 # RPC endpoint pooling
│   │   └── index.js                    # Barrel export
│   │
│   ├── db/                             # SQLite Database Layer
│   │   ├── database.js                 # sql.js connection + migrations
│   │   ├── event-repository.js         # Event CRUD
│   │   ├── alert-repository.js         # Alert CRUD
│   │   └── index.js                    # Barrel export
│   │
│   ├── notify/                         # Notification System
│   │   ├── dispatcher.js               # Multi-channel dispatcher
│   │   ├── retry.js                    # Retry logic
│   │   ├── templates.js                # Message templates
│   │   └── channels/
│   │       ├── telegram.js             # Telegram bot integration
│   │       ├── webhook.js              # Webhook notifications
│   │       └── console.js              # Console logging
│   │
│   ├── metrics/                        # System Metrics
│   │   ├── collector.js                # Metrics collection
│   │   └── server.js                   # Metrics endpoint
│   │
│   └── config/                         # Configuration
│       ├── chains.json                 # Multi-chain config
│       ├── index.js                    # Config loader
│       └── abis/                       # Standard ABIs
│           ├── erc20.json, erc721.json
│           ├── uniswap-v2.json, uniswap-v3.json
│           ├── aave-v3.json, pausable.json
│
├── scripts/                            # Deployment & Demo Scripts
│   ├── deploy.js                       # Deploy all 8 contracts (200 lines)
│   ├── run-full-demo.js                # 🎯 THE MAIN DEMO SCRIPT (838 lines)
│   ├── demo-onchain.js                 # Standalone demo (no server)
│   ├── presentation-demo.js            # Presentation mode
│   ├── multi-chain-demo.js             # Multi-chain demo
│   ├── inspect-db.js                   # SQLite inspector
│   ├── query-examples.js               # Example DB queries
│   ├── setup-db.js                     # DB setup script
│   ├── simulate-reorg.js               # Reorg simulation
│   └── mock-cyrene-agent.js            # Mock CyreneAI for testing
│
├── public/                             # Web Dashboards
│   ├── onchain.html                    # 🖥️ Control Panel (main dashboard)
│   ├── dashboard.html                  # 📊 Analytics Dashboard
│   ├── intelligence.html               # 🧠 Intelligence Dashboard (NEW)
│   └── index.html                      # Landing page
│
├── rules/                              # Alert Rule Definitions (9 JSON files)
│   ├── whale-transfer.json
│   ├── flash-loan-alert.json
│   ├── protocol-pause.json
│   ├── large-usdc-movement.json
│   ├── large-uniswap-swap.json
│   ├── liquidity-removal.json
│   ├── dangerous-approval.json
│   ├── all-stablecoin-activity.json
│   └── aave-liquidation.json
│
├── config/                             # Global Config
│   └── cyrene-prompts.json             # AI prompt templates
│
├── deployments/                        # Generated deployment addresses
│   └── localhost.json                  # Contract addresses after deploy
│
├── data/                               # SQLite database storage
│   └── genesis.db                      # Persistent event/alert store
│
├── docs/                               # Documentation
│   ├── PROJECT_SUMMARY.md
│   ├── HACKATHON_FEATURES_SUMMARY.md
│   ├── ANOMALY_DETECTION.md
│   ├── CYRENE_AI_INTEGRATION.md
│   ├── CYRENE_AI_SETUP.md
│   ├── DATABASE.md
│   └── PRESENTATION_SCRIPT.md
│
├── artifacts/                          # Hardhat compiled contracts (auto-generated)
├── cache/                              # Hardhat cache (auto-generated)
│
├── hardhat.config.js                   # Hardhat configuration (Solidity 0.8.24, optimizer, 3s mining)
├── package.json                        # Dependencies + npm scripts
├── .env                                # Environment variables (secrets)
├── .env.example                        # Template for .env
├── .gitignore
├── README.md
├── PLAN.md
├── ENHANCEMENTS.md
└── PHASE3_README.md
```

---

## 14. How To Run

### Prerequisites:
- **Node.js** v18 or higher
- **npm** (comes with Node)

### Step 1: Install Dependencies
```bash
cd genesis_demo
npm install
```

### Step 2: Set Up Environment Variables
```bash
# Copy the example and fill in your keys
cp .env.example .env
```
Edit `.env` and add:
- `GEMINI_API_KEY` — Get free from [Google AI Studio](https://aistudio.google.com/)
- `TELEGRAM_BOT_TOKEN` — Create via [@BotFather](https://t.me/BotFather) on Telegram
- `TELEGRAM_CHAT_ID` — Your chat/group ID

### Step 3: Compile Contracts
```bash
npx hardhat compile
```

### Step 4: Start Hardhat Node (Terminal 1)
```bash
npx hardhat node
```
This starts a local Ethereum blockchain on `http://127.0.0.1:8545` with auto-mining every 3 seconds.

### Step 5: Deploy Contracts (Terminal 2)
```bash
npx hardhat run scripts/deploy.js --network localhost
```
This deploys all 8 contracts and saves addresses to `deployments/localhost.json`.

### Step 6: Run the Full Demo (Terminal 3)
```bash
node scripts/run-full-demo.js
```
This:
1. Starts the Express server on port 3001
2. Starts the ContractListener
3. Initializes the PipelineOrchestrator with all engine modules
4. Connects SQLite
5. Runs all 12 demo steps
6. Displays comprehensive results

### Step 7: Open Dashboards
- **Control Panel:** http://localhost:3001
- **Analytics:** http://localhost:3001/dashboard
- **Intelligence:** http://localhost:3001/intelligence

---

## 15. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Optional | Google Gemini API key for AI insights. Without it, local formatters are used. |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token for real-time alerts |
| `TELEGRAM_CHAT_ID` | Optional | Telegram chat/group ID to send alerts to |
| `DATABASE_PATH` | Optional | SQLite DB path (default: `data/genesis.db`) |
| `ONCHAIN_PORT` | Optional | Server port (default: `3001`) |
| `INFURA_API_KEY` | Optional | For mainnet monitoring (not needed for demo) |
| `ALCHEMY_API_KEY` | Optional | For mainnet monitoring (not needed for demo) |

---

## 16. API Endpoints

### Core APIs:
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/events` | SSE stream — real-time event feed |
| GET | `/api/onchain-stats` | Listener stats + AI stats |
| GET | `/api/alerts` | On-chain alerts from AlertRegistry contract |
| GET | `/api/db-status` | SQLite connection health |

### History APIs (SQLite):
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/history/stats` | Event count, alert count, type breakdown |
| GET | `/api/history/events?limit=100` | Paginated event history |
| GET | `/api/history/alerts?limit=100` | Paginated alert history |

### Intelligence APIs:
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/intelligence/stats` | Wallet + anomaly stats, recent patterns |
| GET | `/api/intelligence/wallets` | Wallet risk leaderboard |
| GET | `/api/intelligence/wallet/:address` | Full wallet profile + patterns + actions |
| GET | `/api/intelligence/patterns?limit=50` | Detected patterns with breakdown |
| GET | `/api/intelligence/anomalies` | Z-score anomalies + token stats |
| GET | `/api/intelligence/pipeline` | **Full pipeline stats** (all 7 modules) |

### Dashboard Routes:
| Route | Dashboard |
|---|---|
| `/` | Control Panel |
| `/dashboard` | Analytics Dashboard |
| `/intelligence` | Intelligence Dashboard |

---

## 🏆 Why This Should Impress Judges

1. **Not a toy project** — 8 interconnected smart contracts forming a complete DeFi ecosystem (vault, DEX, governance, vesting, alerts, thresholds)
2. **Real event-driven architecture** — Zero polling, pure Solidity `emit` → ethers.js subscriptions → Node.js EventEmitter pipeline
3. **7-stage processing pipeline** — Events flow through normalization → finality tracking → rule evaluation → noise filtering → aggregation → anomaly detection → wallet profiling
4. **AI-powered insights** — LangChain + Gemini turns raw blockchain data into plain English with risk assessments and recommendations
5. **On-chain audit trail** — Alerts are stored immutably on the blockchain via `AlertRegistry` (not just a database)
6. **Statistical anomaly detection** — Z-score analysis identifies unusual transfer amounts automatically
7. **Cross-contract wallet intelligence** — Tracks wallet behavior across ALL contracts, detects velocity spikes, flash patterns, and whale activity
8. **Production patterns** — ReentrancyGuard, SafeERC20, circuit breakers, rate limiting, graceful degradation, hot-reloading rules
9. **Full persistence** — SQLite stores everything; dashboards can query historical data
10. **Single-command demo** — `node scripts/run-full-demo.js` runs the entire system end-to-end

---

*Last updated: February 7, 2026*
