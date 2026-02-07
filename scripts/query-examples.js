/**
 * Genesis — Database Query Examples
 * 
 * Demonstrates how to fetch and query data from SQLite database
 */

const { Database, EventRepository, AlertRepository } = require("../src/db");
const config = require("../src/config");

async function queryExamples() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║        📚 Genesis Database Query Examples               ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();

  const db = new Database(config.database);
  await db.connect();

  const eventRepo = new EventRepository(db);
  const alertRepo = new AlertRepository(db);

  // -------------------------------------------------------------------------
  // Example 1: Fetch Events by Block Range
  // -------------------------------------------------------------------------
  console.log("1️⃣  FETCH EVENTS BY BLOCK RANGE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  try {
    const events = await eventRepo.getByBlockRange("ethereum", 24397100, 24397110, 5);
    console.log(`Found ${events.length} events in blocks 24397100-24397110:`);
    for (const event of events) {
      console.log(`  Block ${event.blockNumber}: ${event.eventName} (${event.contract?.slice(0, 10)}...)`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Example 2: Fetch Events by Contract
  // -------------------------------------------------------------------------
  console.log("2️⃣  FETCH EVENTS BY CONTRACT (USDC)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const events = await eventRepo.getByContract(usdcAddress, 10);
    console.log(`Found ${events.length} USDC events:`);
    for (const event of events) {
      console.log(`  Block ${event.blockNumber}: ${event.eventName} - Finality: ${event.finality}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Example 3: Custom SQL Query - Transfer Events with Large Amounts
  // -------------------------------------------------------------------------
  console.log("3️⃣  CUSTOM QUERY: Large USDT/USDC Transfers");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const result = await db.query(`
      SELECT 
        block_number,
        event_name,
        contract_address,
        args,
        finality,
        created_at
      FROM events
      WHERE event_type = 'ERC20_TRANSFER'
        AND contract_address IN (
          '0xdac17f958d2ee523a2206206994597c13d831ec7',  -- USDT
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'   -- USDC
        )
      ORDER BY block_number DESC
      LIMIT 10
    `);

    console.log(`Found ${result.rows.length} recent USDT/USDC transfers:`);
    for (const row of result.rows) {
      const args = row.args ? JSON.parse(row.args) : {};
      const token = row.contract_address.toLowerCase() === '0xdac17f958d2ee523a2206206994597c13d831ec7' ? 'USDT' : 'USDC';
      console.log(`  Block ${row.block_number}: ${token} Transfer - Finality: ${row.finality}`);
      
      // Display transfer details if available
      if (args.from && args.to) {
        console.log(`    From: ${args.from?.slice(0, 10)}... → To: ${args.to?.slice(0, 10)}...`);
      }
      if (args.value || args._rawValue) {
        const value = args.value || args._rawValue;
        console.log(`    Amount: ${value}`);
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Example 4: Fetch Alerts
  // -------------------------------------------------------------------------
  console.log("4️⃣  FETCH RECENT ALERTS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const alerts = await alertRepo.getRecent(5);
    console.log(`Found ${alerts.length} recent alerts:`);
    for (const alert of alerts) {
      console.log();
      console.log(`  Alert: ${alert.ruleName}`);
      console.log(`  Severity: ${alert.severity}`);
      console.log(`  Type: ${alert.alertType}`);
      console.log(`  Events: ${alert.eventCount}`);
      console.log(`  Blocks: ${alert.fromBlock} → ${alert.toBlock}`);
      if (alert.notificationChannels) {
        console.log(`  Channels: ${alert.notificationChannels.join(', ')}`);
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Example 5: Count Events by Type
  // -------------------------------------------------------------------------
  console.log("5️⃣  EVENT STATISTICS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const result = await db.query(`
      SELECT 
        event_type,
        COUNT(*) as count,
        MIN(block_number) as first_block,
        MAX(block_number) as last_block
      FROM events
      GROUP BY event_type
      ORDER BY count DESC
    `);

    console.log("Event type distribution:");
    for (const row of result.rows) {
      console.log(`  ${row.event_type.padEnd(30)} ${row.count.toString().padStart(6)} events (Blocks ${row.first_block}-${row.last_block})`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Example 6: Finality Progression Analysis
  // -------------------------------------------------------------------------
  console.log("6️⃣  FINALITY PROGRESSION");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const result = await db.query(`
      SELECT 
        finality,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM events), 2) as percentage
      FROM events
      GROUP BY finality
      ORDER BY 
        CASE finality
          WHEN 'finalized' THEN 1
          WHEN 'soft_confirmed' THEN 2
          WHEN 'pending' THEN 3
          ELSE 4
        END
    `);

    console.log("Finality status distribution:");
    for (const row of result.rows) {
      const icon = row.finality === 'finalized' ? '✅' : 
                   row.finality === 'soft_confirmed' ? '🟡' : 
                   row.finality === 'pending' ? '⏳' : '❓';
      console.log(`  ${icon} ${row.finality.padEnd(20)} ${row.count.toString().padStart(6)} events (${row.percentage}%)`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Example 7: Time-Based Query
  // -------------------------------------------------------------------------
  console.log("7️⃣  EVENTS IN LAST HOUR");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const result = await db.query(`
      SELECT 
        COUNT(*) as count,
        MIN(block_number) as first_block,
        MAX(block_number) as last_block
      FROM events
      WHERE created_at >= ?
    `, [oneHourAgo]);

    const stats = result.rows[0];
    console.log(`Events in last hour: ${stats.count}`);
    console.log(`Block range: ${stats.first_block || 'N/A'} → ${stats.last_block || 'N/A'}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }

  console.log();

  // -------------------------------------------------------------------------
  // Example 8: Get Single Event by ID
  // -------------------------------------------------------------------------
  console.log("8️⃣  FETCH SINGLE EVENT BY ID");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    // Get most recent event first
    const recentResult = await db.query(`
      SELECT event_id FROM events ORDER BY id DESC LIMIT 1
    `);

    if (recentResult.rows.length > 0) {
      const eventId = recentResult.rows[0].event_id;
      const event = await eventRepo.getById(eventId);
      
      if (event) {
        console.log(`Event Details:`);
        console.log(`  ID:         ${event.id?.slice(0, 60)}...`);
        console.log(`  Chain:      ${event.chain}`);
        console.log(`  Block:      ${event.blockNumber}`);
        console.log(`  Event:      ${event.eventName} (${event.eventType})`);
        console.log(`  Contract:   ${event.contract}`);
        console.log(`  Finality:   ${event.finality}`);
        console.log(`  Timestamp:  ${new Date(event.timestamp * 1000).toISOString()}`);
        
        if (event.args) {
          console.log(`  Args:       ${JSON.stringify(event.args, null, 2).split('\n').join('\n              ')}`);
        }
      }
    } else {
      console.log("No events found in database");
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }

  console.log();
  console.log("✅ Query examples complete!");
  console.log();

  await db.close();
  process.exit(0);
}

// Run examples
queryExamples().catch((err) => {
  console.error("💥 Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
