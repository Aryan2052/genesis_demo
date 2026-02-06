/**
 * Genesis — ABI Decoder
 *
 * Decodes raw blockchain logs into canonical GenesisEvents.
 *
 * Supports:
 *   - ERC-20 Transfer
 *   - ERC-721 Transfer
 *   - Uniswap V2 Swap / Mint / Burn
 *   - Extensible: add new ABIs in src/config/abis/
 *
 * Returns null for logs that don't match any known ABI — they're silently
 * dropped (this IS the selective indexing — we only decode what we understand).
 */

const { ethers } = require("ethers");
const { createEvent, FinalityStatus } = require("./event-model");

class Decoder {
  /**
   * @param {object} chainConfig — chain entry from config.getChain()
   * @param {object} abis — the config.abis object
   */
  constructor(chainConfig, abis) {
    this.chain = chainConfig;
    this.interfaces = new Map(); // topic0 → [ { iface, eventName, eventType }, ... ]

    this._registerAbis(abis);
  }

  // ---------------------------------------------------------------------------
  // ABI Registration
  // ---------------------------------------------------------------------------

  _registerAbis(abis) {
    // ERC-20
    if (abis.erc20) {
      this._register(abis.erc20, "ERC20");
    }
    // ERC-721
    if (abis.erc721) {
      this._register(abis.erc721, "ERC721");
    }
    // Uniswap V2
    if (abis.uniswapV2) {
      this._register(abis.uniswapV2, "UNISWAP_V2");
    }
    // Uniswap V3
    if (abis.uniswapV3) {
      this._register(abis.uniswapV3, "UNISWAP");
    }
    // Aave V3
    if (abis.aaveV3) {
      this._register(abis.aaveV3, "AAVE");
    }
    // Pausable
    if (abis.pausable) {
      this._register(abis.pausable, "PAUSABLE");
    }

    const totalEntries = Array.from(this.interfaces.values()).reduce((sum, arr) => sum + arr.length, 0);
    console.log(
      `  🔍 [Decoder] Registered ${totalEntries} event handler(s) across ${this.interfaces.size} unique topic(s) for ${this.chain.slug}`
    );
  }

  _register(abiFragments, category) {
    const iface = new ethers.Interface(abiFragments);

    for (const fragment of iface.fragments) {
      if (fragment.type !== "event") continue;
      const topic0 = iface.getEvent(fragment.name).topicHash;
      
      // Build event type: category_eventname (e.g., "ERC20_TRANSFER", "UNISWAP_SWAP")
      const eventType = `${category}_${fragment.name.toUpperCase()}`;
      const entry = { iface, eventName: fragment.name, eventType };

      if (!this.interfaces.has(topic0)) {
        this.interfaces.set(topic0, [entry]);
      } else {
        this.interfaces.get(topic0).push(entry);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Decode a single raw log → GenesisEvent | null
  // ---------------------------------------------------------------------------

  /**
   * @param {ethers.Log} log — raw log from eth_getLogs
   * @param {object}     blockInfo — { timestamp }
   * @param {string}     finality  — current finality status
   * @returns {import('./event-model').GenesisEvent | null}
   */
  decode(log, blockInfo = {}, finality = FinalityStatus.PENDING) {
    if (!log.topics || log.topics.length === 0) return null;

    const topic0 = log.topics[0];
    const candidates = this.interfaces.get(topic0);

    if (!candidates) return null;

    // Try each registered interface for this topic0.
    // ERC-20 and ERC-721 Transfer share the same topic0 but have different
    // indexed param counts (ERC-20: 2 indexed → 3 topics, ERC-721: 3 indexed → 4 topics).
    // We try each and take the first one that parses successfully.

    let parsed = null;
    let matchedEntry = null;

    for (const candidate of candidates) {
      try {
        parsed = candidate.iface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        if (parsed) {
          matchedEntry = candidate;
          break;
        }
      } catch (_) {
        // This interface didn't match — try next candidate
      }
    }

    const { eventName, eventType } = matchedEntry || candidates[0];

    let args = {};

    if (parsed) {
      // Build a clean args object from the decoded values
      for (const [key, value] of Object.entries(parsed.args)) {
        if (/^\d+$/.test(key)) continue;
        args[key] = typeof value === "bigint" ? value.toString() : value;
      }
    } else {
      // --- Manual fallback for non-standard events (e.g. USDT Solidity 0.4.x) ---
      // USDT emits Transfer with from/to in BOTH topics AND data.
      // We extract from/to from topics and try to find value in data.

      if (eventType.startsWith("ERC20") && log.topics.length === 3) {
        try {
          const from = ethers.getAddress("0x" + log.topics[1].slice(26));
          const to = ethers.getAddress("0x" + log.topics[2].slice(26));

          const dataHex = log.data.slice(2); // strip 0x
          const dataWords = dataHex.length / 64; // number of 32-byte words

          let value;
          if (dataWords === 1) {
            value = BigInt("0x" + dataHex.slice(0, 64)).toString();
          } else if (dataWords === 2) {
            const firstIsAddr = dataHex.slice(0, 24) === "000000000000000000000000";
            const lastIsAddr = dataHex.slice(64, 88) === "000000000000000000000000";

            if (firstIsAddr && lastIsAddr) {
              return null; // dup of from/to with no value — skip
            }
            value = BigInt("0x" + dataHex.slice(64, 128)).toString();
          } else {
            return null;
          }

          args = { from, to, value, _rawValue: value };
        } catch (_) {
          return null;
        }
      } else {
        return null;
      }
    }

    // Add computed fields for ERC20 transfers
    if (eventType === "ERC20_TRANSFER" && args.value) {
      args._rawValue = args.value;
    }

    try {
      return createEvent({
        chain: this.chain.slug,
        chainId: this.chain.chainId,
        log,
        eventName,
        eventType,
        args,
        timestamp: blockInfo.timestamp || 0,
        finality,
        explorerUrl: this.chain.explorerUrl,
      });
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Batch decode
  // ---------------------------------------------------------------------------

  /**
   * Decode an array of raw logs. Silently drops unrecognized events.
   * @param {ethers.Log[]} logs
   * @param {object} blockInfo
   * @param {string} finality
   * @returns {import('./event-model').GenesisEvent[]}
   */
  decodeBatch(logs, blockInfo = {}, finality = FinalityStatus.PENDING) {
    return logs
      .map((log) => this.decode(log, blockInfo, finality))
      .filter(Boolean); // drop nulls
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /** Returns the set of topic0 hashes this decoder can handle. */
  getKnownTopics() {
    return Array.from(this.interfaces.keys());
  }
}

module.exports = Decoder;
