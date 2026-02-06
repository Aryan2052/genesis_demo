/**
 * Alert Templates - Rich formatting with explorer links
 * Formats alerts for different channels (Telegram, Console, Webhook)
 */

const EXPLORERS = {
  ethereum: 'https://etherscan.io',
  polygon: 'https://polygonscan.com',
  arbitrum: 'https://arbiscan.io',
  optimism: 'https://optimistic.etherscan.io',
  base: 'https://basescan.org'
};

/**
 * Format number with commas
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format ETH/token amount
 */
function formatAmount(value, decimals = 18, symbol = 'ETH') {
  const amount = Number(value) / Math.pow(10, decimals);
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(2)}M ${symbol}`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(2)}K ${symbol}`;
  }
  return `${amount.toFixed(4)} ${symbol}`;
}

/**
 * Get explorer URL for transaction
 */
function getExplorerUrl(chain, type, hash) {
  const baseUrl = EXPLORERS[chain] || EXPLORERS.ethereum;
  
  switch (type) {
    case 'tx':
      return `${baseUrl}/tx/${hash}`;
    case 'block':
      return `${baseUrl}/block/${hash}`;
    case 'address':
      return `${baseUrl}/address/${hash}`;
    default:
      return baseUrl;
  }
}

/**
 * Shorten address for display
 */
function shortAddress(address) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format timestamp
 */
function formatTime(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }) + ' UTC';
}

/**
 * Get severity emoji
 */
function getSeverityEmoji(severity) {
  const emojis = {
    critical: '🚨',
    high: '⚠️',
    medium: '⚡',
    low: 'ℹ️'
  };
  return emojis[severity] || 'ℹ️';
}

/**
 * Format alert for Telegram (Markdown)
 */
function formatTelegramAlert(alert) {
  const emoji = getSeverityEmoji(alert.severity);
  const chain = alert.chain?.toUpperCase() || 'ETHEREUM';
  
  let message = `${emoji} *${alert.rule_name}*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  
  if (alert.alert_type === 'aggregated') {
    // Aggregated alert
    message += `📊 *Aggregated Alert*\n`;
    message += `Events: *${formatNumber(alert.event_count)}*\n`;
    message += `Chain: ${chain}\n`;
    message += `Blocks: ${alert.from_block}`;
    if (alert.to_block !== alert.from_block) {
      message += ` → ${alert.to_block}`;
    }
    message += `\n`;
    
    // Add total amount if available (for whale alerts)
    if (alert.summary && alert.summary.total_amount) {
      const totalUSD = formatAmount(alert.summary.total_amount, 6, 'USDT/USDC');
      message += `💰 Total Value: *${totalUSD}*\n`;
    }
    
    if (alert.message) {
      message += `\n${alert.message}\n`;
    }
    
    // Add block explorer link
    const explorerUrl = getExplorerUrl(alert.chain, 'block', alert.from_block);
    message += `\n[View Block](${explorerUrl})`;
    
  } else {
    // Single event alert
    const event = alert.event;
    if (event) {
      message += `Chain: ${chain}\n`;
      message += `Event: \`${event.event_name}\`\n`;
      message += `Contract: \`${shortAddress(event.contract_address)}\`\n`;
      message += `Block: ${event.block_number}\n`;
      
      // Add decoded data if available
      if (event.decoded_data) {
        const data = typeof event.decoded_data === 'string' 
          ? JSON.parse(event.decoded_data) 
          : event.decoded_data;
        
        if (data.from) {
          message += `From: \`${shortAddress(data.from)}\`\n`;
        }
        if (data.to) {
          message += `To: \`${shortAddress(data.to)}\`\n`;
        }
        if (data.value) {
          message += `Amount: ${formatAmount(data.value, 6, 'USDC')}\n`;
        }
      }
      
      // Add explorer links
      const txUrl = getExplorerUrl(alert.chain, 'tx', event.tx_hash);
      message += `\n[View Transaction](${txUrl})`;
    }
  }
  
  message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  message += `⏰ ${formatTime(alert.created_at || Math.floor(Date.now() / 1000))}`;
  
  return message;
}

/**
 * Format alert for console (colored text)
 */
function formatConsoleAlert(alert) {
  const emoji = getSeverityEmoji(alert.severity);
  const chain = alert.chain?.toUpperCase() || 'ETHEREUM';
  
  let message = `\n${emoji} ${alert.rule_name}\n`;
  message += `${'='.repeat(50)}\n`;
  
  if (alert.alert_type === 'aggregated') {
    message += `Type: Aggregated Alert\n`;
    message += `Events: ${formatNumber(alert.event_count)}\n`;
    message += `Chain: ${chain}\n`;
    message += `Blocks: ${alert.from_block}`;
    if (alert.to_block !== alert.from_block) {
      message += ` → ${alert.to_block}`;
    }
    message += `\n`;
    
    if (alert.message) {
      message += `\n${alert.message}\n`;
    }
  } else {
    const event = alert.event;
    if (event) {
      message += `Chain: ${chain}\n`;
      message += `Event: ${event.event_name}\n`;
      message += `Contract: ${event.contract_address}\n`;
      message += `Block: ${event.block_number}\n`;
      message += `Tx: ${event.tx_hash}\n`;
    }
  }
  
  message += `${'='.repeat(50)}\n`;
  
  return message;
}

/**
 * Format alert for webhook (JSON with all data)
 */
function formatWebhookAlert(alert) {
  return {
    id: alert.id,
    type: alert.alert_type,
    rule: alert.rule_name,
    severity: alert.severity,
    chain: alert.chain,
    timestamp: alert.created_at || Math.floor(Date.now() / 1000),
    
    // Aggregated alert data
    ...(alert.alert_type === 'aggregated' && {
      event_count: alert.event_count,
      from_block: alert.from_block,
      to_block: alert.to_block,
      message: alert.message
    }),
    
    // Single event alert data
    ...(alert.event && {
      event: {
        name: alert.event.event_name,
        type: alert.event.event_type,
        contract: alert.event.contract_address,
        block: alert.event.block_number,
        tx_hash: alert.event.tx_hash,
        decoded_data: alert.event.decoded_data,
        explorer_url: getExplorerUrl(alert.chain, 'tx', alert.event.tx_hash)
      }
    })
  };
}

module.exports = {
  formatTelegramAlert,
  formatConsoleAlert,
  formatWebhookAlert,
  formatAmount,
  formatNumber,
  shortAddress,
  getExplorerUrl
};
