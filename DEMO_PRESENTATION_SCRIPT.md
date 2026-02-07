# 🧬 GENESIS — Demo Presentation Script

## Team B01 — CyreneAI / Genesis On-Chain Intelligence

> **Estimated Time:** 12–15 minutes
> **Format:** Live demo with running blockchain + real-time Telegram alerts

---

## 🎬 OPENING (30 seconds)

> *"Good morning/afternoon, judges. We're Team B01 and this is **Genesis** — a **real-time on-chain intelligence platform** that monitors smart contract events as they happen, enriches them with AI, and delivers personalized alerts to users via Telegram.*
>
> *Think of it as a **Bloomberg Terminal for blockchain** — but instead of watching stock tickers, you're watching on-chain transactions, governance votes, liquidity movements, and whale activity in real time."*

---

## 📐 SECTION 1: ARCHITECTURE OVERVIEW (2 minutes)

> *"Let me walk you through what we built and WHY each piece exists."*

### Why Local Blockchain (Hardhat)?

> *"We run on **Hardhat** — a local Ethereum development blockchain. Why?*
>
> *In production you'd connect to mainnet or a Layer-2 like Arbitrum. But for a hackathon demo, we need **deterministic control** — we need to trigger whale deposits, governance votes, and liquidity swaps on demand. You can't do that on a live chain.*
>
> *Hardhat gives us:*
> - *A full EVM with 20 pre-funded accounts (10,000 ETH each)*
> - *3-second block mining intervals (configurable — production chains have 12s for Ethereum, 2s for L2s)*
> - *`evm_increaseTime` and `evm_mine` RPC methods — we literally time-travel to test governance voting periods*
> - *Instant transaction finality for fast demo cycles*
>
> *Every single architectural decision we made works identically on mainnet. The ONLY change would be the RPC URL and chain ID."*

### What We'd Do With More Compute

> *"With production infrastructure, we would:*
> - *Connect to **multiple chains simultaneously** (Ethereum, Polygon, Arbitrum, Base) — our code already has multi-chain config in `chains.json`*
> - *Run **Alchemy/Infura WebSocket endpoints** instead of local HTTP polling*
> - *Deploy a **PostgreSQL or ClickHouse** database instead of SQLite for millions of events*
> - *Run the **LangChain AI agent continuously** instead of budget-limiting to 5 calls per session*
> - *Add **historical backfill** — replay past blocks to build statistical baselines for anomaly detection*
> - *Enable **real-time WebSocket subscriptions** (`eth_subscribe`) instead of polling at 2-second intervals"*

---

## 📜 SECTION 2: SMART CONTRACTS — The On-Chain Foundation (3 minutes)

> *"We wrote **8 Solidity smart contracts** from scratch in Solidity 0.8.24 with OpenZeppelin. Let me explain each one and why it matters."*

### Contract 1: GenesisToken (`GenesisToken.sol`)

> *"This is our **ERC-20 token** — we deploy TWO instances: `gUSD` (a mock stablecoin with 6 decimals like USDT) and `gETH` (mock ETH for the liquidity pool pair).*
>
> *We use 6 decimals intentionally — this mirrors real stablecoins (USDC, USDT). So when you see `100000000000` in raw form, that's `$100,000.00`. The owner can mint tokens for testing, and anyone can burn their own tokens."*

### Contract 2: GenesisVault (`GenesisVault.sol`) — **The Core**

> *"This is our **monitored vault** — the main event source. Every deposit, withdrawal, and internal transfer emits a Solidity `event`. These are the events Genesis captures in real time.*
>
> *Key blockchain features we showcase here:*
>
> 1. **Event-Driven Architecture** — Solidity `event` declarations are indexed by the EVM and stored in transaction receipt logs. Our off-chain listener subscribes to these via `ethers.js` `contract.on()`. This is how ALL blockchain monitoring works in production (Etherscan, Nansen, Dune Analytics).*
>
> 2. **Reentrancy Protection** — We use OpenZeppelin's `ReentrancyGuard` with the `nonReentrant` modifier. This prevents the classic reentrancy attack (like the 2016 DAO hack where $60M was drained). The modifier locks the contract during execution so recursive calls revert.*
>
> 3. **SafeERC20** — We use `SafeERC20.safeTransferFrom()` instead of raw `transfer()`. Why? Some ERC-20 tokens (like USDT) don't return `true` on success — they return nothing. `SafeERC20` handles all edge cases with a low-level call check.*
>
> 4. **Circuit Breaker Pattern** — The `pause()` / `unpause()` functions with `whenNotPaused` modifier. This is the same pattern used by MakerDAO, Compound, and Aave. If an exploit is detected, the admin pauses the contract instantly. We detect this on-chain and send an EMERGENCY alert to Telegram.*
>
> 5. **On-Chain Large Movement Detection** — The vault has a hardcoded `$100,000` threshold. When a deposit/withdrawal exceeds it, the contract itself emits `LargeMovement`. This is IN ADDITION to our off-chain ThresholdEngine thresholds — defense in depth.*
>
> 6. **Per-User Balance Accounting** — `mapping(address => uint256) public balances` tracks each user's deposit. This is a simplified version of what Aave's aTokens do."*

### Contract 3: ThresholdEngine (`ThresholdEngine.sol`) — **User-Customizable Alerts**

> *"This is one of our **most innovative contracts**. Instead of hardcoding alert thresholds in a backend database, we store them **ON-CHAIN**.*
>
> *Any user can call `setThreshold()` to create their own alert rule:*
> - *Token to monitor*
> - *Alert type: `LARGE_TRANSFER`, `WHALE_MOVEMENT`, `RAPID_FLOW`, or `CUSTOM`*
> - *Threshold amount (e.g., `$50,000`)*
> - *Cooldown period (prevent alert spam)*
> - *Human-readable description (stored on-chain!)*
>
> *The protocol owner can also set **global thresholds** that apply to everyone.*
>
> *Why on-chain? Because:*
> - *It's **auditable** — anyone can verify what thresholds exist*
> - *It's **tamper-proof** — no admin can secretly change your alert rules*
> - *It's **permissionless** — any wallet can set their own rules*
> - *Our off-chain listener calls `getActiveThresholds()` to load ALL rules and checks every transaction against them"*

### Contract 4: AlertRegistry (`AlertRegistry.sol`) — **Immutable Audit Trail**

> *"When Genesis fires an alert, we don't just send a Telegram message. We **write it back to the blockchain** via `recordAlert()`.*
>
> *This creates an **immutable, tamper-proof audit trail**. Nobody — not even us — can delete or modify a historical alert. It includes:*
> - *Who triggered it (wallet address)*
> - *Which token was involved*
> - *The amount*
> - *Severity level (LOW, MEDIUM, HIGH, CRITICAL)*
> - *A human-readable summary*
> - *Block number and timestamp*
>
> *Think of this as a **decentralized incident log**. In a regulated DeFi environment, this proves to auditors exactly what happened and when."*

### Contract 5: GenesisGovernance (`GenesisGovernance.sol`) — **DAO Voting**

> *"Full governance lifecycle — proposals, voting, execution:*
>
> - *`createProposal()` — anyone can propose (e.g., 'Increase vault threshold to $1M')*
> - *`castVote()` — token holders vote For/Against/Abstain with weight proportional to their balance*
> - *`finalizeProposal()` — checks quorum and majority after voting period ends*
> - *`executeProposal()` — makes the proposal official on-chain*
>
> *We use Hardhat's `evm_increaseTime` RPC call to fast-forward past the voting period in the demo — in production, you'd wait the actual duration (e.g., 3 days).*
>
> *Genesis monitors ALL governance events in real time — when a proposal is created, when votes come in, when it passes or fails. If you subscribed to Governance alerts on Telegram, you'd get notified for each one."*

### Contract 6: GenesisLiquidityPool (`GenesisLiquidityPool.sol`) — **DEX/AMM**

> *"This simulates a **Uniswap-style Automated Market Maker (AMM)** for the gUSD/gETH trading pair.*
>
> *It implements the **constant product formula**: `x × y = k`. When you swap token A for token B, the product of reserves must stay constant. The price is determined by the ratio of reserves.*
>
> *Key features:*
> - *`addLiquidity()` — deposit both tokens into the pool. LP shares are calculated using `√(amountA × amountB)` for the first deposit (like Uniswap V2)*
> - *`removeLiquidity()` — burn LP shares to withdraw proportional amounts*
> - *`swap()` — trade one token for another with a **0.3% fee** (same as Uniswap)*
> - *`LargeSwapDetected` event — fires when a swap exceeds 5% of reserves, with **price impact in basis points***
> - *`rebalance()` — owner can inject liquidity (simulates a market maker)*
>
> *Genesis catches every liquidity add, remove, swap, and large swap event."*

### Contract 7: GenesisVesting (`GenesisVesting.sol`) — **Token Vesting**

> *"Token vesting with cliff + linear unlock — exactly how real protocols distribute team/investor tokens.*
>
> - *`createVesting()` — lock tokens with a cliff period and total duration*
> - *After the cliff, tokens unlock linearly over time*
> - *`claim()` — beneficiary withdraws unlocked tokens*
> - *`revoke()` — owner can revoke unvested tokens (if team member leaves)*
> - *`UnlockMilestone` events at 25%, 50%, 75%, and 100% unlock*
>
> *We also have `simulateTimePass()` for the demo — this wouldn't exist in production. Time passes naturally on real chains."*

### Contract 8: GenesisReputation (`GenesisReputation.sol`)

> *"Placeholder for on-chain wallet reputation scoring. The off-chain WalletProfiler handles this currently."*

---

## ⚡ SECTION 3: EVENT ARCHITECTURE — How We Capture Everything (2 minutes)

> *"Now let me explain HOW Genesis actually captures and processes these events. This is the engineering core."*

### Event Emission → Capture (Inbound)

> *"When a Solidity function runs, `emit` writes to the **EVM log storage** — these are part of the transaction receipt. They're NOT stored in contract state — they're cheaper (fewer gas) and designed for off-chain consumption.*
>
> *Our `ContractListener` class (Node.js, ethers.js v6) subscribes to each contract's events using `contract.on('EventName', callback)`. Under the hood, ethers.js calls `eth_getLogs` or `eth_subscribe` (WebSocket) on the RPC node.*
>
> *We subscribe to **26 distinct event types** across all 8 contracts:*
> - *Vault: `Deposit`, `Withdrawal`, `InternalTransfer`, `LargeMovement`, `EmergencyAction` (5)*
> - *Token: `Transfer` (1)*
> - *ThresholdEngine: `ThresholdSet`, `ThresholdUpdated`, `ThresholdRemoved`, `GlobalThresholdSet` (4)*
> - *AlertRegistry: `AlertRecorded` (1)*
> - *Governance: `ProposalCreated`, `VoteCast`, `ProposalExecuted`, `ProposalCancelled`, `ProposalStateChanged` (5)*
> - *LiquidityPool: `LiquidityAdded`, `LiquidityRemoved`, `Swap`, `LargeSwapDetected`, `PoolRebalanced` (5)*
> - *Vesting: `VestingCreated`, `TokensClaimed`, `VestingRevoked`, `UnlockMilestone` (4)*
> - *Token (gETH): `Transfer` (1)"*

### The Processing Pipeline (Event → Alert → User)

> *"Every captured event flows through a **7-stage pipeline**:*
>
> **Stage 1 — Event Model (Reorg-Safe IDs)**
> *Each event gets a deterministic ID: `(chain_id, block_hash, tx_hash, log_index)`. If a chain reorganization occurs and block 100 gets replaced, the new block 100 has a DIFFERENT block hash — so the old events automatically become invalid. This is how we handle reorgs cleanly.*
>
> **Stage 2 — Finality Tracker**
> *Events aren't binary "confirmed" or "not". They carry a confidence score that upgrades over time:*
> - *`pending` → just seen (0 confirmations)*
> - *`soft_confirmed` → 1+ confirmations*
> - *`finalized` → 3+ confirmations (for Hardhat; on mainnet this would be 32+ blocks)*
> - *`reverted` → invalidated by a reorg*
>
> *This matters on real chains — you don't want to alert on a transaction that gets reorged out!*
>
> **Stage 3 — Rule Evaluator**
> *Events are checked against all active rules — both from our `rules/` config files AND dynamically injected rules for deployed contracts. Rules can filter on: chain, event type, contract address, amount thresholds, and finality status. This is **selective indexing** — the big cost saver. We only process deeply what matches a rule.*
>
> **Stage 4 — Noise Filter (Anti-Spam)**
> *Three techniques:*
> - *Cooldowns — suppress duplicate alerts for the same rule within N seconds*
> - *Dedup — skip events with the same ID (reorg replays)*
> - *Severity threshold — only pass alerts above a minimum severity*
>
> **Stage 5 — Aggregator (Window Grouping)**
> *Instead of sending 100 individual "$1,000 transfer" alerts, the Aggregator groups them: "Wallet 0xABC sent $130K across 14 txs in 5 minutes." It uses configurable time windows and group-by fields. Critical/high severity events still fire instantly AND get aggregated.*
>
> **Stage 6 — Anomaly Detector (Z-Score)**
> *Statistical outlier detection using **z-scores**. We track historical transfer amounts per token and calculate:*
> - *z ≥ 3.0σ → CRITICAL anomaly (99.7% confidence it's unusual)*
> - *z ≥ 2.0σ → HIGH*
> - *z ≥ 1.5σ → MEDIUM*
>
> *Example: If the average deposit is $50K and someone deposits $500K, that's ~3σ above the mean.*
>
> **Stage 7 — Wallet Profiler (Cross-Contract Intelligence)**
> *This is our **key differentiator**. Most monitoring tools watch one contract at a time. Our WalletProfiler correlates activity ACROSS all 8 contracts to detect patterns like:*
> - *🔄 **Wash Trading** — deposit → swap → withdraw in rapid succession*
> - *⚡ **Flash Patterns** — deposit → immediate withdraw (exploit probing)*
> - *📈 **Velocity Anomalies** — sudden spike in transaction frequency*
> - *🔗 **Cross-Contract Correlations** — same wallet touching vault + pool + governance*
>
> *Each wallet gets a **dynamic risk score (0-100)**. 0-25 is normal, 76-100 is high risk."*

---

## 🤖 SECTION 4: AI INTEGRATION — LangChain + Gemini (1 minute)

> *"We use **LangChain** with **Google Gemini 2.0 Flash** (free tier) for AI-powered event analysis.*
>
> *The flow: Raw blockchain event → LangChain prompt template → Gemini LLM → Structured JSON output (title, summary, severity, recommendation, risk score, pattern).*
>
> *The AI converts raw hex addresses and token amounts into plain English: 'Whale wallet deposited $500,000 into Genesis Vault — this represents significant capital accumulation and potential market positioning.'*
>
> *But here's the clever part — **AI Budget System**:*
> - *We limit to **5 Gemini API calls per session***
> - *A `_shouldUseAI()` filter only triggers AI for HIGH/CRITICAL severity alerts or when `amountRaw > 100,000,000,000` ($100K)*
> - *Everything else uses our **local `InsightFormatter`** — a hand-written formatter that produces similar output without any API call*
> - *This means we get intelligent alerts for the events that matter, and fast local formatting for the rest*
>
> *The `InsightFormatter` has **dedicated formatters for every event type**: deposits, withdrawals, large movements, whale alerts, governance proposals/votes/execution, liquidity adds/removes/swaps, vesting creation/claims/milestones, and threshold alerts. It produces structured output with title, summary, severity, and recommendation."*

---

## 📱 SECTION 5: TELEGRAM BOT — User-Driven Alerts (1 minute)

> *"The Telegram bot is **fully interactive** — users choose their own alerts via inline keyboard buttons."*

### The Flow

> 1. *Bot sends welcome message with buttons: `[🔔 Choose My Alerts] [📊 Get Report] [ℹ️ Help]`*
> 2. *User taps "Choose My Alerts" → sees **7 alert types**:*
>    - *💰 Large Transfer — deposits/withdrawals exceeding threshold*
>    - *🐋 Whale Movement — whale wallets moving big amounts*
>    - *⚡ Rapid Flow — rapid in/out flows (potential exploit)*
>    - *🔧 Custom — any event exceeding threshold*
>    - *💧 Liquidity Event — pool adds, removes, swaps & large swaps*
>    - *🏛️ Governance — proposals, votes, executions & cancellations*
>    - *📅 Vesting — vesting schedules, claims, revocations & milestones*
> 3. *User taps an alert type → sees **preset thresholds** (e.g., $10K, $50K, $100K, $500K) or enters a custom amount*
> 4. *Subscription is saved — only matching events will be delivered*
>
> *When an alert fires, it shows: which rule matched, the threshold that was exceeded, then the full AI-enriched analysis. **ZERO spam** — only events matching the user's chosen rules are sent.*
>
> *The bot also supports: viewing subscriptions, removing subscriptions, getting a full dashboard report, and adding more alerts after setup."*

---

## 🎮 SECTION 6: LIVE DEMO WALKTHROUGH (5 minutes)

> *"Let me run the demo live. I'll explain what's happening at each step."*

### Pre-Demo Setup

> *"I have three terminals open:*
> 1. *Hardhat node running (our local blockchain)*
> 2. *Contracts deployed (8 contracts with token distribution and approvals)*
> 3. *About to start the full pipeline demo"*

### Run Command

```bash
node scripts/run-full-demo.js
```

### What Happens (Narrate as it runs):

> **Phase 1 — Server Start:**
> *"First, the Express server starts on port 3001. The ContractListener connects to all 8 contracts and subscribes to 26 event types. The Pipeline Orchestrator initializes: Finality Tracker, Rule Evaluator, Noise Filter, Aggregator, Anomaly Detector, Wallet Profiler. The Telegram bot starts polling. SQLite database is initialized."*

> **Telegram Interaction (120-second window):**
> *"Now the bot sends an interactive welcome message to Telegram. The demo WAITS up to 120 seconds for you to choose alerts via real buttons. It polls every 2 seconds checking if you've selected any preferences. If you don't choose within 2 minutes, it falls back to sensible defaults."*

> *[Pick alerts on phone or let it timeout]*

> **Step 1: Normal Deposits**
> *"User1 deposits $10K, User2 deposits $25K. These emit `Deposit` events. Our listener catches them instantly, they flow through the pipeline — but because they're below most thresholds, they get local formatting only. No Telegram alerts (unless you set a very low threshold)."*

> **Step 2: Whale Deposit ($500K)**
> *"NOW the whale deposits $500K. Three things happen simultaneously:*
> 1. *The Vault contract emits `Deposit` AND `LargeMovement` (because $500K ≥ $100K hardcoded threshold)*
> 2. *Our ContractListener checks against ThresholdEngine — this triggers global thresholds*
> 3. *The Anomaly Detector flags it as a statistical outlier*
> 4. *If you subscribed to Large Transfer or Whale Movement on Telegram, you get an alert NOW"*

> **Step 3: Internal Transfer**
> *"User1 sends $5K to User2 INSIDE the vault — no token transfer on the ERC-20 contract. This is an accounting-level transfer, like Aave's internal balance system."*

> **Step 4: Custom Threshold (On-Chain!)**
> *"User1 calls `setThreshold()` on the ThresholdEngine smart contract — creates a personal $20K alert rule, then updates it to $15K. Both operations emit events that our listener catches, and the listener auto-reloads thresholds."*

> **Step 5: Whale Withdrawal ($200K)**
> *"Whale withdraws $200K. Triggers `LargeMovement` on-chain AND the ThresholdEngine rules."*

> **Step 6: Immutable Alert Registry**
> *"We write two alerts BACK to the blockchain via `AlertRegistry.recordAlert()`. These are now permanent, tamper-proof, and queryable by anyone."*

> **Step 7: Emergency Pause**
> *"The vault owner pauses the contract — ALL deposits and withdrawals are blocked instantly. This is a real circuit breaker used by DeFi protocols. We catch the `EmergencyAction` event and send a CRITICAL alert. Then we unpause."*

> **Step 8: Liquidity Pool**
> *"Deployer seeds the gUSD/gETH pool with $100K + $100K. User1 adds $50K each side. Whale adds $200K each. All emit `LiquidityAdded` events with LP shares minted, new reserves."*

> **Step 9: Swaps**
> *"User2 swaps $10K gUSD → gETH (normal swap). Then the whale swaps $200K gETH → gUSD — this triggers `LargeSwapDetected` because it exceeds 5% of reserves, with price impact calculated in basis points."*

> **Step 10: Remove Liquidity**
> *"User1 removes 50% of their LP position. Proportional amounts of both tokens are returned."*

> **Step 11: Vesting**
> *"We create a $100K vesting schedule for User1: 30-day total, 10-day cliff. Then we `simulateTimePass(15 days)` to move past the cliff. User1 claims their unlocked tokens — about 50% of the total."*

> **Step 12: Full Governance Lifecycle**
> *"A proposal is created: 'Increase vault threshold to $1M'. Three users vote — User1 FOR ($10K weight), User2 FOR ($5K), Whale AGAINST ($3K). We time-warp past the voting period, finalize (it passes with majority), and execute it on-chain. ALL of these emit governance events."*

> **BONUS: Intelligence Showcase**
> *"Finally, we fire rapid transactions to trigger the Wallet Profiler's pattern detection:*
> - *Flash pattern: User2 deposits $25K → immediately withdraws $24K*
> - *Velocity burst: Whale fires 4 deposits in rapid succession*
> - *Wash trade: User1 deposits → swaps → withdraws across vault + pool*
> - *Anomaly: Whale deposits $1M (10x their normal amount)"*

---

## 📊 SECTION 7: DASHBOARDS (30 seconds)

> *"We have three web dashboards running on `localhost:3001`:*
>
> 1. **Control Panel** (`/onchain`) — Deploy overview, vault stats, threshold controls
> 2. **Analytics Dashboard** (`/dashboard`) — 8 live stat cards, SQLite metrics, event breakdown chart, on-chain alerts panel, recent events table, use case grid. Polls the API every 2 seconds.
> 3. **Intelligence** (`/intelligence`) — Pipeline stats, wallet risk leaderboard, detected patterns, anomaly log"*

---

## 🏗️ SECTION 8: TECH STACK SUMMARY (30 seconds)

> *"Quick tech stack:*
>
> | Layer | Technology |
> |-------|-----------|
> | Blockchain | Hardhat, Solidity 0.8.24, OpenZeppelin Contracts |
> | Smart Contracts | 8 contracts (Token, Vault, ThresholdEngine, AlertRegistry, Governance, LiquidityPool, Vesting, Reputation) |
> | Blockchain Interaction | ethers.js v6 (contract factories, event subscriptions, BigInt math) |
> | Event Pipeline | 7-stage: EventModel → Finality → Rules → NoiseFilter → Aggregator → AnomalyDetector → WalletProfiler |
> | AI | LangChain + Google Gemini 2.0 Flash (budgeted 5 calls/session) |
> | Local AI | InsightFormatter (15+ dedicated event formatters, zero API cost) |
> | Notifications | Telegram Bot (inline keyboards, callback queries, interactive flow) |
> | Database | SQLite (sql.js — in-process, zero-dependency) |
> | Server | Express.js (REST API + SSE for real-time streaming) |
> | Frontend | 3 HTML dashboards with live polling |
> | Package Manager | npm, Hardhat Toolbox |"*

---

## 🎯 SECTION 9: KEY DIFFERENTIATORS (30 seconds)

> *"What makes Genesis unique among blockchain monitoring tools:*
>
> 1. **Everything is on-chain first** — thresholds, alert rules, audit trail. Not hidden in a database.
> 2. **Cross-contract intelligence** — WalletProfiler correlates activity across ALL 8 contracts. Most tools watch one contract.
> 3. **Reorg-safe** — our event IDs include block hash, so chain reorganizations are handled cleanly.
> 4. **Finality-aware** — events carry confidence scores that upgrade over time (pending → soft → finalized).
> 5. **User-driven alerts** — no spam. Users pick exactly what they want via Telegram buttons.
> 6. **AI with budget control** — smart use of free Gemini tier. AI for important alerts, local formatter for the rest.
> 7. **Statistical anomaly detection** — z-score based outlier detection, not just simple thresholds."*

---

## ❓ SECTION 10: ANTICIPATED JUDGE QUESTIONS & ANSWERS

### Q: "Why not use The Graph?"
> *"The Graph is excellent for indexed querying, but it's **retroactive** — you query historical data. Genesis is **real-time push**. We catch events as they're mined and push alerts within seconds. In production, you'd use both: The Graph for historical queries, Genesis for live monitoring."*

### Q: "How does this handle chain reorgs?"
> *"Every event gets a reorg-safe ID: `(chainId, blockHash, txHash, logIndex)`. If a block is reorged, the replacement block has a different hash — so the old events naturally become invalid. Our FinalityTracker marks them as `reverted`."*

### Q: "Why store thresholds on-chain? Isn't that expensive?"
> *"Two reasons: **transparency** and **trustlessness**. Users can verify their alert rules exist. No admin can secretly change them. The gas cost is a one-time write (~$0.50 on mainnet, ~$0.01 on L2s). For a DeFi monitoring tool, that's trivial compared to the assets being monitored."*

### Q: "How would this scale to mainnet?"
> *"Replace `localhost:8545` with an Alchemy WebSocket endpoint. Replace SQLite with PostgreSQL or ClickHouse. Add a Redis message queue between the listener and pipeline for backpressure handling. Deploy the Express server on AWS/GCP with auto-scaling. The architecture is already separated into clean modules."*

### Q: "Why Gemini instead of GPT-4?"
> *"Free tier with generous rate limits — perfect for a hackathon. The LangChain abstraction means switching to GPT-4, Claude, or any LLM is a one-line change: just swap the model class."*

### Q: "What's the constant product formula?"
> *"In our AMM: `reserveA × reserveB = k` (constant). When you swap `dx` of token A, you get `dy = (dx × reserveB) / (reserveA + dx)` of token B, maintaining the invariant. This creates a price curve — the more you buy, the more expensive it gets (price impact). Our `LargeSwapDetected` event reports this impact in basis points."*

### Q: "What is selective indexing?"
> *"Most blockchains emit thousands of events per block. Processing ALL of them is expensive. Our Rule Evaluator only does deep processing (AI, anomaly detection, wallet profiling) on events that match an active rule. Everything else gets basic logging only. This is how production monitoring tools like Forta and Tenderly optimize costs."*

---

## 🎬 CLOSING (15 seconds)

> *"Genesis is a **complete, working on-chain intelligence platform** — not a mockup. 8 smart contracts, a 7-stage event pipeline, AI enrichment, interactive Telegram alerts, 3 live dashboards, and cross-contract intelligence. Everything runs live, everything is real, and every architectural decision maps to production blockchain infrastructure.*
>
> *Thank you. Happy to take questions."*

---

## 📋 QUICK REFERENCE: Demo Commands

```bash
# Terminal 1: Start blockchain
npx hardhat node

# Terminal 2: Deploy all 8 contracts
npx hardhat run scripts/deploy.js --network localhost

# Terminal 3: Run full pipeline demo
node scripts/run-full-demo.js

# Dashboards (open in browser):
# http://localhost:3001/onchain       — Control Panel
# http://localhost:3001/dashboard     — Analytics
# http://localhost:3001/intelligence  — AI Intelligence
```
