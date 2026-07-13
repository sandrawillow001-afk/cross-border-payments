import Database from 'better-sqlite3';
import {
  BatchState,
  BatchStatus,
  BatchPaymentEntry,
  BatchEntryStatus,
  TransactionGroup,
  NetworkType,
} from '../types';

/**
 * BatchDatabase — SQLite-backed persistence layer for batch payment state.
 *
 * ## Crash Recovery
 *
 * All writes that must be atomic are wrapped in explicit SQLite transactions
 * so that a process crash mid-operation never leaves the database in a
 * partially-written state.  The specific guarantees are:
 *
 * 1. **Batch initialisation** — `initBatch()` inserts the batch row *and*
 *    immediately sets status to `running` in a single transaction.  There is
 *    no window between creation and activation where a crash could leave a
 *    batch stuck in `created`.  A crash before this completes leaves no trace;
 *    processing must restart from the beginning.
 *
 * 2. **Entry seeding** — `insertEntries()` inserts all payment-entry rows in
 *    one transaction.  Either every entry exists or none do.
 *
 * 3. **Group + entry confirmation** — `confirmGroupWithEntries()` updates the
 *    transaction-group row *and* every associated payment-entry row atomically.
 *    If the process is killed after Horizon returns a success hash but before
 *    the writes complete, the whole update is rolled back so that `status` for
 *    those entries remains `submitted` — not a false `confirmed`.  On the next
 *    run the retry command will pick them up and re-check Horizon.
 *
 * 4. **Counter refresh** — `updateBatchCounters()` reads live entry stats and
 *    writes them back in one transaction so the summary numbers are always
 *    self-consistent.
 *
 * ## Resume After Crash / SIGINT
 *
 * When the process is interrupted (`SIGINT` / `SIGTERM`) the signal handler in
 * `batch.ts` calls `db.markBatchPaused(batchId)` which atomically sets the
 * batch status to `paused` and refreshes counters.  On restart:
 *
 * - `getBatchesNeedingResume()` returns all batches whose status is `paused`
 *   or `running` (a `running` batch whose process no longer exists crashed
 *   without calling `markBatchPaused`).  The batch command should call this on
 *   startup and offer the operator an option to resume each one.
 *
 * - `resumeBatch(batchId)` atomically resets status to `running` and refreshes
 *   counters.  Call this *before* re-entering the processing loop so that the
 *   batch is never left in `paused` state while work is actively in progress.
 *
 * - `getIncompleteGroups(batchId)` returns every transaction group that has
 *   not yet reached `confirmed` status, allowing the batch command to skip
 *   already-confirmed groups and only reprocess incomplete ones.
 *
 * - `getPendingEntriesByGroup(batchId, groupIndex)` returns all entries for a
 *   given group that are still `pending` or `submitted` (i.e. not yet
 *   confirmed), so partial groups can be resumed correctly.
 *
 * - `upsertGroup()` is idempotent — re-inserting a group that already exists
 *   (same batchId + groupIndex) updates it rather than creating a duplicate.
 *
 * - `stellar-payout retry --batch-id=<id>` retries every entry whose status
 *   is `failed`.
 *
 * ### Full resume flow
 *
 * ```
 * const paused = db.getBatchesNeedingResume();
 * for (const batch of paused) {
 *   db.resumeBatch(batch.batchId);                     // status → running
 *   const incomplete = db.getIncompleteGroups(batch.batchId);
 *   for (const group of incomplete) {
 *     const pending = db.getPendingEntriesByGroup(batch.batchId, group.groupIndex);
 *     // ... re-submit pending entries for this group
 *   }
 * }
 * ```
 *
 * ## SQLite Settings
 *
 * - WAL journal mode: readers never block writers, writers never block readers.
 * - `synchronous = FULL` (upgraded from NORMAL): the OS write-through cache is
 *   flushed after each transaction commit, so a power loss cannot corrupt the
 *   WAL file.  The slight throughput cost is acceptable given that the bottleneck
 *   is always the Horizon HTTP round-trip, not SQLite writes.
 */
export class BatchDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    // FULL ensures data reaches disk after every transaction commit.
    // This is the safest setting for crash recovery.
    this.db.pragma('synchronous = FULL');
    this.initialize();
  }

  // ---------------------------------------------------------------------------
  // Schema initialisation
  // ---------------------------------------------------------------------------

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS batches (
        batch_id TEXT PRIMARY KEY,
        total_payments INTEGER NOT NULL DEFAULT 0,
        processed_payments INTEGER NOT NULL DEFAULT 0,
        successful_payments INTEGER NOT NULL DEFAULT 0,
        failed_payments INTEGER NOT NULL DEFAULT 0,
        skipped_payments INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        status TEXT NOT NULL DEFAULT 'created',
        source_account TEXT NOT NULL DEFAULT '',
        network TEXT NOT NULL DEFAULT 'testnet',
        dry_run INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS payment_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        entry_index INTEGER NOT NULL,
        destination TEXT NOT NULL,
        amount TEXT NOT NULL,
        asset TEXT NOT NULL,
        asset_issuer TEXT NOT NULL DEFAULT '',
        memo TEXT NOT NULL DEFAULT '',
        escrow_duration INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        tx_hash TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        retry_count INTEGER NOT NULL DEFAULT 0,
        submitted_at INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER NOT NULL DEFAULT 0,
        batch_group INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
      );

      CREATE TABLE IF NOT EXISTS transaction_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        group_index INTEGER NOT NULL,
        tx_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        fee TEXT NOT NULL DEFAULT '0',
        submitted_at INTEGER NOT NULL DEFAULT 0,
        confirmed_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE (batch_id, group_index),
        FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
      );

      CREATE INDEX IF NOT EXISTS idx_entries_batch ON payment_entries(batch_id);
      CREATE INDEX IF NOT EXISTS idx_entries_status ON payment_entries(status);
      CREATE INDEX IF NOT EXISTS idx_entries_batch_group ON payment_entries(batch_id, batch_group);
      CREATE INDEX IF NOT EXISTS idx_groups_batch ON transaction_groups(batch_id);
      CREATE INDEX IF NOT EXISTS idx_groups_status ON transaction_groups(batch_id, status);
    `);
  }

  // ---------------------------------------------------------------------------
  // Batch lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Atomically create the batch record AND set its status to `running` in a
   * single SQLite transaction.  This eliminates the crash window that existed
   * when `createBatch` and `updateBatchStatus` were two separate calls —
   * previously, a crash between those two calls would leave a batch stuck in
   * `created` status, which `getBatchesNeedingResume()` would not detect.
   *
   * Callers that previously called `createBatch` + `updateBatchStatus(Running)`
   * should migrate to this method.  `createBatch` is retained for backward
   * compatibility but now delegates here.
   */
  initBatch(
    batchId: string,
    totalPayments: number,
    sourceAccount: string,
    network: NetworkType,
    dryRun: boolean,
  ): void {
    const init = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO batches
             (batch_id, total_payments, started_at, status, source_account, network, dry_run)
           VALUES (?, ?, ?, 'running', ?, ?, ?)`,
        )
        .run(batchId, totalPayments, Date.now(), sourceAccount, network, dryRun ? 1 : 0);
    });

    init();
  }

  /**
   * @deprecated Use `initBatch()` instead, which atomically creates the batch
   * and sets its status to `running` in a single transaction.  This method is
   * kept for backward compatibility and now delegates to `initBatch()`.
   */
  createBatch(
    batchId: string,
    totalPayments: number,
    sourceAccount: string,
    network: NetworkType,
    dryRun: boolean,
  ): void {
    this.initBatch(batchId, totalPayments, sourceAccount, network, dryRun);
  }

  updateBatchStatus(batchId: string, status: BatchStatus): void {
    let completedAt: number | null = null;
    if (
      status === BatchStatus.Completed ||
      status === BatchStatus.Failed ||
      status === BatchStatus.Cancelled
    ) {
      completedAt = Date.now();
    }
    this.db
      .prepare(`UPDATE batches SET status = ?, completed_at = ? WHERE batch_id = ?`)
      .run(status, completedAt, batchId);
  }

  /**
   * Atomically update batch counters by reading live stats from payment_entries.
   * Called after every group completes and on graceful shutdown.
   */
  updateBatchCounters(batchId: string): void {
    const refresh = this.db.transaction(() => {
      const stats = this.db
        .prepare(
          `SELECT
            COUNT(*)                                                          AS total,
            SUM(CASE WHEN status IN ('submitted','confirmed') THEN 1 ELSE 0 END) AS processed,
            SUM(CASE WHEN status = 'confirmed'  THEN 1 ELSE 0 END)           AS successful,
            SUM(CASE WHEN status = 'failed'     THEN 1 ELSE 0 END)           AS failed,
            SUM(CASE WHEN status = 'skipped'    THEN 1 ELSE 0 END)           AS skipped
          FROM payment_entries WHERE batch_id = ?`,
        )
        .get(batchId) as Record<string, number>;

      this.db
        .prepare(
          `UPDATE batches
           SET processed_payments = ?,
               successful_payments = ?,
               failed_payments = ?,
               skipped_payments = ?
           WHERE batch_id = ?`,
        )
        .run(stats.processed, stats.successful, stats.failed, stats.skipped, batchId);
    });

    refresh();
  }

  /**
   * Atomically sets batch status to `paused` and refreshes all counters.
   * Called by signal handlers so that a single synchronous call is sufficient
   * even in a signal context.
   */
  markBatchPaused(batchId: string): void {
    const pauseAndCount = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE batches SET status = ? WHERE batch_id = ?`)
        .run(BatchStatus.Paused, batchId);

      const stats = this.db
        .prepare(
          `SELECT
            SUM(CASE WHEN status IN ('submitted','confirmed') THEN 1 ELSE 0 END) AS processed,
            SUM(CASE WHEN status = 'confirmed'  THEN 1 ELSE 0 END)               AS successful,
            SUM(CASE WHEN status = 'failed'     THEN 1 ELSE 0 END)               AS failed,
            SUM(CASE WHEN status = 'skipped'    THEN 1 ELSE 0 END)               AS skipped
          FROM payment_entries WHERE batch_id = ?`,
        )
        .get(batchId) as Record<string, number>;

      this.db
        .prepare(
          `UPDATE batches
           SET processed_payments = ?,
               successful_payments = ?,
               failed_payments = ?,
               skipped_payments = ?
           WHERE batch_id = ?`,
        )
        .run(stats.processed, stats.successful, stats.failed, stats.skipped, batchId);
    });

    pauseAndCount();
  }

  /**
   * Atomically reset a paused (or stale-running) batch back to `running` and
   * refresh all counters from live entry data.
   *
   * Call this at the start of a resume run — before re-entering the processing
   * loop — so that the batch transitions cleanly from `paused` → `running`
   * and the counters accurately reflect the work already done.
   *
   * After calling `resumeBatch`, use `getIncompleteGroups` and
   * `getPendingEntriesByGroup` to determine which groups and entries still
   * need processing.
   */
  resumeBatch(batchId: string): void {
    const resume = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE batches SET status = 'running', completed_at = NULL WHERE batch_id = ?`)
        .run(batchId);

      const stats = this.db
        .prepare(
          `SELECT
            SUM(CASE WHEN status IN ('submitted','confirmed') THEN 1 ELSE 0 END) AS processed,
            SUM(CASE WHEN status = 'confirmed'  THEN 1 ELSE 0 END)               AS successful,
            SUM(CASE WHEN status = 'failed'     THEN 1 ELSE 0 END)               AS failed,
            SUM(CASE WHEN status = 'skipped'    THEN 1 ELSE 0 END)               AS skipped
          FROM payment_entries WHERE batch_id = ?`,
        )
        .get(batchId) as Record<string, number>;

      this.db
        .prepare(
          `UPDATE batches
           SET processed_payments = ?,
               successful_payments = ?,
               failed_payments = ?,
               skipped_payments = ?
           WHERE batch_id = ?`,
        )
        .run(stats.processed ?? 0, stats.successful ?? 0, stats.failed ?? 0, stats.skipped ?? 0, batchId);
    });

    resume();
  }

  /**
   * Return all batches that require resume attention:
   *
   * - `paused` — process received SIGINT/SIGTERM and called `markBatchPaused`.
   * - `running` — process crashed without a graceful shutdown; the status was
   *   never updated from `running` to `paused`/`completed`/`failed`.
   *
   * Ordered most-recently-started first so the operator sees the newest stale
   * batch at the top of the list.
   *
   * Typical usage:
   * ```ts
   * const stale = db.getBatchesNeedingResume();
   * for (const batch of stale) {
   *   db.resumeBatch(batch.batchId);
   *   const groups = db.getIncompleteGroups(batch.batchId);
   *   // ... re-process each incomplete group
   * }
   * ```
   */
  getBatchesNeedingResume(): BatchState[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM batches
         WHERE status IN ('paused', 'running')
         ORDER BY started_at DESC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToBatchState(r));
  }

  getBatch(batchId: string): BatchState | null {
    const row = this.db
      .prepare('SELECT * FROM batches WHERE batch_id = ?')
      .get(batchId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToBatchState(row);
  }

  getRecentBatches(limit: number = 10): BatchState[] {
    const rows = this.db
      .prepare('SELECT * FROM batches ORDER BY started_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToBatchState(r));
  }

  private rowToBatchState(row: Record<string, unknown>): BatchState {
    return {
      batchId: row.batch_id as string,
      totalPayments: row.total_payments as number,
      processedPayments: row.processed_payments as number,
      successfulPayments: row.successful_payments as number,
      failedPayments: row.failed_payments as number,
      skippedPayments: row.skipped_payments as number,
      startedAt: row.started_at as number,
      completedAt: row.completed_at as number | null,
      status: row.status as BatchStatus,
      sourceAccount: row.source_account as string,
      network: row.network as NetworkType,
      dryRun: (row.dry_run as number) === 1,
    };
  }

  // ---------------------------------------------------------------------------
  // Payment entries
  // ---------------------------------------------------------------------------

  insertEntry(batchId: string, entry: BatchPaymentEntry): void {
    this.db
      .prepare(
        `INSERT INTO payment_entries
           (batch_id, entry_index, destination, amount, asset, asset_issuer,
            memo, escrow_duration, status, batch_group)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        batchId,
        entry.index,
        entry.destination,
        entry.amount,
        entry.asset,
        entry.asset_issuer,
        entry.memo,
        entry.escrow_duration,
        entry.status,
        entry.batchGroup,
      );
  }

  /**
   * Bulk-insert all payment entries in a single atomic transaction.
   * Either every row is written or none are — partial seeding is not possible.
   */
  insertEntries(batchId: string, entries: BatchPaymentEntry[]): void {
    const insert = this.db.prepare(
      `INSERT INTO payment_entries
         (batch_id, entry_index, destination, amount, asset, asset_issuer,
          memo, escrow_duration, status, batch_group)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const bulkInsert = this.db.transaction((items: BatchPaymentEntry[]) => {
      for (const entry of items) {
        insert.run(
          batchId,
          entry.index,
          entry.destination,
          entry.amount,
          entry.asset,
          entry.asset_issuer,
          entry.memo,
          entry.escrow_duration,
          entry.status,
          entry.batchGroup,
        );
      }
    });
    bulkInsert(entries);
  }

  updateEntryStatus(
    batchId: string,
    index: number,
    status: BatchEntryStatus,
    txHash?: string,
    errorMsg?: string,
  ): void {
    const now = Date.now();
    if (status === BatchEntryStatus.Submitted) {
      this.db
        .prepare(
          `UPDATE payment_entries
           SET status = ?, tx_hash = ?, submitted_at = ?
           WHERE batch_id = ? AND entry_index = ?`,
        )
        .run(status, txHash ?? '', now, batchId, index);
    } else if (status === BatchEntryStatus.Confirmed) {
      this.db
        .prepare(
          `UPDATE payment_entries
           SET status = ?, tx_hash = ?, completed_at = ?
           WHERE batch_id = ? AND entry_index = ?`,
        )
        .run(status, txHash ?? '', now, batchId, index);
    } else if (status === BatchEntryStatus.Failed) {
      this.db
        .prepare(
          `UPDATE payment_entries
           SET status = ?, error = ?, retry_count = retry_count + 1
           WHERE batch_id = ? AND entry_index = ?`,
        )
        .run(status, errorMsg ?? '', batchId, index);
    } else {
      this.db
        .prepare(
          `UPDATE payment_entries SET status = ? WHERE batch_id = ? AND entry_index = ?`,
        )
        .run(status, batchId, index);
    }
  }

  getEntries(batchId: string): BatchPaymentEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM payment_entries WHERE batch_id = ? ORDER BY entry_index')
      .all(batchId) as Record<string, unknown>[];
    return rows.map(this.rowToEntry);
  }

  getFailedEntries(batchId: string): BatchPaymentEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM payment_entries
         WHERE batch_id = ? AND status = 'failed'
         ORDER BY entry_index`,
      )
      .all(batchId) as Record<string, unknown>[];
    return rows.map(this.rowToEntry);
  }

  /**
   * Return all payment entries for a specific group whose status is still
   * `pending` or `submitted`.  Used during resume to skip entries that were
   * already confirmed in a previous run.
   */
  getPendingEntriesByGroup(batchId: string, groupIndex: number): BatchPaymentEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM payment_entries
         WHERE batch_id = ? AND batch_group = ?
           AND status IN ('pending', 'submitted')
         ORDER BY entry_index`,
      )
      .all(batchId, groupIndex) as Record<string, unknown>[];
    return rows.map(this.rowToEntry);
  }

  private rowToEntry(row: Record<string, unknown>): BatchPaymentEntry {
    return {
      index: row.entry_index as number,
      destination: row.destination as string,
      amount: row.amount as string,
      asset: row.asset as string,
      asset_issuer: (row.asset_issuer as string) ?? '',
      memo: row.memo as string,
      escrow_duration: row.escrow_duration as number,
      status: row.status as BatchEntryStatus,
      txHash: row.tx_hash as string,
      error: row.error as string,
      retryCount: row.retry_count as number,
      submittedAt: row.submitted_at as number,
      completedAt: row.completed_at as number,
      batchGroup: row.batch_group as number,
    };
  }

  // ---------------------------------------------------------------------------
  // Transaction groups
  // ---------------------------------------------------------------------------

  /**
   * Insert a group record.  If a record for the same (batchId, groupIndex) pair
   * already exists (e.g. process restarted after a crash mid-insert) the
   * existing row is left unchanged — idempotent by design.
   */
  insertGroup(batchId: string, group: TransactionGroup): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO transaction_groups
           (batch_id, group_index, tx_hash, status, fee, submitted_at, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        batchId,
        group.groupIndex,
        group.txHash,
        group.status,
        group.fee,
        group.submittedAt,
        group.confirmedAt,
      );
  }

  /**
   * Upsert a transaction group — creates it if absent, updates it if present.
   * This is the preferred method when the caller cannot guarantee the group has
   * not been inserted yet (e.g. after a crash mid-processing).
   */
  upsertGroup(batchId: string, group: TransactionGroup): void {
    this.db
      .prepare(
        `INSERT INTO transaction_groups
           (batch_id, group_index, tx_hash, status, fee, submitted_at, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(batch_id, group_index) DO UPDATE SET
           tx_hash      = excluded.tx_hash,
           status       = excluded.status,
           fee          = excluded.fee,
           submitted_at = excluded.submitted_at,
           confirmed_at = excluded.confirmed_at`,
      )
      .run(
        batchId,
        group.groupIndex,
        group.txHash,
        group.status,
        group.fee,
        group.submittedAt,
        group.confirmedAt,
      );
  }

  /**
   * Atomically mark a transaction group as confirmed *and* update every
   * associated payment entry to `confirmed` in one transaction.
   *
   * This prevents the inconsistency where a crash between updating the group
   * row and updating the entry rows would leave entries perpetually stuck in
   * `submitted` state even though the transaction succeeded on-chain.
   */
  confirmGroupWithEntries(
    batchId: string,
    groupIndex: number,
    txHash: string,
    entryIndices: number[],
  ): void {
    const now = Date.now();
    const confirmGroup = this.db.transaction(() => {
      // Update the group row
      this.db
        .prepare(
          `UPDATE transaction_groups
           SET status = 'confirmed', tx_hash = ?, confirmed_at = ?
           WHERE batch_id = ? AND group_index = ?`,
        )
        .run(txHash, now, batchId, groupIndex);

      // Update every entry in the group
      const updateEntry = this.db.prepare(
        `UPDATE payment_entries
         SET status = 'confirmed', tx_hash = ?, completed_at = ?
         WHERE batch_id = ? AND entry_index = ?`,
      );
      for (const idx of entryIndices) {
        updateEntry.run(txHash, now, batchId, idx);
      }
    });

    confirmGroup();
  }

  /**
   * Atomically mark a transaction group as failed *and* update every associated
   * payment entry to `failed` in one transaction.
   */
  failGroupWithEntries(
    batchId: string,
    groupIndex: number,
    errorMsg: string,
    entryIndices: number[],
  ): void {
    const failGroup = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE transaction_groups
           SET status = 'failed'
           WHERE batch_id = ? AND group_index = ?`,
        )
        .run(batchId, groupIndex);

      const updateEntry = this.db.prepare(
        `UPDATE payment_entries
         SET status = 'failed',
             error = ?,
             retry_count = retry_count + 1
         WHERE batch_id = ? AND entry_index = ?`,
      );
      for (const idx of entryIndices) {
        updateEntry.run(errorMsg, batchId, idx);
      }
    });

    failGroup();
  }

  updateGroupStatus(
    batchId: string,
    groupIndex: number,
    status: BatchEntryStatus,
    txHash?: string,
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE transaction_groups
         SET status = ?, tx_hash = ?, confirmed_at = ?
         WHERE batch_id = ? AND group_index = ?`,
      )
      .run(status, txHash ?? '', now, batchId, groupIndex);
  }

  /**
   * Return all transaction groups for a batch that have not reached `confirmed`
   * status.  Used during resume to determine which groups still need processing.
   */
  getIncompleteGroups(batchId: string): TransactionGroup[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM transaction_groups
         WHERE batch_id = ? AND status != 'confirmed'
         ORDER BY group_index`,
      )
      .all(batchId) as Record<string, unknown>[];
    return rows.map(this.rowToGroup);
  }

  getGroups(batchId: string): TransactionGroup[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM transaction_groups WHERE batch_id = ? ORDER BY group_index',
      )
      .all(batchId) as Record<string, unknown>[];
    return rows.map(this.rowToGroup);
  }

  private rowToGroup(row: Record<string, unknown>): TransactionGroup {
    return {
      groupIndex: row.group_index as number,
      entries: [],
      txHash: row.tx_hash as string,
      status: row.status as BatchEntryStatus,
      fee: row.fee as string,
      submittedAt: row.submitted_at as number,
      confirmedAt: row.confirmed_at as number,
    };
  }

  // ---------------------------------------------------------------------------
  // Housekeeping
  // ---------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
