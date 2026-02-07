/**
 * Mock CyreneAI Agent Server
 * 
 * Simulates a CyreneAI agent endpoint for testing without a real deployment.
 * Provides realistic AI-style responses based on event analysis rules.
 * 
 * Usage:
 *   node scripts/mock-cyrene-agent.js
 *   
 * Then set in Genesis:
 *   export CYRENE_AGENT_ENDPOINT=http://localhost:8080
 *   export CYRENE_API_KEY=mock_key_for_testing
 */

const http = require('http');

const PORT = 8080;

// Simple pattern detection rules
const KNOWN_CEX_WALLETS = [
  '0x28c6c06298d514db089934071355e5743bf21d60', // Binance
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance 2
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', // Binance 3
];

const PATTERNS = {
  treasury_movement: {
    keywords: ['treasury', 'vault', 'cold', 'hot'],
    risk: 'low',
    description: 'Routine treasury or liquidity management operation',
  },
  flash_loan: {
    keywords: ['flash', 'loan', 'borrow'],
    risk: 'medium',
    description: 'Flash loan detected - could be arbitrage or attack',
  },
  large_transfer: {
    keywords: ['transfer', 'usdc', 'usdt'],
    risk: 'medium',
    description: 'Large transfer of stablecoin',
  },
  exploit: {
    keywords: ['drain', 'hack', 'exploit', 'emergency'],
    risk: 'critical',
    description: 'Potential security incident detected',
  },
};

function analyzeEvent(payload) {
  const { eventType, args, contractAddress, ruleName } = payload;
  
  // Check if it's a known CEX wallet (low risk)
  const fromLower = args?.from?.toLowerCase() || '';
  const toLower = args?.to?.toLowerCase() || '';
  const isCEX = KNOWN_CEX_WALLETS.some(wallet => 
    fromLower.includes(wallet) || toLower.includes(wallet)
  );

  if (isCEX) {
    return {
      summary: 'Transfer from known centralized exchange wallet. This is routine CEX operation, likely cold wallet consolidation or user withdrawal processing.',
      risk: 'low',
      confidence: 'high',
      confidence_score: 0.95,
      pattern: 'cex_operation',
      is_anomalous: false,
      similar_events: Math.floor(Math.random() * 10) + 5,
      historical_behavior: 'normal',
      recommendation: 'Monitor only - no action required',
      suggested_actions: [
        'Track for unusual volume spikes',
        'Verify destination if funds move to unknown addresses',
      ],
    };
  }

  // Detect pattern based on rule name and event type
  let detectedPattern = 'unknown';
  let risk = 'medium';
  let description = 'Blockchain event detected';

  const ruleNameLower = (ruleName || '').toLowerCase();
  const eventTypeLower = eventType.toLowerCase();

  for (const [pattern, config] of Object.entries(PATTERNS)) {
    const matches = config.keywords.some(keyword => 
      ruleNameLower.includes(keyword) || eventTypeLower.includes(keyword)
    );
    
    if (matches) {
      detectedPattern = pattern;
      risk = config.risk;
      description = config.description;
      break;
    }
  }

  // Analyze amount if present
  const value = args?.value || args?.amount || '0';
  const isLargeAmount = value.length > 15; // > 1M in most tokens

  if (isLargeAmount) {
    risk = risk === 'low' ? 'medium' : risk;
    description += '. Large amount involved.';
  }

  // Generate contextual summary
  let summary = '';
  if (detectedPattern === 'flash_loan') {
    summary = 'Flash loan detected. Analyzing subsequent transactions to determine if this is MEV arbitrage (normal) or potential exploit (high risk). Current pattern suggests legitimate arbitrage activity.';
  } else if (detectedPattern === 'large_transfer') {
    summary = `Large ${contractAddress.includes('A0b86991') ? 'USDC' : 'token'} transfer detected. Volume analysis shows this is ${isLargeAmount ? 'significantly above' : 'within'} normal range for this address. ${isCEX ? 'Source is a known exchange wallet.' : 'Source appears to be a private wallet or smart contract.'}`;
  } else if (detectedPattern === 'treasury_movement') {
    summary = 'Treasury movement detected. Pattern matches protocol rebalancing or liquidity adjustment. No signs of emergency withdrawal or unusual behavior.';
  } else {
    summary = `${eventType} event detected on contract ${contractAddress.slice(0, 10)}... Behavior analysis shows normal operation patterns.`;
  }

  return {
    summary,
    risk,
    confidence: risk === 'critical' ? 'high' : 'medium',
    confidence_score: risk === 'critical' ? 0.92 : risk === 'low' ? 0.85 : 0.70,
    pattern: detectedPattern,
    is_anomalous: risk === 'critical' || risk === 'high',
    similar_events: Math.floor(Math.random() * 20) + 1,
    historical_behavior: risk === 'critical' ? 'unusual' : 'normal',
    recommendation: risk === 'critical' ? 'Immediate investigation required' : 
                    risk === 'high' ? 'Monitor closely' : 
                    'Continue normal monitoring',
    suggested_actions: risk === 'critical' ? [
      'Pause contract if possible',
      'Notify security team immediately',
      'Analyze transaction details',
    ] : [
      'Track wallet for additional activity',
      'Compare with historical patterns',
    ],
  };
}

function detectPattern(events) {
  if (events.length < 2) {
    return { hasPattern: false };
  }

  // Simple pattern detection based on event sequence
  const eventTypes = events.map(e => e.eventType);
  
  // Flash loan pattern: Loan -> Swap -> Repay
  if (eventTypes.some(t => t.includes('FLASH') || t.includes('LOAN')) &&
      eventTypes.some(t => t.includes('SWAP'))) {
    return {
      hasPattern: true,
      pattern: 'flash_loan_arbitrage',
      description: 'Flash loan followed by DEX swap detected. This matches MEV arbitrage pattern, typically low risk. Monitor for unusual profit extraction or liquidity drainage.',
      risk: 'low',
      confidence: 'high',
    };
  }

  // Multiple transfers in sequence
  if (eventTypes.filter(t => t.includes('TRANSFER')).length >= 3) {
    return {
      hasPattern: true,
      pattern: 'transfer_sequence',
      description: `Sequence of ${events.length} transfers detected. Could indicate fund movement across wallets or automated protocol operations.`,
      risk: 'medium',
      confidence: 'medium',
    };
  }

  // Approval + Transfer (sandwich attack pattern)
  if (eventTypes.includes('ERC20_APPROVAL') && eventTypes.includes('ERC20_TRANSFER')) {
    return {
      hasPattern: true,
      pattern: 'approval_transfer',
      description: 'Approval followed by transfer. Normal for DEX interactions, but monitor for excessive approvals or unexpected transfers.',
      risk: 'low',
      confidence: 'high',
    };
  }

  return {
    hasPattern: false,
    description: 'No specific pattern detected across these events.',
  };
}

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        let response;

        if (request.task === 'analyze_blockchain_event') {
          response = analyzeEvent(request.payload);
        } else if (request.task === 'detect_pattern') {
          response = detectPattern(request.payload.events || []);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown task type' }));
          return;
        }

        console.log(`🧠 [Mock CyreneAI] ${request.task} - Risk: ${response.risk || 'N/A'}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));

      } catch (err) {
        console.error('❌ [Mock CyreneAI] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', service: 'mock-cyrene-agent' }));

  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        🧠 Mock CyreneAI Agent Server                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Status: ✅ Running`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Endpoint: http://localhost:${PORT}`);
  console.log(`  Health Check: http://localhost:${PORT}/health\n`);
  console.log('  Configuration for Genesis:');
  console.log(`    export CYRENE_AGENT_ENDPOINT=http://localhost:${PORT}`);
  console.log('    export CYRENE_API_KEY=mock_key_for_testing\n');
  console.log('  Ready to analyze blockchain events! 🚀\n');
});
