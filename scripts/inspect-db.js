/**
 * Genesis — Database Inspector
 * 
 * Quick script to inspect what's stored in SQLite database
 */

const { Database, EventRepository, AlertRepository } = require("../src/db");
const config = require("../src/config");

async function inspectDatabase() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║        🔍 Genesis Database Inspector                    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();

  const db = new Database(config.database);
  await db.connect();

  const eventRepo = new EventRepository(db);
  const alertRepo = new AlertRepository(db);

  console.log("📊 DATABASE STATISTICS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Get table statistics
  const tables = ["events", "alerts"];
  
  for (const table of tables) {
    try {
      const countResult = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
      const count = countResult.rows[0]?.count || 0;
      console.log(`  ${table.toUpperCase().padEnd(15)} ${count} rows`);
    } catch (err) {
      console.log(`  ${table.toUpperCase().padEnd(15)} Table not found or error`);
    }
  }

  console.log();
  console.log("📦 RECENT EVENTS (Last 10)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const recentEvents = await db.query(`
      SELECT 
        event_id,
        chain,
        block_number,
        event_name,
        event_type,
        contract_address,
        finality,
        created_at
      FROM events
      ORDER BY id DESC
      LIMIT 10
    `);

    if (recentEvents.rows.length === 0) {
      console.log("  No events found in database");
    } else {
      for (const event of recentEvents.rows) {
        console.log();
        console.log(`  Event ID:     ${event.event_id}`);
        console.log(`  Chain:        ${event.chain}`);
        console.log(`  Block:        ${event.block_number}`);
        console.log(`  Event:        ${event.event_name} (${event.event_type})`);
        console.log(`  Contract:     ${event.contract_address}`);
        console.log(`  Finality:     ${event.finality}`);
        console.log(`  Created:      ${new Date(event.created_at * 1000).toISOString()}`);
        console.log("  " + "─".repeat(60));
      }
    }
  } catch (err) {
    console.error(`  ❌ Error fetching events: ${err.message}`);
  }

  console.log();
  console.log("🚨 RECENT ALERTS (Last 5)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const recentAlerts = await db.query(`
      SELECT 
        alert_id,
        rule_id,
        rule_name,
        severity,
        alert_type,
        event_count,
        notification_channels,
        created_at
      FROM alerts
      ORDER BY id DESC
      LIMIT 5
    `);

    if (recentAlerts.rows.length === 0) {
      console.log("  No alerts found in database");
    } else {
      for (const alert of recentAlerts.rows) {
        console.log();
        console.log(`  Alert ID:     ${alert.alert_id}`);
        console.log(`  Rule:         ${alert.rule_id} - ${alert.rule_name}`);
        console.log(`  Severity:     ${alert.severity}`);
        console.log(`  Type:         ${alert.alert_type}`);
        console.log(`  Events:       ${alert.event_count}`);
        console.log(`  Channels:     ${alert.notification_channels || 'None'}`);
        console.log(`  Created:      ${new Date(alert.created_at * 1000).toISOString()}`);
        console.log("  " + "─".repeat(60));
      }
    }
  } catch (err) {
    console.error(`  ❌ Error fetching alerts: ${err.message}`);
  }

  console.log();
  console.log("📈 EVENTS BY TYPE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const eventsByType = await db.query(`
      SELECT event_type, COUNT(*) as count
      FROM events
      GROUP BY event_type
      ORDER BY count DESC
      LIMIT 10
    `);

    if (eventsByType.rows.length === 0) {
      console.log("  No events found");
    } else {
      for (const row of eventsByType.rows) {
        console.log(`  ${row.event_type.padEnd(30)} ${row.count} events`);
      }
    }
  } catch (err) {
    console.error(`  ❌ Error fetching event types: ${err.message}`);
  }

  console.log();
  console.log("⛓️  EVENTS BY FINALITY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const eventsByFinality = await db.query(`
      SELECT finality, COUNT(*) as count
      FROM events
      GROUP BY finality
      ORDER BY count DESC
    `);

    if (eventsByFinality.rows.length === 0) {
      console.log("  No events found");
    } else {
      for (const row of eventsByFinality.rows) {
        const icon = row.finality === 'finalized' ? '✅' : 
                     row.finality === 'soft_confirmed' ? '🟡' : 
                     row.finality === 'pending' ? '⏳' : '❓';
        console.log(`  ${icon} ${row.finality.padEnd(20)} ${row.count} events`);
      }
    }
  } catch (err) {
    console.error(`  ❌ Error fetching finality stats: ${err.message}`);
  }

  console.log();
  console.log("🔍 SAMPLE EVENT DATA (Full Details)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const sampleEvent = await db.query(`
      SELECT *
      FROM events
      ORDER BY id DESC
      LIMIT 1
    `);

    if (sampleEvent.rows.length > 0) {
      const event = sampleEvent.rows[0];
      console.log();
      console.log("  Full Event Record:");
      console.log("  " + "─".repeat(60));
      for (const [key, value] of Object.entries(event)) {
        let displayValue = value;
        
        // Parse JSON args for better display
        if (key === 'args' && typeof value === 'string') {
          try {
            displayValue = JSON.stringify(JSON.parse(value), null, 2).split('\n').join('\n  ');
          } catch (e) {
            displayValue = value;
          }
        }
        
        // Format timestamps
        if ((key === 'created_at' || key === 'updated_at' || key === 'finality_updated_at' || key === 'block_timestamp') && value) {
          displayValue = `${value} (${new Date(value * 1000).toISOString()})`;
        }
        
        console.log(`  ${key.padEnd(25)} ${displayValue}`);
      }
    } else {
      console.log("  No events in database yet");
    }
  } catch (err) {
    console.error(`  ❌ Error fetching sample event: ${err.message}`);
  }

  console.log();
  console.log("✅ Inspection complete!");
  console.log();

  await db.close();
  process.exit(0);
}

// Run inspection
inspectDatabase().catch((err) => {
  console.error("💥 Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
