import axios from 'axios';
import { BatchDatabase } from '../utils/database';
import { StatusStreamOptions, BatchEntryStatus, BatchStatus } from '../types';
import * as logger from '../utils/logger';

export async function executeStatus(options: StatusStreamOptions): Promise<void> {
  const db = new BatchDatabase(options.dbPath);

  logger.banner('Stellar Payout - Batch Status');

  if (options.batchId) {
    await showBatchStatus(db, options);
  } else {
    showRecentBatches(db);
  }

  db.close();
}

async function showBatchStatus(db: BatchDatabase, options: StatusStreamOptions): Promise<void> {
  const batch = db.getBatch(options.batchId);
  if (!batch) {
    logger.error(`Batch not found: ${options.batchId}`);
    return;
  }

  logger.table(
    ['Property', 'Value'],
    [
      ['Batch ID', batch.batchId],
      ['Status', batch.status],
      ['Network', batch.network],
      ['Source Account', batch.sourceAccount],
      ['Total Payments', String(batch.totalPayments)],
      ['Processed', String(batch.processedPayments)],
      ['Successful', String(batch.successfulPayments)],
      ['Failed', String(batch.failedPayments)],
      ['Skipped', String(batch.skippedPayments)],
      ['Started At', new Date(batch.startedAt).toISOString()],
      ['Completed At', batch.completedAt ? new Date(batch.completedAt).toISOString() : 'In Progress'],
      ['Dry Run', batch.dryRun ? 'Yes' : 'No'],
    ]
  );

  // Show entries
  const entries = db.getEntries(options.batchId);
  if (entries.length > 0) {
    logger.info(`\nPayment Entries (${entries.length} total):`);

    const statusCounts: Record<string, number> = {};
    entries.forEach((e) => {
      statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
    });

    logger.table(
      ['Status', 'Count'],
      Object.entries(statusCounts).map(([status, count]) => [status, String(count)])
    );

    // Show failed entries details
    const failed = entries.filter((e) => e.status === BatchEntryStatus.Failed);
    if (failed.length > 0) {
      logger.warn(`\nFailed Entries (${failed.length}):`);
      logger.table(
        ['Index', 'Destination', 'Amount', 'Asset', 'Error', 'Retries'],
        failed.slice(0, 20).map((e) => [
          String(e.index),
          e.destination.substring(0, 12) + '...',
          e.amount,
          e.asset,
          e.error.substring(0, 40),
          String(e.retryCount),
        ])
      );
      if (failed.length > 20) {
        logger.info(`... and ${failed.length - 20} more failed entries`);
      }
    }
  }

  // Show transaction groups
  const groups = db.getGroups(options.batchId);
  if (groups.length > 0) {
    logger.info(`\nTransaction Groups (${groups.length}):`);
    logger.table(
      ['Group', 'Status', 'Tx Hash', 'Fee', 'Submitted', 'Confirmed'],
      groups.slice(0, 20).map((g) => [
        String(g.groupIndex),
        g.status,
        g.txHash ? g.txHash.substring(0, 16) + '...' : '-',
        g.fee || '-',
        g.submittedAt ? new Date(g.submittedAt).toISOString() : '-',
        g.confirmedAt ? new Date(g.confirmedAt).toISOString() : '-',
      ])
    );
  }

  // Stream mode: monitor via Horizon
  if (options.follow && batch.status === BatchStatus.Running) {
    await streamBatchProgress(db, options);
  }
}

function showRecentBatches(db: BatchDatabase): void {
  const batches = db.getRecentBatches(10);

  if (batches.length === 0) {
    logger.info('No batches found. Run "stellar-payout batch" to start processing.');
    return;
  }

  logger.info('Recent Batches:');
  logger.table(
    ['Batch ID', 'Status', 'Total', 'Success', 'Failed', 'Network', 'Started'],
    batches.map((b) => [
      b.batchId,
      b.status,
      String(b.totalPayments),
      String(b.successfulPayments),
      String(b.failedPayments),
      b.network,
      new Date(b.startedAt).toISOString(),
    ])
  );
}

async function streamBatchProgress(db: BatchDatabase, options: StatusStreamOptions): Promise<void> {
  logger.info('\nStreaming batch progress (Ctrl+C to stop)...\n');

  let lastProcessed = 0;

  const checkInterval = setInterval(() => {
    const batch = db.getBatch(options.batchId);
    if (!batch) {
      clearInterval(checkInterval);
      return;
    }

    if (batch.processedPayments !== lastProcessed) {
      lastProcessed = batch.processedPayments;
      logger.progress(
        batch.processedPayments + batch.failedPayments + batch.skippedPayments,
        batch.totalPayments,
        `${batch.successfulPayments} OK, ${batch.failedPayments} failed`
      );
    }

    if (batch.status === BatchStatus.Completed || batch.status === BatchStatus.Failed || batch.status === BatchStatus.Cancelled) {
      clearInterval(checkInterval);
      logger.success(`\nBatch ${batch.status}`);
    }
  }, 2000);

  // Also stream from Horizon if a source account is available
  const batch = db.getBatch(options.batchId);
  if (batch?.sourceAccount) {
    try {
      const streamUrl = `${options.horizonUrl}/accounts/${batch.sourceAccount}/transactions?cursor=now&order=asc&limit=1`;
      logger.debug(`Horizon stream endpoint: ${streamUrl}`);

      // Poll Horizon for new transactions
      let lastPagingToken = 'now';
      const pollInterval = setInterval(async () => {
        const currentBatch = db.getBatch(options.batchId);
        if (!currentBatch || currentBatch.status !== BatchStatus.Running) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const response = await axios.get(
            `${options.horizonUrl}/accounts/${batch.sourceAccount}/transactions`,
            {
              params: { cursor: lastPagingToken, order: 'asc', limit: 10 },
              timeout: 10000,
            }
          );

          const txRecords = response.data._embedded?.records || [];
          for (const tx of txRecords) {
            logger.info(`  New tx: ${tx.hash} (${tx.operation_count} ops) - ${tx.successful ? 'OK' : 'FAILED'}`);
            lastPagingToken = tx.paging_token;
          }
        } catch {
          // Ignore stream errors
        }
      }, 5000);

      // Cleanup on process exit
      process.on('SIGINT', () => {
        clearInterval(checkInterval);
        clearInterval(pollInterval);
        process.exit(0);
      });
    } catch {
      // Stream not available, continue with interval-based monitoring
    }
  }

  // Wait for batch to complete or user to cancel
  await new Promise<void>((resolve) => {
    const waitInterval = setInterval(() => {
      const b = db.getBatch(options.batchId);
      if (!b || b.status !== BatchStatus.Running) {
        clearInterval(waitInterval);
        clearInterval(checkInterval);
        resolve();
      }
    }, 2000);
  });
}
