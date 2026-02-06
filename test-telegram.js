/**
 * Test Telegram Alert - Send a sample whale alert to verify Telegram integration
 */

const config = require('./src/config');
const NotificationDispatcher = require('./src/notify/dispatcher');

async function testTelegramAlert() {
  console.log('🧪 Testing Telegram Whale Alert...\n');
  
  // Initialize notification dispatcher
  const dispatcher = new NotificationDispatcher(config);
  
  // Create a sample whale alert (aggregated with total amount)
  const whaleAlert = {
    id: 1001,
    alert_type: 'aggregated',
    rule_name: '🐋 Whale USDT Transfer',
    severity: 'high',
    chain: 'ethereum',
    event_count: 3,
    from_block: 24396900,
    to_block: 24396902,
    summary: {
      total_amount: '5200000000000', // $5.2M in USDT (6 decimals)
      event_count: 3
    },
    message: 'Multiple large USDT transfers detected from same address',
    created_at: Math.floor(Date.now() / 1000)
  };
  
  console.log('📤 Sending whale alert to Telegram...');
  console.log('Alert:', JSON.stringify(whaleAlert, null, 2));
  console.log('');
  
  try {
    const result = await dispatcher.dispatch(whaleAlert);
    console.log('✅ Whale alert sent successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('\n📱 Check your Telegram bot for the whale alert!');
    console.log('Expected message format:');
    console.log('⚠️ 🐋 Whale USDT Transfer');
    console.log('━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Aggregated Alert');
    console.log('Events: 3');
    console.log('Chain: ETHEREUM');
    console.log('Blocks: 24396900 → 24396902');
    console.log('💰 Total Value: 5.20M USDT/USDC');
  } catch (error) {
    console.error('❌ Failed to send alert:', error.message);
  }
}

testTelegramAlert();
