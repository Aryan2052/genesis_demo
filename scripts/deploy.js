/**
 * Genesis — Deploy all contracts to local Hardhat node.
 *
 * Usage:
 *   npx hardhat node                          (terminal 1)
 *   npx hardhat run scripts/deploy.js --network localhost   (terminal 2)
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer, user1, user2, whale] = await hre.ethers.getSigners();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║       🧬 GENESIS — Smart Contract Deployment        ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  Deployer: ${deployer.address}`);
  console.log();

  // ── 1. Deploy GenesisToken (mock stablecoin — 6 decimals like USDT) ──
  const GenesisToken = await hre.ethers.getContractFactory("GenesisToken");
  const token = await GenesisToken.deploy("Genesis USD", "gUSD", 6, 10_000_000); // 10M supply
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`  ✅ GenesisToken (gUSD)  deployed: ${tokenAddr}`);

  // ── 2. Deploy GenesisVault ──
  const GenesisVault = await hre.ethers.getContractFactory("GenesisVault");
  const vault = await GenesisVault.deploy(tokenAddr);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`  ✅ GenesisVault         deployed: ${vaultAddr}`);

  // ── 3. Deploy ThresholdEngine ──
  const ThresholdEngine = await hre.ethers.getContractFactory("ThresholdEngine");
  const thresholdEngine = await ThresholdEngine.deploy();
  await thresholdEngine.waitForDeployment();
  const thresholdAddr = await thresholdEngine.getAddress();
  console.log(`  ✅ ThresholdEngine      deployed: ${thresholdAddr}`);

  // ── 4. Deploy AlertRegistry ──
  const AlertRegistry = await hre.ethers.getContractFactory("AlertRegistry");
  const alertRegistry = await AlertRegistry.deploy();
  await alertRegistry.waitForDeployment();
  const alertAddr = await alertRegistry.getAddress();
  console.log(`  ✅ AlertRegistry        deployed: ${alertAddr}`);

  // ── 5. Deploy GenesisVesting ──
  const GenesisVesting = await hre.ethers.getContractFactory("GenesisVesting");
  const vesting = await GenesisVesting.deploy();
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log(`  ✅ GenesisVesting       deployed: ${vestingAddr}`);

  // ── 6. Deploy GenesisGovernance ──
  const GenesisGovernance = await hre.ethers.getContractFactory("GenesisGovernance");
  const governance = await GenesisGovernance.deploy();
  await governance.waitForDeployment();
  const govAddr = await governance.getAddress();
  console.log(`  ✅ GenesisGovernance    deployed: ${govAddr}`);

  // ── 7. Deploy second token (gETH) for liquidity pool pair ──
  const GenesisETH = await hre.ethers.getContractFactory("GenesisToken");
  const gETH = await GenesisETH.deploy("Genesis ETH", "gETH", 6, 10_000_000); // 10M supply
  await gETH.waitForDeployment();
  const gETHAddr = await gETH.getAddress();
  console.log(`  ✅ GenesisToken (gETH)  deployed: ${gETHAddr}`);

  // ── 8. Deploy GenesisLiquidityPool (gUSD/gETH pair) ──
  const GenesisLiquidityPool = await hre.ethers.getContractFactory("GenesisLiquidityPool");
  const pool = await GenesisLiquidityPool.deploy(tokenAddr, gETHAddr, "gUSD/gETH");
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`  ✅ GenesisLiquidityPool deployed: ${poolAddr}`);

  console.log();

  // ── 5. Setup: distribute tokens to test users ──
  console.log("  📦 Setting up test accounts...");
  const DECIMALS = 6n;
  const toUnits = (n) => BigInt(n) * (10n ** DECIMALS);

  // Give user1 500K, user2 200K, whale 5M (gUSD)
  await token.transfer(user1.address, toUnits(500_000));
  await token.transfer(user2.address, toUnits(200_000));
  await token.transfer(whale.address, toUnits(5_000_000));
  console.log(`    user1 (${user1.address}): 500,000 gUSD`);
  console.log(`    user2 (${user2.address}): 200,000 gUSD`);
  console.log(`    whale (${whale.address}): 5,000,000 gUSD`);

  // Give user1/user2/whale gETH for liquidity pool
  await gETH.transfer(user1.address, toUnits(500_000));
  await gETH.transfer(user2.address, toUnits(200_000));
  await gETH.transfer(whale.address, toUnits(5_000_000));
  console.log(`    + Each user also receives gETH for LP`);

  // ── 6. Setup: approve vault to spend tokens ──
  await token.connect(user1).approve(vaultAddr, hre.ethers.MaxUint256);
  await token.connect(user2).approve(vaultAddr, hre.ethers.MaxUint256);
  await token.connect(whale).approve(vaultAddr, hre.ethers.MaxUint256);
  await token.approve(vaultAddr, hre.ethers.MaxUint256); // deployer
  console.log("    ✅ Vault approvals set for all users");

  // ── Approve vesting contract to pull tokens from deployer ──
  await token.approve(vestingAddr, hre.ethers.MaxUint256);
  console.log("    ✅ Vesting contract approved for deployer");

  // ── Approve liquidity pool for all users (both tokens) ──
  await token.approve(poolAddr, hre.ethers.MaxUint256);
  await gETH.approve(poolAddr, hre.ethers.MaxUint256);
  await token.connect(user1).approve(poolAddr, hre.ethers.MaxUint256);
  await gETH.connect(user1).approve(poolAddr, hre.ethers.MaxUint256);
  await token.connect(user2).approve(poolAddr, hre.ethers.MaxUint256);
  await gETH.connect(user2).approve(poolAddr, hre.ethers.MaxUint256);
  await token.connect(whale).approve(poolAddr, hre.ethers.MaxUint256);
  await gETH.connect(whale).approve(poolAddr, hre.ethers.MaxUint256);
  console.log("    ✅ Liquidity pool approvals set (gUSD + gETH) for all users");

  // ── Set low quorum for demo governance ──
  await governance.setQuorum(1000n * (10n ** DECIMALS)); // 1000 gUSD quorum
  await governance.setVotingDuration(60); // 60 seconds for demo
  console.log("    ✅ Governance config: quorum=1000 gUSD, votingDuration=60s");

  // ── 7. Setup: set default global thresholds ──
  console.log();
  console.log("  ⚙️  Setting default thresholds...");
  await thresholdEngine.setGlobalThreshold(
    tokenAddr,
    0, // LARGE_TRANSFER
    toUnits(100_000),
    120,
    "Alert on gUSD transfers above $100K"
  );
  await thresholdEngine.setGlobalThreshold(
    tokenAddr,
    1, // WHALE_MOVEMENT
    toUnits(500_000),
    300,
    "Alert on whale movements above $500K"
  );
  await thresholdEngine.setGlobalThreshold(
    tokenAddr,
    2, // RAPID_FLOW
    toUnits(50_000),
    60,
    "Alert on rapid flows above $50K within 1 minute"
  );
  console.log("    ✅ 3 global threshold rules created on-chain");

  // ── 8. Save deployment addresses for Genesis to use ──
  const deployment = {
    network: "localhost",
    chainId: 31337,
    deployer: deployer.address,
    contracts: {
      GenesisToken: { address: tokenAddr, symbol: "gUSD", decimals: 6 },
      GenesisVault: { address: vaultAddr },
      ThresholdEngine: { address: thresholdAddr },
      AlertRegistry: { address: alertAddr },
      GenesisVesting: { address: vestingAddr },
      GenesisGovernance: { address: govAddr },
      GenesisETH: { address: gETHAddr, symbol: "gETH", decimals: 6 },
      GenesisLiquidityPool: { address: poolAddr, pair: "gUSD/gETH" },
    },
    testAccounts: {
      deployer: deployer.address,
      user1: user1.address,
      user2: user2.address,
      whale: whale.address,
    },
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.resolve(__dirname, "..", "deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "localhost.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log();
  console.log(`  📄 Deployment info saved to deployments/localhost.json`);
  console.log();
  console.log("  ════════════════════════════════════════════");
  console.log("  🚀 All contracts deployed & configured!");
  console.log("  ════════════════════════════════════════════");
  console.log();
  console.log("  Next steps:");
  console.log("    1. Start Genesis listener:  node src/contract-listener.js");
  console.log("    2. Run demo:                node scripts/demo-onchain.js");
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
