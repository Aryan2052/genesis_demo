/**
 * Genesis — On-Chain Demo Script (Full 12-Step)
 *
 * Performs REAL blockchain transactions on local Hardhat node:
 *   1.  Normal deposits (vault)
 *   2.  Whale movement (triggers LargeMovement event)
 *   3.  Internal vault transfer
 *   4.  User sets custom threshold (on-chain)
 *   5.  Whale withdrawal (large outbound)
 *   6.  Record alert to immutable AlertRegistry
 *   7.  Emergency pause/unpause
 *   8.  Liquidity: add liquidity to pool
 *   9.  Liquidity: swap tokens (simulated DEX trade)
 *   10. Liquidity: remove liquidity
 *   11. Vesting: create schedule + claim
 *   12. Governance: proposal → vote → finalize → execute
 *
 * Run AFTER:
 *   Terminal 1:  npx hardhat node
 *   Terminal 2:  npx hardhat run scripts/deploy.js --network localhost
 *   Terminal 3:  node src/contract-listener.js
 *   Terminal 4:  node scripts/demo-onchain.js
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// ── Helpers ──────────────────────────────────────────────────────────────
function loadDeployment() {
  const p = path.resolve(__dirname, "../deployments/localhost.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadABI(name) {
  const p = path.resolve(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(amount) {
  return (Number(amount) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║       🧬 GENESIS — Live On-Chain Demo (Full 12-Step)    ║");
  console.log("║       Token · Liquidity · Vesting · Governance          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();

  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const deployment = loadDeployment();
  const d = deployment.contracts;

  // Get signers (matching Hardhat's default accounts)
  const signers = await Promise.all(
    [0, 1, 2, 3].map(i => provider.getSigner(i))
  );
  const [deployer, user1, user2, whale] = signers;

  // Connect contracts
  const token = new ethers.Contract(d.GenesisToken.address, loadABI("GenesisToken"), deployer);
  const vault = new ethers.Contract(d.GenesisVault.address, loadABI("GenesisVault"), deployer);
  const thresholdEngine = new ethers.Contract(d.ThresholdEngine.address, loadABI("ThresholdEngine"), deployer);
  const alertRegistry = new ethers.Contract(d.AlertRegistry.address, loadABI("AlertRegistry"), deployer);

  const UNITS = (n) => BigInt(n) * 1_000_000n;

  // ══════════════════════════════════════════════════════════════════════
  //  PART 1: VAULT & TOKEN TRANSFERS
  // ══════════════════════════════════════════════════════════════════════

  // ── STEP 1: Normal deposits ───────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  📥 STEP 1: Normal Deposits");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let tx = await vault.connect(user1).deposit(UNITS(10_000));
  await tx.wait();
  console.log(`  ✅ User1 deposited $10,000 — tx: ${tx.hash.slice(0, 18)}...`);
  await sleep(2000);

  tx = await vault.connect(user2).deposit(UNITS(25_000));
  await tx.wait();
  console.log(`  ✅ User2 deposited $25,000 — tx: ${tx.hash.slice(0, 18)}...`);
  await sleep(2000);
  console.log();

  // ── STEP 2: Whale movement (triggers LargeMovement event) ─────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🐋 STEP 2: Whale Deposit — $500,000 (triggers on-chain alert!)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  tx = await vault.connect(whale).deposit(UNITS(500_000));
  await tx.wait();
  console.log(`  🚨 Whale deposited $500,000 — LARGE MOVEMENT emitted on-chain!`);
  await sleep(3000);
  console.log();

  // ── STEP 3: Internal transfer ─────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🔄 STEP 3: Internal Vault Transfer");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const user2Addr = await user2.getAddress();
  tx = await vault.connect(user1).internalTransfer(user2Addr, UNITS(5_000));
  await tx.wait();
  console.log(`  ✅ User1 → User2: $5,000 internal transfer (no token contract call!)`);
  await sleep(2000);
  console.log();

  // ── STEP 4: Custom threshold ──────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ⚙️  STEP 4: User Sets Custom Alert Threshold (on-chain!)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  tx = await thresholdEngine.connect(user1).setThreshold(
    d.GenesisToken.address, 0, UNITS(20_000), 60, "Alert me on gUSD transfers above $20K"
  );
  await tx.wait();
  console.log(`  ✅ User1 created custom threshold: $20K (stored ON-CHAIN)`);

  tx = await thresholdEngine.connect(user1).updateThreshold(0, UNITS(15_000));
  await tx.wait();
  console.log(`  ✅ User1 updated threshold: $20K → $15K`);
  await sleep(2000);
  console.log();

  // ── STEP 5: Whale withdrawal ──────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🐋 STEP 5: Whale Withdrawal — $200,000");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  tx = await vault.connect(whale).withdraw(UNITS(200_000));
  await tx.wait();
  console.log(`  🚨 Whale withdrew $200,000 — Outbound LARGE MOVEMENT!`);
  await sleep(3000);
  console.log();

  // ── STEP 6: Record alerts ─────────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  📝 STEP 6: Record Alert to Immutable On-Chain Registry");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const whaleAddr = await whale.getAddress();
  tx = await alertRegistry.recordAlert(
    whaleAddr, d.GenesisToken.address, UNITS(500_000), 2, "whale_deposit",
    "Whale deposited $500K into Genesis Vault — normal accumulation pattern"
  );
  await tx.wait();
  console.log(`  ✅ Alert recorded on-chain — IMMUTABLE and verifiable!`);

  tx = await alertRegistry.recordAlert(
    whaleAddr, d.GenesisToken.address, UNITS(200_000), 2, "whale_withdrawal",
    "Whale withdrew $200K from Genesis Vault — partial profit-taking"
  );
  await tx.wait();
  console.log(`  ✅ Second alert recorded on-chain`);
  await sleep(2000);
  console.log();

  // ── STEP 7: Emergency pause ───────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🛑 STEP 7: Emergency Vault Pause (circuit breaker!)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  tx = await vault.pause();
  await tx.wait();
  console.log(`  🛑 Vault PAUSED — no deposits or withdrawals possible!`);
  await sleep(2000);

  tx = await vault.unpause();
  await tx.wait();
  console.log(`  ✅ Vault UNPAUSED — operations resumed`);
  await sleep(2000);
  console.log();

  // ══════════════════════════════════════════════════════════════════════
  //  PART 2: LIQUIDITY MOVEMENTS (DEX Pool)
  // ══════════════════════════════════════════════════════════════════════

  if (d.GenesisLiquidityPool && d.GenesisETH) {
    const gETH = new ethers.Contract(d.GenesisETH.address, loadABI("GenesisToken"), deployer);
    const pool = new ethers.Contract(d.GenesisLiquidityPool.address, loadABI("GenesisLiquidityPool"), deployer);

    // ── STEP 8: Add liquidity ───────────────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  💧 STEP 8: Add Liquidity to gUSD/gETH Pool");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Deployer seeds the pool with initial liquidity
    tx = await pool.addLiquidity(UNITS(100_000), UNITS(100_000));
    await tx.wait();
    console.log(`  ✅ Deployer seeded pool: $100K gUSD + $100K gETH`);
    await sleep(2000);

    // User1 adds liquidity
    tx = await pool.connect(user1).addLiquidity(UNITS(50_000), UNITS(50_000));
    await tx.wait();
    console.log(`  ✅ User1 added liquidity: $50K gUSD + $50K gETH`);
    await sleep(2000);

    // Whale adds massive liquidity
    tx = await pool.connect(whale).addLiquidity(UNITS(500_000), UNITS(500_000));
    await tx.wait();
    console.log(`  🐋 Whale added liquidity: $500K gUSD + $500K gETH`);
    await sleep(2000);
    console.log();

    // ── STEP 9: Swap tokens (DEX trade) ─────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  🔁 STEP 9: Token Swaps (DEX Trading)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Normal swap: User2 swaps gUSD → gETH
    tx = await pool.connect(user2).swap(d.GenesisToken.address, UNITS(10_000));
    await tx.wait();
    console.log(`  ✅ User2 swapped $10K gUSD → gETH`);
    await sleep(2000);

    // Large swap: Whale swaps $200K (should trigger LargeSwapDetected)
    tx = await pool.connect(whale).swap(d.GenesisETH.address, UNITS(200_000));
    await tx.wait();
    console.log(`  🚨 Whale swapped $200K gETH → gUSD — LARGE SWAP detected!`);
    await sleep(3000);
    console.log();

    // ── STEP 10: Remove liquidity ───────────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  🔻 STEP 10: Remove Liquidity from Pool");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const user1LPBal = await pool.getLPBalance(await user1.getAddress());
    if (user1LPBal > 0n) {
      // Remove half of User1's LP position
      const sharesToRemove = user1LPBal / 2n;
      tx = await pool.connect(user1).removeLiquidity(sharesToRemove);
      await tx.wait();
      console.log(`  ✅ User1 removed 50% of LP position`);
    }
    await sleep(2000);

    // Show pool stats
    const [resA, resB, totalLP, swaps, feesA, feesB] = await pool.getPoolStats();
    console.log(`  📊 Pool: Reserves $${fmt(resA)}/$${fmt(resB)} | Swaps: ${swaps} | Fees: $${fmt(feesA)}+$${fmt(feesB)}`);
    await sleep(2000);
    console.log();
  } else {
    console.log("  ⚠️  LiquidityPool or gETH not deployed — skipping Steps 8-10");
    console.log();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PART 3: VESTING UNLOCKS
  // ══════════════════════════════════════════════════════════════════════

  if (d.GenesisVesting) {
    const vesting = new ethers.Contract(d.GenesisVesting.address, loadABI("GenesisVesting"), deployer);

    // ── STEP 11: Vesting — create schedule + claim ──────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  📅 STEP 11: Vesting — Create Schedule + Claim Tokens");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Create vesting: user1 gets 100K over 30 days with 10 day cliff
    const user1Addr = await user1.getAddress();
    tx = await vesting.createVesting(
      user1Addr,
      d.GenesisToken.address,
      UNITS(100_000),
      10 * 86400,  // 10 day cliff
      30 * 86400,  // 30 day total duration
      "Team allocation — 30 day vest with 10 day cliff"
    );
    await tx.wait();
    console.log(`  ✅ Vesting schedule created: User1 gets $100K over 30d (cliff: 10d)`);
    await sleep(2000);

    // Simulate time passing past the cliff (shifts startTime back)
    tx = await vesting.simulateTimePass(0, 15 * 86400);  // 15 days
    await tx.wait();
    console.log(`  ⏩ Simulated 15 days passing (past 10-day cliff)`);

    // Check claimable
    const claimable = await vesting.getClaimable(0);
    console.log(`  💰 User1 claimable: $${fmt(claimable)}`);

    if (claimable > 0n) {
      tx = await vesting.connect(user1).claim(0);
      await tx.wait();
      console.log(`  ✅ User1 claimed vested tokens!`);
    }
    await sleep(2000);

    // Get schedule info
    const info = await vesting.getScheduleInfo(0);
    console.log(`  📊 Vesting: claimed $${fmt(info.claimedAmount)}, ${info.vestingProgress}% complete`);
    await sleep(2000);
    console.log();
  } else {
    console.log("  ⚠️  GenesisVesting not deployed — skipping Step 11");
    console.log();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PART 4: GOVERNANCE ACTIONS
  // ══════════════════════════════════════════════════════════════════════

  if (d.GenesisGovernance) {
    const gov = new ethers.Contract(d.GenesisGovernance.address, loadABI("GenesisGovernance"), deployer);

    // ── STEP 12: Governance — proposal → vote → execute ─────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  🏛️  STEP 12: Governance — Full Lifecycle");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Create proposal (60 second voting period set in deploy)
    tx = await gov.createProposal(
      "Increase vault large-movement threshold to $1M",
      "The current $100K threshold generates too many alerts. Propose raising to $1M for better signal-to-noise.",
      60 // 60 second voting for demo
    );
    await tx.wait();
    console.log(`  ✅ Proposal #0 created — "Increase vault threshold to $1M"`);
    await sleep(2000);

    // Multiple users vote (castVote: proposalId, voteType, weight, reason)
    // VoteType: 0=Against, 1=For, 2=Abstain
    tx = await gov.connect(user1).castVote(0, 1, UNITS(10_000), "Too many false alerts");
    await tx.wait();
    console.log(`  🗳️  User1 voted FOR (weight: $10K)`);

    tx = await gov.connect(user2).castVote(0, 1, UNITS(5_000), "Agree — current threshold too low");
    await tx.wait();
    console.log(`  🗳️  User2 voted FOR (weight: $5K)`);

    tx = await gov.connect(whale).castVote(0, 0, UNITS(3_000), "I want to keep low threshold for safety");
    await tx.wait();
    console.log(`  🗳️  Whale voted AGAINST (weight: $3K)`);
    await sleep(2000);

    // Check vote results
    const voteResult = await gov.getVoteResult(0);
    console.log(`  📊 Votes: FOR=$${fmt(voteResult.forVotes)} vs AGAINST=$${fmt(voteResult.againstVotes)} | Quorum: ${voteResult.quorumReached ? "✅" : "❌"}`);

    // Fast-forward past voting period
    await provider.send("evm_increaseTime", [61]);
    await provider.send("evm_mine", []);
    console.log(`  ⏩ Time warped past voting period`);

    // Finalize (determine pass/fail)
    tx = await gov.finalizeProposal(0);
    await tx.wait();
    console.log(`  ✅ Proposal finalized`);
    await sleep(2000);

    // Execute if passed
    const proposalInfo = await gov.getProposalInfo(0);
    const stateNames = ["Active", "Passed", "Failed", "Executed", "Cancelled"];
    console.log(`  📋 Proposal state: ${stateNames[Number(proposalInfo.state)]}`);

    if (Number(proposalInfo.state) === 1) { // Passed
      tx = await gov.executeProposal(0);
      await tx.wait();
      console.log(`  ⚡ Proposal #0 EXECUTED — on-chain governance in action!`);
    } else {
      console.log(`  ℹ️  Proposal did not pass (state: ${stateNames[Number(proposalInfo.state)]})`);
    }
    await sleep(2000);
    console.log();
  } else {
    console.log("  ⚠️  GenesisGovernance not deployed — skipping Step 12");
    console.log();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  FINAL: On-Chain State Summary
  // ══════════════════════════════════════════════════════════════════════

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  📊 FINAL: On-Chain State Summary");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const [totalDep, totalWith, vaultBal, isPaused] = await vault.getVaultStats();
  console.log(`  Vault total deposits:    $${fmt(totalDep)}`);
  console.log(`  Vault total withdrawals: $${fmt(totalWith)}`);
  console.log(`  Vault current balance:   $${fmt(vaultBal)}`);
  console.log(`  Vault paused:            ${isPaused}`);
  console.log();

  const alertCount = await alertRegistry.alertCount();
  console.log(`  Alerts on-chain:         ${alertCount}`);

  if (d.GenesisLiquidityPool) {
    const pool = new ethers.Contract(d.GenesisLiquidityPool.address, loadABI("GenesisLiquidityPool"), deployer);
    const [rA, rB, , swaps] = await pool.getPoolStats();
    console.log(`  Pool reserves:           $${fmt(rA)} gUSD / $${fmt(rB)} gETH`);
    console.log(`  Total swaps:             ${swaps}`);
  }

  if (d.GenesisVesting) {
    const vesting = new ethers.Contract(d.GenesisVesting.address, loadABI("GenesisVesting"), deployer);
    const scheduleCount = await vesting.getScheduleCount();
    console.log(`  Vesting schedules:       ${scheduleCount}`);
  }

  if (d.GenesisGovernance) {
    const gov = new ethers.Contract(d.GenesisGovernance.address, loadABI("GenesisGovernance"), deployer);
    const proposalCount = await gov.getProposalCount();
    const totalVotes = await gov.totalVotesCast();
    console.log(`  Governance proposals:    ${proposalCount}`);
    console.log(`  Total votes cast:        ${totalVotes}`);
  }
  console.log();

  // Read back alerts
  console.log("  📜 Immutable Alert History (from blockchain):");
  for (let i = 0; i < Number(alertCount); i++) {
    const alert = await alertRegistry.getAlert(i);
    const sevNames = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    console.log(`     [#${alert.id}] ${sevNames[Number(alert.severity)]} | ${alert.alertType} | ${alert.summary.slice(0, 60)}...`);
  }

  console.log();
  console.log("  ════════════════════════════════════════════════════");
  console.log("  ✅ ON-CHAIN DEMO COMPLETE — ALL 4 MENTOR REQUIREMENTS");
  console.log("  ════════════════════════════════════════════════════");
  console.log();
  console.log("  HACKATHON REQUIREMENTS DEMONSTRATED:");
  console.log("    ✅ A. Token Transfers      — ERC20 Transfer events (Steps 1-5)");
  console.log("    ✅ B. Liquidity Movements   — DEX pool add/remove/swap (Steps 8-10)");
  console.log("    ✅ C. Vesting Unlocks       — Schedule, cliff, claim (Step 11)");
  console.log("    ✅ D. Governance Actions     — Proposal, vote, execute (Step 12)");
  console.log();
  console.log("  INFRASTRUCTURE FEATURES:");
  console.log("     1. ✅ Event-driven architecture (Solidity events)");
  console.log("     2. ✅ Inbound/outbound tracking (deposits/withdrawals)");
  console.log("     3. ✅ On-chain large movement detection");
  console.log("     4. ✅ User-customizable thresholds (stored on-chain)");
  console.log("     5. ✅ Internal vault transfers (Layer-2 pattern)");
  console.log("     6. ✅ Immutable alert registry (tamper-proof audit trail)");
  console.log("     7. ✅ Emergency circuit breaker (pause/unpause)");
  console.log("     8. ✅ AMM liquidity pool (constant-product swap)");
  console.log("     9. ✅ Swap fee collection (0.3% like Uniswap)");
  console.log("    10. ✅ Large swap detection (price impact alerts)");
  console.log("    11. ✅ Token vesting with cliff + linear unlock");
  console.log("    12. ✅ On-chain governance lifecycle");
  console.log("    13. ✅ Direct event subscriptions (no Infura polling)");
  console.log("    14. ✅ Reentrancy protection (OpenZeppelin)");
  console.log();
}

main().catch(console.error);
