/**
 * Genesis — Canonical Event Model
 *
 * Every blockchain event gets normalized into this structure.
 * The key innovation: REORG-SAFE EVENT IDs.
 *
 * Event ID = (chain_id, block_hash, tx_hash, log_index)
 *
 * This means if a reorg replaces block 100, the old events from block 100
 * have different IDs than the new events — so rollbacks are clean.
 */

/**
 * @typedef {Object} GenesisEvent
 * @property {string}  id            — unique reorg-safe ID
 * @property {string}  chain         — chain slug (e.g., "ethereum")
 * @property {number}  chainId       — numeric chain ID
 * @property {number}  blockNumber   — block height
 * @property {string}  blockHash     — block hash (part of the ID)
 * @property {string}  txHash        — transaction hash
 * @property {number}  logIndex      — position within the tx receipt
 * @property {string}  contract      — emitting contract address
 * @property {string}  eventName     — decoded event name (e.g., "Transfer")
 * @property {string}  eventType     — category (e.g., "ERC20_TRANSFER")
 * @property {Object}  args          — decoded event arguments
 * @property {string}  finality      — "pending" | "soft_confirmed" | "finalized" | "reverted"
 * @property {number}  confirmations — current number of confirmations
 * @property {number}  timestamp     — block timestamp (unix seconds)
 * @property {string}  explorerUrl   — link to tx on block explorer
 */

// ---------------------------------------------------------------------------
// Event ID generation (the reorg-safe key)
// ---------------------------------------------------------------------------

/**
 * Generates a deterministic, reorg-safe event ID.
 *
 * Why this works:
 *   If block 100 is reorged, the new block 100 has a DIFFERENT blockHash.
 *   So events from the old block 100 and new block 100 have different IDs.
 *   Downstream consumers can use this to invalidate old events cleanly.
 */
function createEventId(chainId, blockHash, txHash, logIndex) {
  return `${chainId}:${blockHash}:${txHash}:${logIndex}`;
}

// ---------------------------------------------------------------------------
// Factory: raw log → GenesisEvent
// ---------------------------------------------------------------------------

/**
 * Create a GenesisEvent from a decoded log.
 *
 * @param {object} params
 * @param {string} params.chain       — chain slug
 * @param {number} params.chainId
 * @param {object} params.log         — raw ethers.js Log object
 * @param {string} params.eventName   — e.g., "Transfer"
 * @param {string} params.eventType   — e.g., "ERC20_TRANSFER"
 * @param {object} params.args        — decoded arguments
 * @param {number} params.timestamp   — block timestamp
 * @param {string} params.finality    — current finality status
 * @param {string} params.explorerUrl — base explorer URL for the chain
 */
function createEvent({
  chain,
  chainId,
  log,
  eventName,
  eventType,
  args,
  timestamp,
  finality,
  explorerUrl,
}) {
  const blockNumber = log.blockNumber;
  const blockHash = log.blockHash;
  const txHash = log.transactionHash;
  const logIndex = log.index;

  return {
    id: createEventId(chainId, blockHash, txHash, logIndex),
    chain,
    chainId,
    blockNumber,
    blockHash,
    txHash,
    logIndex,
    contract: log.address?.toLowerCase(),
    eventName,
    eventType,
    args,
    finality,
    confirmations: 0, // updated by finality tracker
    timestamp: timestamp || 0,
    explorerUrl: explorerUrl
      ? `${explorerUrl}/tx/${txHash}`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Finality status enum
// ---------------------------------------------------------------------------
const FinalityStatus = {
  PENDING: "pending",
  SOFT_CONFIRMED: "soft_confirmed",
  FINALIZED: "finalized",
  REVERTED: "reverted",
};

module.exports = {
  createEventId,
  createEvent,
  FinalityStatus,
};
