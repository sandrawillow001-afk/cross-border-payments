/**
 * Tests for BatchDatabase — crash recovery and atomic state persistence.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BatchDatabase } from './database';
import {
  BatchEntryStatus,
  BatchPaymentEntry,
  BatchStatus,
  NetworkType,
  TransactionGroup,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `stellar-payout-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function makeEntry(
  index: number,
  batchGroup: number,
  overrides: Partial<BatchPaymentEntry> = {},
): BatchPaymentEntry {
  return {
    index,
    destination: `GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBN${String(index).padStart(5, '0')}`,
    amount: '100.00',
    asset: 'USDC',
    asset_issuer: '',
    memo: `payment-${index}`,
    escrow_duration: 0,
    status: BatchEntryStatus.Pending,
    txHash: '',
    error: '',
    retryCount: 0,
    submittedAt: 0,
    completedAt: 0,
    batchGroup,
    ...overrides,
  };
}

function makeGroup(groupIndex: number, overrides: Partial<TransactionGroup> = {}): TransactionGroup {
  return {
    groupIndex,
    entries: [],
    txHash: '',
    status: BatchEntryStatus.Pending,
    fee: '1000',
    submittedAt: 0,
    confirmedAt: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('BatchDatabase', () => {
  let dbPath: string;
  let db: BatchDatabase;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new BatchDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  // -------------------------------------------------------------------------
  // Batch creation and state
  // -------------------------------------------------------------------------

  describe('batch creation', () => {
    it('createBatch sets status to running (delegates to initBatch)', () => {
      db.createBatch('batch-1', 5, 'GABC', NetworkType.Testnet, false);
      const state = db.getBatch('batch-1');
      expect(state).not.toBeNull();
      expect(state!.batchId).toBe('batch-1');
      expect(state!.totalPayments).toBe(5);
      expect(state!.sourceAccount).toBe('GABC');
      expect(state!.network).toBe(NetworkType.Testnet);
      expect(state!.dryRun).toBe(false);
      // createBatch now delegates to initBatch which atomically sets 'running'
      expect(state!.status).toBe(BatchStatus.Running);
    });

    it('initBatch atomically creates and sets status to running', () => {
      db.initBatch('batch-init', 10, 'GXYZ', NetworkType.Mainnet, false);
      const state = db.getBatch('batch-init')!;
      expect(state.status).toBe(BatchStatus.Running);
      expect(state.totalPayments).toBe(10);
      expect(state.sourceAccount).toBe('GXYZ');
      expect(state.network).toBe(NetworkType.Mainnet);
    });

    it('records dryRun flag correctly', () => {
      db.createBatch('batch-dry', 3, 'GABC', NetworkType.Testnet, true);
      expect(db.getBatch('batch-dry')!.dryRun).toBe(true);
    });
  });

  describe('updateBatchStatus', () => {
    it('transitions status from running to completed', () => {
      db.createBatch('batch-2', 1, 'GABC', NetworkType.Testnet, false);
      db.updateBatchStatus('batch-2', BatchStatus.Completed);
      expect(db.getBatch('batch-2')!.status).toBe(BatchStatus.Completed);
    });

    it('sets completedAt when status is completed', () => {
      db.createBatch('batch-3', 1, 'GABC', NetworkType.Testnet, false);
      const before = Date.now();
      db.updateBatchStatus('batch-3', BatchStatus.Completed);
      const state = db.getBatch('batch-3')!;
      expect(state.completedAt).not.toBeNull();
      expect(state.completedAt!).toBeGreaterThanOrEqual(before);
    });

    it('does not set completedAt when transitioning to running', () => {
      db.createBatch('batch-4', 1, 'GABC', NetworkType.Testnet, false);
      // createBatch already sets running; pause first then re-check
      db.markBatchPaused('batch-4');
      db.updateBatchStatus('batch-4', BatchStatus.Running);
      expect(db.getBatch('batch-4')!.completedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // resumeBatch — atomic resume + counter refresh
  // -------------------------------------------------------------------------

  describe('resumeBatch', () => {
    it('transitions status from paused to running', () => {
      db.createBatch('batch-res', 2, 'GABC', NetworkType.Testnet, false);
      db.markBatchPaused('batch-res');
      expect(db.getBatch('batch-res')!.status).toBe(BatchStatus.Paused);
      db.resumeBatch('batch-res');
      expect(db.getBatch('batch-res')!.status).toBe(BatchStatus.Running);
    });

    it('refreshes counters on resume', () => {
      db.createBatch('batch-rescnt', 3, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-rescnt', [makeEntry(0, 0), makeEntry(1, 0), makeEntry(2, 0)]);
      db.updateEntryStatus('batch-rescnt', 0, BatchEntryStatus.Confirmed, 'h0');
      db.updateEntryStatus('batch-rescnt', 1, BatchEntryStatus.Failed);
      db.markBatchPaused('batch-rescnt');
      db.resumeBatch('batch-rescnt');

      const state = db.getBatch('batch-rescnt')!;
      expect(state.status).toBe(BatchStatus.Running);
      expect(state.successfulPayments).toBe(1);
      expect(state.failedPayments).toBe(1);
    });

    it('clears completedAt on resume', () => {
      db.createBatch('batch-resclr', 1, 'GABC', NetworkType.Testnet, false);
      db.updateBatchStatus('batch-resclr', BatchStatus.Completed);
      db.resumeBatch('batch-resclr');
      expect(db.getBatch('batch-resclr')!.completedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getBatchesNeedingResume — stale batch detection
  // -------------------------------------------------------------------------

  describe('getBatchesNeedingResume', () => {
    it('returns paused batches', () => {
      db.createBatch('batch-stale1', 1, 'GABC', NetworkType.Testnet, false);
      db.markBatchPaused('batch-stale1');
      const stale = db.getBatchesNeedingResume();
      expect(stale.map((b) => b.batchId)).toContain('batch-stale1');
    });

    it('returns running batches (crash without graceful shutdown)', () => {
      db.createBatch('batch-stale2', 1, 'GABC', NetworkType.Testnet, false);
      // createBatch → initBatch sets 'running' atomically, simulating a crash mid-run
      const stale = db.getBatchesNeedingResume();
      expect(stale.map((b) => b.batchId)).toContain('batch-stale2');
    });

    it('does not return completed or failed batches', () => {
      db.createBatch('batch-done', 1, 'GABC', NetworkType.Testnet, false);
      db.updateBatchStatus('batch-done', BatchStatus.Completed);
      db.createBatch('batch-fail', 1, 'GABC', NetworkType.Testnet, false);
      db.updateBatchStatus('batch-fail', BatchStatus.Failed);

      const stale = db.getBatchesNeedingResume();
      const ids = stale.map((b) => b.batchId);
      expect(ids).not.toContain('batch-done');
      expect(ids).not.toContain('batch-fail');
    });

    it('orders results by started_at descending', () => {
      db.createBatch('batch-ord1', 1, 'GABC', NetworkType.Testnet, false);
      db.markBatchPaused('batch-ord1');
      db.createBatch('batch-ord2', 1, 'GABC', NetworkType.Testnet, false);
      db.markBatchPaused('batch-ord2');

      const stale = db.getBatchesNeedingResume();
      const ids = stale.map((b) => b.batchId);
      // Most recently started should appear first
      expect(ids.indexOf('batch-ord2')).toBeLessThan(ids.indexOf('batch-ord1'));
    });
  });

  // -------------------------------------------------------------------------
  // markBatchPaused — atomic pause + counter refresh
  // -------------------------------------------------------------------------

  describe('markBatchPaused', () => {
    it('atomically sets status to paused and refreshes counters', () => {
      db.createBatch('batch-pause', 3, 'GABC', NetworkType.Testnet, false);
      const entries = [makeEntry(0, 0), makeEntry(1, 0), makeEntry(2, 0)];
      db.insertEntries('batch-pause', entries);

      db.updateEntryStatus('batch-pause', 0, BatchEntryStatus.Confirmed, 'hash-0');
      db.updateEntryStatus('batch-pause', 1, BatchEntryStatus.Failed);
      // entry 2 stays pending

      db.markBatchPaused('batch-pause');
      const state = db.getBatch('batch-pause')!;

      expect(state.status).toBe(BatchStatus.Paused);
      expect(state.successfulPayments).toBe(1);
      expect(state.failedPayments).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Entry bulk insert — atomicity
  // -------------------------------------------------------------------------

  describe('insertEntries', () => {
    it('inserts all entries in a single transaction', () => {
      db.createBatch('batch-5', 3, 'GABC', NetworkType.Testnet, false);
      const entries = [makeEntry(0, 0), makeEntry(1, 0), makeEntry(2, 1)];
      db.insertEntries('batch-5', entries);

      const stored = db.getEntries('batch-5');
      expect(stored).toHaveLength(3);
    });

    it('preserves batchGroup on each entry', () => {
      db.createBatch('batch-6', 2, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-6', [makeEntry(0, 0), makeEntry(1, 1)]);

      const stored = db.getEntries('batch-6');
      expect(stored[0].batchGroup).toBe(0);
      expect(stored[1].batchGroup).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // confirmGroupWithEntries — atomic group + entry confirmation
  // -------------------------------------------------------------------------

  describe('confirmGroupWithEntries', () => {
    it('sets group status to confirmed with a tx hash', () => {
      db.createBatch('batch-cg', 2, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-cg', [makeEntry(0, 0), makeEntry(1, 0)]);
      db.upsertGroup('batch-cg', makeGroup(0));

      db.confirmGroupWithEntries('batch-cg', 0, 'abc123', [0, 1]);

      const groups = db.getGroups('batch-cg');
      expect(groups[0].txHash).toBe('abc123');
      expect(groups[0].status).toBe(BatchEntryStatus.Confirmed);
    });

    it('sets all entry statuses to confirmed with the correct tx hash', () => {
      db.createBatch('batch-ce', 2, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-ce', [makeEntry(0, 0), makeEntry(1, 0)]);
      db.upsertGroup('batch-ce', makeGroup(0));

      db.confirmGroupWithEntries('batch-ce', 0, 'hash-xyz', [0, 1]);

      const entries = db.getEntries('batch-ce');
      for (const entry of entries) {
        expect(entry.status).toBe(BatchEntryStatus.Confirmed);
        expect(entry.txHash).toBe('hash-xyz');
        expect(entry.completedAt).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // failGroupWithEntries — atomic group + entry failure
  // -------------------------------------------------------------------------

  describe('failGroupWithEntries', () => {
    it('sets group status to failed', () => {
      db.createBatch('batch-fg', 2, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-fg', [makeEntry(0, 0), makeEntry(1, 0)]);
      db.upsertGroup('batch-fg', makeGroup(0));

      db.failGroupWithEntries('batch-fg', 0, 'horizon error', [0, 1]);

      const groups = db.getGroups('batch-fg');
      expect(groups[0].status).toBe(BatchEntryStatus.Failed);
    });

    it('increments retry_count on each failed entry', () => {
      db.createBatch('batch-fr', 2, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-fr', [makeEntry(0, 0), makeEntry(1, 0)]);
      db.upsertGroup('batch-fr', makeGroup(0));

      db.failGroupWithEntries('batch-fr', 0, 'error', [0, 1]);

      const entries = db.getEntries('batch-fr');
      for (const entry of entries) {
        expect(entry.status).toBe(BatchEntryStatus.Failed);
        expect(entry.retryCount).toBe(1);
        expect(entry.error).toBe('error');
      }
    });
  });

  // -------------------------------------------------------------------------
  // upsertGroup — idempotency
  // -------------------------------------------------------------------------

  describe('upsertGroup', () => {
    it('creates a group row on first call', () => {
      db.createBatch('batch-ug', 1, 'GABC', NetworkType.Testnet, false);
      db.upsertGroup('batch-ug', makeGroup(0));

      const groups = db.getGroups('batch-ug');
      expect(groups).toHaveLength(1);
      expect(groups[0].groupIndex).toBe(0);
    });

    it('updates an existing group row without creating a duplicate', () => {
      db.createBatch('batch-ug2', 1, 'GABC', NetworkType.Testnet, false);
      db.upsertGroup('batch-ug2', makeGroup(0, { status: BatchEntryStatus.Pending }));
      db.upsertGroup('batch-ug2', makeGroup(0, { txHash: 'updated-hash', status: BatchEntryStatus.Confirmed }));

      const groups = db.getGroups('batch-ug2');
      expect(groups).toHaveLength(1);
      expect(groups[0].txHash).toBe('updated-hash');
      expect(groups[0].status).toBe(BatchEntryStatus.Confirmed);
    });
  });

  // -------------------------------------------------------------------------
  // insertGroup — OR IGNORE idempotency
  // -------------------------------------------------------------------------

  describe('insertGroup', () => {
    it('silently ignores a duplicate (batchId, groupIndex) insert', () => {
      db.createBatch('batch-ig', 1, 'GABC', NetworkType.Testnet, false);
      db.insertGroup('batch-ig', makeGroup(0, { txHash: 'first' }));
      // Second insert for the same group should be ignored without throwing
      expect(() => db.insertGroup('batch-ig', makeGroup(0, { txHash: 'second' }))).not.toThrow();

      const groups = db.getGroups('batch-ig');
      expect(groups).toHaveLength(1);
      // The original insert is preserved
      expect(groups[0].txHash).toBe('first');
    });
  });

  // -------------------------------------------------------------------------
  // getIncompleteGroups — resume support
  // -------------------------------------------------------------------------

  describe('getIncompleteGroups', () => {
    it('returns only groups that are not confirmed', () => {
      db.createBatch('batch-ic', 4, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-ic', [
        makeEntry(0, 0), makeEntry(1, 0),
        makeEntry(2, 1), makeEntry(3, 1),
      ]);

      db.upsertGroup('batch-ic', makeGroup(0));
      db.upsertGroup('batch-ic', makeGroup(1));

      // Confirm group 0
      db.confirmGroupWithEntries('batch-ic', 0, 'hash-0', [0, 1]);

      const incomplete = db.getIncompleteGroups('batch-ic');
      expect(incomplete).toHaveLength(1);
      expect(incomplete[0].groupIndex).toBe(1);
    });

    it('returns empty array when all groups are confirmed', () => {
      db.createBatch('batch-allc', 2, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-allc', [makeEntry(0, 0), makeEntry(1, 0)]);
      db.upsertGroup('batch-allc', makeGroup(0));
      db.confirmGroupWithEntries('batch-allc', 0, 'hash-done', [0, 1]);

      expect(db.getIncompleteGroups('batch-allc')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getPendingEntriesByGroup — resume support
  // -------------------------------------------------------------------------

  describe('getPendingEntriesByGroup', () => {
    it('returns only pending/submitted entries for the given group', () => {
      db.createBatch('batch-pe', 3, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-pe', [
        makeEntry(0, 0),
        makeEntry(1, 0),
        makeEntry(2, 0),
      ]);

      // Confirm entry 0, leave 1 and 2 pending
      db.updateEntryStatus('batch-pe', 0, BatchEntryStatus.Confirmed, 'hash-0');

      const pending = db.getPendingEntriesByGroup('batch-pe', 0);
      expect(pending.map((e) => e.index)).toEqual([1, 2]);
    });

    it('includes submitted entries (not yet confirmed)', () => {
      db.createBatch('batch-sub', 2, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-sub', [makeEntry(0, 0), makeEntry(1, 0)]);

      db.updateEntryStatus('batch-sub', 0, BatchEntryStatus.Submitted, 'pending-hash');

      const pending = db.getPendingEntriesByGroup('batch-sub', 0);
      expect(pending).toHaveLength(2); // both submitted and pending
    });
  });

  // -------------------------------------------------------------------------
  // updateBatchCounters
  // -------------------------------------------------------------------------

  describe('updateBatchCounters', () => {
    it('correctly counts confirmed, failed, and skipped entries', () => {
      db.createBatch('batch-cnt', 4, 'GABC', NetworkType.Testnet, false);
      const entries = [
        makeEntry(0, 0), makeEntry(1, 0),
        makeEntry(2, 1), makeEntry(3, 1),
      ];
      db.insertEntries('batch-cnt', entries);

      db.updateEntryStatus('batch-cnt', 0, BatchEntryStatus.Confirmed, 'h0');
      db.updateEntryStatus('batch-cnt', 1, BatchEntryStatus.Confirmed, 'h0');
      db.updateEntryStatus('batch-cnt', 2, BatchEntryStatus.Failed);
      db.updateEntryStatus('batch-cnt', 3, BatchEntryStatus.Skipped);

      db.updateBatchCounters('batch-cnt');
      const state = db.getBatch('batch-cnt')!;

      expect(state.successfulPayments).toBe(2);
      expect(state.failedPayments).toBe(1);
      expect(state.skippedPayments).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getFailedEntries — retry support
  // -------------------------------------------------------------------------

  describe('getFailedEntries', () => {
    it('returns only entries with failed status', () => {
      db.createBatch('batch-fe', 3, 'GABC', NetworkType.Testnet, false);
      db.insertEntries('batch-fe', [makeEntry(0, 0), makeEntry(1, 0), makeEntry(2, 0)]);

      db.updateEntryStatus('batch-fe', 0, BatchEntryStatus.Confirmed, 'hash');
      db.updateEntryStatus('batch-fe', 1, BatchEntryStatus.Failed);

      const failed = db.getFailedEntries('batch-fe');
      expect(failed).toHaveLength(1);
      expect(failed[0].index).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getRecentBatches
  // -------------------------------------------------------------------------

  describe('getRecentBatches', () => {
    it('returns batches ordered by started_at descending', () => {
      db.createBatch('batch-r1', 1, 'GABC', NetworkType.Testnet, false);
      db.createBatch('batch-r2', 2, 'GABC', NetworkType.Testnet, false);

      const recent = db.getRecentBatches(10);
      // Most recent should come first
      expect(recent[0].batchId).toBe('batch-r2');
      expect(recent[1].batchId).toBe('batch-r1');
    });

    it('respects the limit parameter', () => {
      db.createBatch('batch-l1', 1, 'GABC', NetworkType.Testnet, false);
      db.createBatch('batch-l2', 1, 'GABC', NetworkType.Testnet, false);
      db.createBatch('batch-l3', 1, 'GABC', NetworkType.Testnet, false);

      expect(db.getRecentBatches(2)).toHaveLength(2);
    });
  });
});
