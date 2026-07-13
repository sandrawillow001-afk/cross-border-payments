import { logger } from '../utils/logger';

interface BatchRecord {
  destination: string;
  amount: string;
  asset?: string;
  [key: string]: unknown;
}

interface DryRunSummary {
  totalRows:     number;
  validRows:     number;
  invalidRows:   number;
  invalidDetails: { row: number; reason: string }[];
  estimatedCost: string;
}

function validateRecord(record: BatchRecord, index: number) {
  const errors: string[] = [];
  if (!record.destination) errors.push('missing destination');
  if (!record.amount || isNaN(Number(record.amount))) errors.push('invalid amount');
  return errors.length
    ? { row: index + 1, reason: errors.join(', ') }
    : null;
}

export function dryRunSummary(records: BatchRecord[]): DryRunSummary {
  const invalidDetails: { row: number; reason: string }[] = [];

  records.forEach((r, i) => {
    const err = validateRecord(r, i);
    if (err) invalidDetails.push(err);
  });

  const validRows = records.length - invalidDetails.length;

  return {
    totalRows:     records.length,
    validRows,
    invalidRows:   invalidDetails.length,
    invalidDetails,
    estimatedCost: `~${(validRows * 0.00001).toFixed(5)} XLM base fee`,
  };
}

export function printDryRunReport(summary: DryRunSummary) {
  logger.info('====== DRY-RUN SUMMARY ======');
  logger.info(`Total rows:      ${summary.totalRows}`);
  logger.info(`Valid rows:      ${summary.validRows}`);
  logger.warn(`Invalid rows:    ${summary.invalidRows}`);
  logger.info(`Estimated cost:  ${summary.estimatedCost}`);

  if (summary.invalidDetails.length > 0) {
    logger.warn('Invalid row details:');
    summary.invalidDetails.forEach(d =>
      logger.warn(`  Row ${d.row}: ${d.reason}`)
    );
  }
  logger.info('=============================');
}

import {
  Keypair,
  Account,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  BASE_FEE,
  Memo,
} from 'stellar-sdk';
import axios from 'axios';
import * as crypto from 'crypto';
import {
  BatchConfig,
  BatchPaymentEntry,
  BatchEntryStatus,
  BatchStatus,
  TransactionGroup,
  NetworkType,
  PaymentRecord,
} from '../types';
import { parseInputFile, detectFormat } from '../parsers';
import { BatchDatabase } from '../utils/database';
import { validateBatch, checkFeeSurge } from '../utils/validation';
import * as logger from '../utils/logger';

let emergencyStop = false;
let currentDb: BatchDatabase | null = null;
let currentBatchId: string | null = null;

/**
 * SequenceAllocator serializes sequence number allocation for parallel groups.
 * Each group acquires a unique sequence number before building its transaction,
 * preventing tx_bad_seq errors when groups run concurrently.
 */
class SequenceAllocator {
  private nextSequence: bigint;
  private mutex: Promise<void> = Promise.resolve();

  constructor(currentSequence: string) {
    this.nextSequence = BigInt(currentSequence);
  }

  async allocate(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.mutex = this.mutex.then(() => {
        this.nextSequence++;
        const seq = (this.nextSequence - BigInt(1)).toString();
        resolve(seq);
      });
    });
  }
}

function setupSignalHandlers(): void {
  const handleSignal = (signal: string) => {
    logger.warn(`\nReceived ${signal}. Initiating graceful shutdown...`);
    emergencyStop = true;

    if (currentDb && currentBatchId) {
      logger.info('Saving batch state for crash recovery...');
      // markBatchPaused is a single atomic SQLite transaction — status + counters
      // are written together so a secondary crash during shutdown cannot produce
      // a batch row whose counters don't match its entry rows.
      currentDb.markBatchPaused(currentBatchId);
      logger.success('Batch state saved. You can resume with: stellar-payout retry --batch-id=' + currentBatchId);
    }

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

function getNetworkPassphrase(network: NetworkType): string {
  switch (network) {
    case NetworkType.Testnet:
      return Networks.TESTNET;
    case NetworkType.Mainnet:
      return Networks.PUBLIC;
    case NetworkType.Futurenet:
      return 'Test SDF Future Network ; October 2022';
    default:
      return Networks.TESTNET;
  }
}

export async function executeBatch(config: BatchConfig): Promise<void> {
  setupSignalHandlers();

  const batchId = crypto.randomBytes(8).toString('hex');
  const db = new BatchDatabase(config.dbPath);
  currentDb = db;
  currentBatchId = batchId;

  logger.banner('Stellar Payout - Batch Processor');
  logger.info(`Batch ID: ${batchId}`);
  logger.info(`Input file: ${config.inputFile}`);
  logger.info(`Format: ${config.format}`);
  logger.info(`Network: ${config.network}`);
  logger.info(`Dry run: ${config.dryRun}`);
  logger.info(`Max ops per tx: ${config.maxOpsPerTx}`);
  logger.info(`Concurrency: ${config.concurrency}`);

  // Parse input file
  const format = config.format || detectFormat(config.inputFile);
  let records: PaymentRecord[];
  try {
    records = parseInputFile(config.inputFile, format);
    logger.success(`Parsed ${records.length} payment records`);
  } catch (err) {
    logger.error(`Failed to parse input file: ${err instanceof Error ? err.message : String(err)}`);
    db.close();
    return;
  }

  if (records.length === 0) {
    logger.warn('No payment records found. Exiting.');
    db.close();
    return;
  }

  // Validate payments
  logger.info('Validating payment records...');
  const { valid, invalid } = await validateBatch(
    records,
    config.horizonUrl,
    config.dryRun
  );

  if (invalid.length > 0) {
    logger.warn(`${invalid.length} invalid records found:`);
    invalid.forEach(({ record, errors }) => {
      logger.warn(`  ${record.destination}: ${errors.join(', ')}`);
    });
  }

  if (valid.length === 0) {
    logger.error('No valid payment records. Exiting.');
    db.close();
    return;
  }

  logger.success(`${valid.length} valid payments ready for processing`);

  // Load source keypair
  const sourceKeypair = Keypair.fromSecret(config.sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info(`Source account: ${sourcePublicKey}`);

  // Create batch in database — atomically creates the row and sets status to
  // 'running' in one transaction, eliminating the crash window between
  // creation and activation.
  db.initBatch(batchId, valid.length, sourcePublicKey, config.network, config.dryRun);

  // Group payments into batches of maxOpsPerTx
  const groups = groupPayments(valid, config.maxOpsPerTx);
  logger.info(`Created ${groups.length} transaction groups`);

  // Store entries in database
  const allEntries: BatchPaymentEntry[] = [];
  groups.forEach((group, groupIdx) => {
    group.forEach((record, idx) => {
      const globalIdx = groupIdx * config.maxOpsPerTx + idx;
      allEntries.push({
        index: globalIdx,
        destination: record.destination,
        amount: record.amount,
        asset: record.asset,
        asset_issuer: record.asset_issuer || '',
        memo: record.memo,
        escrow_duration: record.escrow_duration,
        status: BatchEntryStatus.Pending,
        txHash: '',
        error: '',
        retryCount: 0,
        submittedAt: 0,
        completedAt: 0,
        batchGroup: groupIdx,
      });
    });
  });
  db.insertEntries(batchId, allEntries);

  // Process groups
  const networkPassphrase = config.networkPassphrase || getNetworkPassphrase(config.network);
  let processedGroups = 0;

  // Fetch initial sequence number for the source account
  let sequenceAllocator: SequenceAllocator;
  try {
    const accountResponse = await axios.get(
      `${config.horizonUrl}/accounts/${sourcePublicKey}`,
      { timeout: 15000 }
    );
    sequenceAllocator = new SequenceAllocator(accountResponse.data.sequence);
  } catch (err) {
    logger.error(`Failed to fetch source account: ${err instanceof Error ? err.message : String(err)}`);
    db.updateBatchStatus(batchId, BatchStatus.Failed);
    db.close();
    return;
  }

  // Parallel processing with concurrency control
  const semaphore = new Semaphore(config.concurrency);

  const groupPromises = groups.map(async (group, groupIdx) => {
    if (emergencyStop) return;

    await semaphore.acquire();

    try {
      if (emergencyStop) return;

      // Check fee surge before submitting
      const feeCheck = await checkFeeSurge(config.horizonUrl, config.feeSurgeThreshold);
      if (feeCheck.surging) {
        logger.warn(`Fee surge detected (${feeCheck.currentFee} stroops). Pausing group ${groupIdx}...`);
        await waitForFeeDrop(config.horizonUrl, config.feeSurgeThreshold);
      }

      await processGroup(
        group,
        groupIdx,
        batchId,
        sourceKeypair,
        config,
        networkPassphrase,
        db,
        sequenceAllocator
      );

      processedGroups++;
      logger.progress(processedGroups, groups.length, 'transaction groups');
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(groupPromises);

  // Finalize
  db.updateBatchCounters(batchId);
  const finalState = db.getBatch(batchId);

  if (emergencyStop) {
    db.updateBatchStatus(batchId, BatchStatus.Paused);
    logger.warn('\nBatch paused due to emergency stop');
  } else if (finalState && finalState.failedPayments > 0) {
    db.updateBatchStatus(batchId, BatchStatus.Completed);
    logger.warn(`\nBatch completed with ${finalState.failedPayments} failures`);
  } else {
    db.updateBatchStatus(batchId, BatchStatus.Completed);
    logger.success('\nBatch completed successfully!');
  }

  // Print summary
  if (finalState) {
    logger.banner('Batch Summary');
    logger.table(
      ['Metric', 'Value'],
      [
        ['Batch ID', batchId],
        ['Total Payments', String(finalState.totalPayments)],
        ['Successful', String(finalState.successfulPayments)],
        ['Failed', String(finalState.failedPayments)],
        ['Skipped', String(finalState.skippedPayments)],
        ['Duration', `${((Date.now() - finalState.startedAt) / 1000).toFixed(1)}s`],
        ['Dry Run', config.dryRun ? 'Yes' : 'No'],
      ]
    );

    if (finalState.failedPayments > 0) {
      logger.info(`\nRetry failed payments with: stellar-payout retry --batch-id=${batchId}`);
    }
    logger.info(`Generate report with: stellar-payout report --batch-id=${batchId} --format=csv`);
  }

  db.close();
  currentDb = null;
  currentBatchId = null;
}

async function processGroup(
  records: PaymentRecord[],
  groupIdx: number,
  batchId: string,
  sourceKeypair: Keypair,
  config: BatchConfig,
  networkPassphrase: string,
  db: BatchDatabase,
  sequenceAllocator: SequenceAllocator
): Promise<void> {
  const txGroup: TransactionGroup = {
    groupIndex: groupIdx,
    entries: [],
    txHash: '',
    status: BatchEntryStatus.Pending,
    fee: '',
    submittedAt: 0,
    confirmedAt: 0,
  };

  try {
    // Allocate a unique sequence number for this group (prevents tx_bad_seq with concurrent groups)
    const sequence = await sequenceAllocator.allocate();
    const sourceAccount = new Account(sourceKeypair.publicKey(), sequence);

    // Build transaction with multiple operations
    const fee = String(Math.max(parseInt(BASE_FEE, 10) * records.length, config.maxFee));
    const builder = new TransactionBuilder(sourceAccount, {
      fee,
      networkPassphrase,
    }).setTimeout(0);

    // Add memo if first record has one
    if (records[0]?.memo) {
      builder.addMemo(Memo.text(records[0].memo.substring(0, 28)));
    }

    for (const record of records) {
      const asset = record.asset === 'XLM' || record.asset === 'native'
        ? Asset.native()
        : new Asset(record.asset, record.asset_issuer || sourceKeypair.publicKey());

      builder.addOperation(
        Operation.payment({
          destination: record.destination,
          asset,
          amount: record.amount,
        })
      );
    }

    const transaction = builder.build();

    if (config.dryRun) {
      logger.info(`[DRY RUN] Group ${groupIdx}: ${records.length} operations simulated`);
      txGroup.txHash = `dryrun_${crypto.randomBytes(16).toString('hex')}`;
      txGroup.status = BatchEntryStatus.Confirmed;
      db.upsertGroup(batchId, txGroup);

      const entryIndices = records.map((_, i) => i + groupIdx * config.maxOpsPerTx);
      db.confirmGroupWithEntries(batchId, groupIdx, txGroup.txHash, entryIndices);
      return;
    }

    // Sign and submit
    transaction.sign(sourceKeypair);
    const txXdr = transaction.toXDR();

    txGroup.submittedAt = Date.now();
    // upsertGroup is idempotent — safe to call even if a previous run already
    // inserted a row for this (batchId, groupIdx) pair.
    db.upsertGroup(batchId, txGroup);

    // Compute entry indices once — reused for atomic confirm / fail calls.
    const entryIndices = records.map((_, i) => i + groupIdx * config.maxOpsPerTx);

    // Mark entries as submitted
    for (const entryIdx of entryIndices) {
      db.updateEntryStatus(batchId, entryIdx, BatchEntryStatus.Submitted);
    }

    // Submit with exponential backoff for 503 errors
    const result = await submitWithRetry(txXdr, config.horizonUrl);

    if (result.successful) {
      // Atomic: group row + every entry row confirmed together.
      // A crash between these writes can no longer leave a partial state.
      db.confirmGroupWithEntries(batchId, groupIdx, result.hash, entryIndices);
      logger.debug(`Group ${groupIdx}: Confirmed (${result.hash})`);
    } else {
      // Atomic: group row + every entry row failed together.
      db.failGroupWithEntries(batchId, groupIdx, result.error || 'Transaction failed', entryIndices);
      logger.warn(`Group ${groupIdx}: Failed - ${result.error || 'Unknown error'}`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Group ${groupIdx} error: ${errorMsg}`);

    txGroup.status = BatchEntryStatus.Failed;
    db.upsertGroup(batchId, txGroup);

    const entryIndices = records.map((_, i) => i + groupIdx * config.maxOpsPerTx);
    db.failGroupWithEntries(batchId, groupIdx, errorMsg, entryIndices);
  }
}

async function submitWithRetry(
  txXdr: string,
  horizonUrl: string,
  maxRetries: number = 5
): Promise<{ successful: boolean; hash: string; error?: string }> {
  let lastError = '';

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post(
        `${horizonUrl}/transactions`,
        `tx=${encodeURIComponent(txXdr)}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000,
        }
      );

      return {
        successful: response.data.successful !== false,
        hash: response.data.hash || '',
      };
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: Record<string, unknown> }; message?: string };
      const status = axiosErr.response?.status;
      lastError = axiosErr.response?.data
        ? JSON.stringify(axiosErr.response.data)
        : (axiosErr.message || 'Unknown error');

      if (status === 503 || status === 504 || status === 429) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 30000);
        logger.debug(`Horizon returned ${status}, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(backoff);
        continue;
      }

      // Non-retryable error
      return { successful: false, hash: '', error: lastError };
    }
  }

  return { successful: false, hash: '', error: `Max retries exceeded. Last error: ${lastError}` };
}

function groupPayments(records: PaymentRecord[], maxPerGroup: number): PaymentRecord[][] {
  const groups: PaymentRecord[][] = [];
  for (let i = 0; i < records.length; i += maxPerGroup) {
    groups.push(records.slice(i, i + maxPerGroup));
  }
  return groups;
}

async function waitForFeeDrop(horizonUrl: string, threshold: number): Promise<void> {
  const maxWait = 60000; // 1 minute max wait
  const checkInterval = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const { surging } = await checkFeeSurge(horizonUrl, threshold);
    if (!surging) {
      logger.info('Fee surge subsided. Resuming...');
      return;
    }
    await sleep(checkInterval);
  }

  logger.warn('Fee surge persisted for 60s. Proceeding anyway...');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}
