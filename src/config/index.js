/**
 * Genesis — Configuration Loader
 *
 * Loads .env variables and chain definitions.
 * Resolves ${PLACEHOLDER} in RPC URLs with actual env values.
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const chainsRaw = require("./chains.json");

// ---------------------------------------------------------------------------
// Resolve ${VAR} placeholders in RPC endpoint URLs using process.env
// ---------------------------------------------------------------------------
function resolveEnvPlaceholders(str) {
  return str.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || "");
}

function resolveChainEndpoints(chains) {
  const resolved = {};
  for (const [slug, chain] of Object.entries(chains)) {
    resolved[slug] = {
      ...chain,
      slug,
      rpcEndpoints: chain.rpcEndpoints
        .map(resolveEnvPlaceholders)
        .filter((url) => !url.includes("undefined") && !url.endsWith("/")),
    };
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Exported config object
// ---------------------------------------------------------------------------
const chains = resolveChainEndpoints(chainsRaw);

const config = {
  logLevel: process.env.LOG_LEVEL || "info",
  defaultChain: process.env.DEFAULT_CHAIN || "ethereum",
  chains,

  // Database config (Phase 3 - SQLite)
  database: {
    path: process.env.DATABASE_PATH || path.resolve(__dirname, "../../data/genesis.db"),
  },

  // API server config (Phase 3)
  api: {
    port: parseInt(process.env.API_PORT || "3000", 10),
    host: process.env.API_HOST || "localhost",
  },

  // Notification config (Phase 4)
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  CONSOLE_ALERTS: process.env.CONSOLE_ALERTS !== 'false',
  NOTIFICATION_MAX_RETRIES: parseInt(process.env.NOTIFICATION_MAX_RETRIES || '3', 10),
  NOTIFICATION_RETRY_DELAY: parseInt(process.env.NOTIFICATION_RETRY_DELAY || '1000', 10),

  // Convenience: get a specific chain's config
  getChain(slug) {
    const chain = chains[slug];
    if (!chain) throw new Error(`Unknown chain: "${slug}". Available: ${Object.keys(chains).join(", ")}`);
    return chain;
  },

  // All loaded ABI fragments
  abis: {
    erc20: require("./abis/erc20.json"),
    erc721: require("./abis/erc721.json"),
    uniswapV2: require("./abis/uniswap-v2.json"),
    uniswapV3: require("./abis/uniswap-v3.json"),
    aaveV3: require("./abis/aave-v3.json"),
    pausable: require("./abis/pausable.json"),
  },
};

module.exports = config;
