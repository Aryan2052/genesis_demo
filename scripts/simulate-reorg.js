/**
 * Genesis — Blockchain Reorg Simulation Tool
 * 
 * Demonstrates how Genesis handles chain reorganizations by simulating
 * a reorg event and showing how the system responds.
 * 
 * Usage: node scripts/simulate-reorg.js
 */

const path = require('path');
const { Database } = require('../src/db');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(title) {
  console.log('\n' + '═'.repeat(60));
  log(`  ${title}`, 'bright');
  console.log('═'.repeat(60) + '\n');
}

async function simulateReorg() {
  header('🔄 BLOCKCHAIN REORG SIMULATION');

  log('This simulation demonstrates how Genesis handles chain reorganizations:', 'cyan');
  log('  1. Detects when blocks have been reorganized', 'cyan');
  log('  2. Identifies affected events in the reorg range', 'cyan');
  log('  3. Reverts finality status to pending', 'cyan');
  log('  4. Emits reorg alerts for monitoring', 'cyan');
  console.log();

  // Connect to database
  const dbPath = path.join(__dirname, '../data/genesis.db');
  const database = new Database({ path: dbPath });

  try {
    await database.connect();
    log(`✅ Connected to database: ${dbPath}`, 'green');
  } catch (err) {
    log(`❌ Error: Could not open database at ${dbPath}`, 'red');
    log(`   Make sure Genesis has been run at least once to create the database.`, 'yellow');
    process.exit(1);
  }

  // Get current database state
  const statsResult = await database.query(`
    SELECT 
      COUNT(*) as total_events,
      MIN(block_number) as min_block,
      MAX(block_number) as max_block,
      COUNT(DISTINCT block_number) as unique_blocks
    FROM events
  `);
  
  const stats = statsResult.rows[0];

  log('📊 Current Database State:', 'bright');
  console.log(`   Total Events:    ${stats.total_events.toLocaleString()}`);
  console.log(`   Block Range:     ${stats.min_block || 'N/A'} → ${stats.max_block || 'N/A'}`);
  console.log(`   Unique Blocks:   ${stats.unique_blocks.toLocaleString()}`);
  console.log();

  if (stats.total_events === 0) {
    log('⚠️  No events in database. Run Genesis first to populate data.', 'yellow');
    await database.close();
    process.exit(0);
  }

  // Simulate a reorg scenario
  header('🎬 SIMULATING REORG SCENARIO');

  // Pick a recent block range for the reorg
  const reorgDepth = 3; // Simulate 3-block reorg
  const reorgStartBlock = stats.max_block - reorgDepth;
  const reorgEndBlock = stats.max_block;

  log(`Simulating a ${reorgDepth}-block reorganization:`, 'yellow');
  console.log(`   Affected Range: Block ${reorgStartBlock} → ${reorgEndBlock}`);
  console.log();

  // Step 1: Find events in the reorg range
  const affectedEventsResult = await database.query(`
    SELECT 
      event_id,
      block_number,
      event_type,
      finality,
      contract_address
    FROM events
    WHERE block_number BETWEEN ? AND ?
    ORDER BY block_number DESC
  `, [reorgStartBlock, reorgEndBlock]);

  const affectedEvents = affectedEventsResult.rows;

  log(`📍 Step 1: Identifying Affected Events`, 'bright');
  console.log(`   Found ${affectedEvents.length} event(s) in reorg range\n`);

  if (affectedEvents.length === 0) {
    log('   No events found in reorg range. Try running Genesis longer.', 'yellow');
    await database.close();
    process.exit(0);
  }

  // Show sample affected events
  log('   Sample Affected Events:', 'cyan');
  affectedEvents.slice(0, 5).forEach((event, idx) => {
    console.log(`   ${idx + 1}. Block ${event.block_number} | ${event.event_type} | Status: ${event.finality}`);
  });
  if (affectedEvents.length > 5) {
    console.log(`   ... and ${affectedEvents.length - 5} more`);
  }
  console.log();

  // Step 2: Count events by finality status
  const finalityResult = await database.query(`
    SELECT 
      finality,
      COUNT(*) as count
    FROM events
    WHERE block_number BETWEEN ? AND ?
    GROUP BY finality
  `, [reorgStartBlock, reorgEndBlock]);

  const finalityBreakdown = finalityResult.rows;

  log(`📊 Step 2: Finality Status Breakdown`, 'bright');
  finalityBreakdown.forEach(({ finality, count }) => {
    const emoji = finality === 'pending' ? '⏳' : finality === 'soft_confirmed' ? '🟡' : '✅';
    console.log(`   ${emoji} ${finality.padEnd(20)} ${count} event(s)`);
  });
  console.log();

  // Step 3: Simulate reorg detection
  log(`🔍 Step 3: Simulating Reorg Detection`, 'bright');
  console.log(`   Genesis detected block hash mismatch at block ${reorgStartBlock}`);
  console.log(`   Expected: 0x1234567890abcdef... (old chain)`);
  console.log(`   Actual:   0xfedcba0987654321... (new chain)`);
  console.log(`   Action:   Triggering reorg handler\n`);

  // Step 4: Revert finality statuses
  log(`⏮️  Step 4: Reverting Event Finality`, 'bright');
  
  const updateResult = await database.query(`
    UPDATE events
    SET 
      finality = 'pending',
      finality_updated_at = ?,
      updated_at = ?
    WHERE block_number BETWEEN ? AND ?
      AND finality != 'pending'
  `, [
    Math.floor(Date.now() / 1000),
    Math.floor(Date.now() / 1000),
    reorgStartBlock,
    reorgEndBlock
  ]);

  console.log(`   Reverted ${updateResult.rowCount || 0} event(s) to 'pending' status`);
  console.log();

  // Step 5: Show reorg metrics
  header('📈 REORG IMPACT ANALYSIS');

  const reorgStats = {
    depth: reorgDepth,
    affectedBlocks: reorgEndBlock - reorgStartBlock + 1,
    affectedEvents: affectedEvents.length,
    revertedEvents: updateResult.rowCount || 0,
    contractsAffected: new Set(affectedEvents.map(e => e.contract_address)).size,
  };

  console.log(`   Reorg Depth:           ${reorgStats.depth} block(s)`);
  console.log(`   Affected Blocks:       ${reorgStats.affectedBlocks}`);
  console.log(`   Total Events:          ${reorgStats.affectedEvents}`);
  console.log(`   Events Reverted:       ${reorgStats.revertedEvents}`);
  console.log(`   Contracts Affected:    ${reorgStats.contractsAffected}`);
  console.log();

  // Step 6: Show how Genesis would alert
  header('🚨 REORG ALERT NOTIFICATION');

  log('Genesis would emit the following alert:', 'cyan');
  console.log();
  console.log('  ┌─────────────────────────────────────────────────────┐');
  log('  │ 🔄 BLOCKCHAIN REORGANIZATION DETECTED               │', 'yellow');
  console.log('  ├─────────────────────────────────────────────────────┤');
  console.log(`  │ Chain:           Ethereum Mainnet                   │`);
  console.log(`  │ Reorg Depth:     ${reorgStats.depth} blocks                              │`);
  console.log(`  │ Block Range:     ${reorgStartBlock} → ${reorgEndBlock}                 │`);
  console.log(`  │ Events Affected: ${reorgStats.affectedEvents}                                    │`);
  console.log(`  │ Action:          Finality reverted to pending       │`);
  console.log('  ├─────────────────────────────────────────────────────┤');
  log('  │ ⚠️  Please review transactions in this range        │', 'yellow');
  console.log('  └─────────────────────────────────────────────────────┘');
  console.log();

  // Step 7: Verify final state
  header('✅ POST-REORG DATABASE STATE');

  const postReorgResult = await database.query(`
    SELECT 
      finality,
      COUNT(*) as count
    FROM events
    WHERE block_number BETWEEN ? AND ?
    GROUP BY finality
  `, [reorgStartBlock, reorgEndBlock]);

  const postReorgStats = postReorgResult.rows;

  log('Events in reorg range now have updated finality:', 'green');
  postReorgStats.forEach(({ finality, count }) => {
    const emoji = finality === 'pending' ? '⏳' : finality === 'soft_confirmed' ? '🟡' : '✅';
    console.log(`   ${emoji} ${finality.padEnd(20)} ${count} event(s)`);
  });
  console.log();

  // Cleanup
  await database.close();

  // Summary
  header('🎓 KEY TAKEAWAYS');

  log('Genesis handles reorgs through a robust multi-step process:', 'bright');
  console.log();
  log('1. Block Hash Verification', 'cyan');
  console.log('   → Compares expected vs actual block hashes');
  console.log('   → Detects reorgs immediately when they occur');
  console.log();
  log('2. Event Identification', 'cyan');
  console.log('   → Finds all events in the affected block range');
  console.log('   → Tracks which contracts and event types are impacted');
  console.log();
  log('3. Finality Reversion', 'cyan');
  console.log('   → Reverts all affected events back to "pending"');
  console.log('   → Updates database atomically for consistency');
  console.log();
  log('4. Alert Notification', 'cyan');
  console.log('   → Sends alerts to Telegram, webhooks, console');
  console.log('   → Provides detailed reorg metrics for analysis');
  console.log();
  log('5. Re-tracking', 'cyan');
  console.log('   → Events are automatically re-tracked on the new chain');
  console.log('   → Finality progresses normally once blocks confirm');
  console.log();

  log('✨ This reorg-native design ensures Genesis never shows stale data!', 'green');
  console.log();
}

// Run simulation
simulateReorg().catch(err => {
  log(`\n❌ Simulation failed: ${err.message}`, 'red');
  console.error(err);
  process.exit(1);
});
