/**
 * Genesis — Event Repository
 * 
 * Database operations for blockchain events.
 * Handles saving, updating finality, and querying events.
 */

class EventRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Save a single event to database
   * @param {import('../pipeline/event-model').GenesisEvent} event
   */
  async save(event) {
    const query = `
      INSERT INTO events (
        event_id, chain, chain_id,
        block_number, block_hash, block_timestamp,
        tx_hash, tx_index, log_index,
        contract_address, event_name, event_type,
        args, finality, finality_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (event_id) DO UPDATE SET
        finality = excluded.finality,
        finality_updated_at = excluded.finality_updated_at,
        updated_at = strftime('%s', 'now')
    `;

    const params = [
      event.id,  // Event model uses 'id' not 'eventId'
      event.chain,
      event.chainId,
      event.blockNumber,
      event.blockHash,
      event.timestamp,
      event.txHash,
      null,  // tx_index - not provided by event model
      event.logIndex,
      event.contract,  // Event model uses 'contract' not 'address'
      event.eventName,
      event.eventType,
      JSON.stringify(event.args),
      event.finality,
      Math.floor(Date.now() / 1000),
    ];

    try {
      await this.db.query(query, params);
      // Get last inserted ID
      const result = await this.db.query("SELECT last_insert_rowid() as id");
      return result.rows[0]?.id || null;
    } catch (err) {
      console.error(`  💥 [EventRepository] Save failed for ${event.id}: ${err?.message || err}`);
      throw err;
    }
  }

  /**
   * Save multiple events in a batch (transaction)
   * @param {Array<import('../pipeline/event-model').GenesisEvent>} events
   */
  async saveBatch(events) {
    if (events.length === 0) return [];

    const tx = this.db.beginTransaction();

    try {
      const ids = [];
      
      for (const event of events) {
        const query = `
          INSERT INTO events (
            event_id, chain, chain_id,
            block_number, block_hash, block_timestamp,
            tx_hash, tx_index, log_index,
            contract_address, event_name, event_type,
            args, finality, finality_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO UPDATE SET
            finality = excluded.finality,
            finality_updated_at = excluded.finality_updated_at,
            updated_at = strftime('%s', 'now')
        `;

        const params = [
          event.id,  // Event model uses 'id' not 'eventId'
          event.chain,
          event.chainId,
          event.blockNumber,
          event.blockHash,
          event.timestamp,
          event.txHash,
          null,  // tx_index - not provided by event model
          event.logIndex,
          event.contract,  // Event model uses 'contract' not 'address'
          event.eventName,
          event.eventType,
          JSON.stringify(event.args),
          event.finality,
          Math.floor(Date.now() / 1000),
        ];

        tx.query(query, params);
        // Get last inserted ID after each insert
        const result = tx.query("SELECT last_insert_rowid() as id");
        ids.push(result.rows[0]?.id || null);
      }

      tx.commit();
      return ids;
    } catch (err) {
      tx.rollback();
      console.error(`  💥 [EventRepository] Batch save failed: ${err?.message || err}`);
      throw err;
    }
  }

  /**
   * Update finality status for an event
   * @param {string} eventId
   * @param {string} newFinality
   */
  async updateFinality(eventId, newFinality) {
    const query = `
      UPDATE events
      SET finality = $1, finality_updated_at = $2, updated_at = NOW()
      WHERE event_id = $3
      RETURNING id
    `;

    const params = [newFinality, Math.floor(Date.now() / 1000), eventId];

    try {
      const result = await this.db.query(query, params);
      return result.rowCount > 0;
    } catch (err) {
      console.error(`  💥 [EventRepository] Finality update failed for ${eventId}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Update finality for multiple events (batch)
   * @param {Array<{eventId: string, finality: string}>} updates
   */
  async updateFinalityBatch(updates) {
    if (updates.length === 0) return;

    const tx = this.db.beginTransaction();

    try {
      for (const { eventId, finality } of updates) {
        tx.query(
          `UPDATE events SET finality = $1, finality_updated_at = $2, updated_at = strftime('%s', 'now') WHERE event_id = $3`,
          [finality, Math.floor(Date.now() / 1000), eventId]
        );
      }

      tx.commit();
    } catch (err) {
      tx.rollback();
      console.error(`  💥 [EventRepository] Batch finality update failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get events by block range
   * @param {string} chain
   * @param {number} fromBlock
   * @param {number} toBlock
   * @param {number} limit
   */
  async getByBlockRange(chain, fromBlock, toBlock, limit = 100) {
    const query = `
      SELECT * FROM events
      WHERE chain = $1 AND block_number >= $2 AND block_number <= $3
      ORDER BY block_number DESC, log_index ASC
      LIMIT $4
    `;

    const result = await this.db.query(query, [chain, fromBlock, toBlock, limit]);
    return result.rows.map(this._mapRow);
  }

  /**
   * Get events by contract address
   * @param {string} contractAddress
   * @param {number} limit
   */
  async getByContract(contractAddress, limit = 100) {
    const query = `
      SELECT * FROM events
      WHERE contract_address = $1
      ORDER BY block_number DESC, log_index ASC
      LIMIT $2
    `;

    const result = await this.db.query(query, [contractAddress.toLowerCase(), limit]);
    return result.rows.map(this._mapRow);
  }

  /**
   * Get events by transaction hash
   * @param {string} txHash
   */
  async getByTxHash(txHash) {
    const query = `
      SELECT * FROM events
      WHERE tx_hash = $1
      ORDER BY log_index ASC
    `;

    const result = await this.db.query(query, [txHash.toLowerCase()]);
    return result.rows.map(this._mapRow);
  }

  /**
   * Get recent events with filters
   * @param {Object} filters - { chain, eventType, finality, contractAddress }
   * @param {number} limit
   */
  async getRecent(filters = {}, limit = 100) {
    let query = `SELECT * FROM events WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (filters.chain) {
      query += ` AND chain = $${paramIndex++}`;
      params.push(filters.chain);
    }

    if (filters.eventType) {
      query += ` AND event_type = $${paramIndex++}`;
      params.push(filters.eventType);
    }

    if (filters.finality) {
      query += ` AND finality = $${paramIndex++}`;
      params.push(filters.finality);
    }

    if (filters.contractAddress) {
      query += ` AND contract_address = $${paramIndex++}`;
      params.push(filters.contractAddress.toLowerCase());
    }

    query += ` ORDER BY block_number DESC, log_index ASC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await this.db.query(query, params);
    return result.rows.map(this._mapRow);
  }

  /**
   * Get event count by filters
   */
  async getCount(filters = {}) {
    let query = `SELECT COUNT(*) as count FROM events WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (filters.chain) {
      query += ` AND chain = $${paramIndex++}`;
      params.push(filters.chain);
    }

    if (filters.eventType) {
      query += ` AND event_type = $${paramIndex++}`;
      params.push(filters.eventType);
    }

    if (filters.finality) {
      query += ` AND finality = $${paramIndex++}`;
      params.push(filters.finality);
    }

    const result = await this.db.query(query, params);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get stats summary
   */
  async getStats(chain) {
    const query = `
      SELECT
        COUNT(*) as total_events,
        COUNT(DISTINCT contract_address) as unique_contracts,
        COUNT(DISTINCT tx_hash) as unique_transactions,
        MIN(block_number) as first_block,
        MAX(block_number) as latest_block,
        COUNT(CASE WHEN finality = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN finality = 'soft_confirmed' THEN 1 END) as soft_confirmed_count,
        COUNT(CASE WHEN finality = 'final' THEN 1 END) as final_count
      FROM events
      WHERE chain = $1
    `;

    const result = await this.db.query(query, [chain]);
    return result.rows[0];
  }

  /**
   * Map database row to event object
   */
  _mapRow(row) {
    return {
      id: row.id,
      eventId: row.event_id,
      chain: row.chain,
      chainId: row.chain_id,
      blockNumber: parseInt(row.block_number, 10),
      blockHash: row.block_hash,
      timestamp: parseInt(row.block_timestamp, 10),
      txHash: row.tx_hash,
      txIndex: row.tx_index,
      logIndex: row.log_index,
      address: row.contract_address,
      eventName: row.event_name,
      eventType: row.event_type,
      args: row.args, // Already parsed as JSON by pg
      finality: row.finality,
      finalityUpdatedAt: row.finality_updated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = EventRepository;
