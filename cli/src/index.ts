#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { executeBatch } from './commands/batch';
import { executeStatus } from './commands/status';
import { executeRetry } from './commands/retry';
import { executeReport } from './commands/report';
import { detectFormat } from './parsers';
import {
  InputFormat,
  NetworkType,
} from './types';
import { setLogLevel, LogLevel } from './utils/logger';
import { validateRequiredOptions } from './utils/validation';
import { normalizeReportFormat } from './utils/report';

dotenv.config();

// Built-in fallbacks used when neither a CLI flag nor an environment variable is
// provided. Kept here so every command shares the same defaults.
const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'testnet';
const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const DEFAULT_MAX_FEE = '10000';
const DEFAULT_DB_PATH = './stellar-payout.db';

const program = new Command();

program
  .name('stellar-payout')
  .description('CLI tool for batch cross-border payments on the Stellar network')
  .version('0.1.0');

// ── batch command ────────────────────────────────────────────────────
program
  .command('batch')
  .description('Process batch payments from CSV, JSON, XLSX, or SWIFT MT103 files')
  .requiredOption('-i, --input <file>', 'Input file path (CSV, JSON, XLSX, or MT103)')
  .option('-f, --format <format>', 'Input format: csv, json, xlsx, mt103 (auto-detected from extension)')
  .option('-s, --source-secret <key>', 'Source account secret key (or ADMIN_SECRET_KEY)')
  .option('-n, --network <network>', 'Network: testnet, mainnet, futurenet (or STELLAR_NETWORK)', envDefault('STELLAR_NETWORK', DEFAULT_NETWORK))
  .option('--horizon-url <url>', 'Horizon URL (or HORIZON_URL)', envDefault('HORIZON_URL', DEFAULT_HORIZON_URL))
  .option('--network-passphrase <passphrase>', 'Network passphrase (or NETWORK_PASSPHRASE)', envDefault('NETWORK_PASSPHRASE', DEFAULT_NETWORK_PASSPHRASE))
  .option('--dry-run', 'Simulate transactions without submitting', false)
  .option('--max-ops <number>', 'Maximum operations per transaction (max 100)', '100')
  .option('--max-fee <number>', 'Maximum fee in stroops (or MAX_FEE)', envDefault('MAX_FEE', DEFAULT_MAX_FEE))
  .option('--concurrency <number>', 'Number of concurrent transaction submissions', '5')
  .option('--fee-surge-threshold <number>', 'Fee surge threshold in stroops (pauses if exceeded)', '100')
  .option('--rate-lock-minutes <number>', 'Rate lock window in minutes', '10')
  .option('--escrow-contract <address>', 'Escrow contract address (or ESCROW_CONTRACT_ADDRESS)')
  .option('--rate-oracle-contract <address>', 'Rate oracle contract address (or RATE_ORACLE_CONTRACT_ADDRESS)')
  .option('--compliance-contract <address>', 'Compliance contract address (or COMPLIANCE_CONTRACT_ADDRESS)')
  .option('--db-path <path>', 'SQLite database path for crash recovery (or DB_PATH)', envDefault('DB_PATH', DEFAULT_DB_PATH))
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (opts) => {
    if (opts.verbose) {
      setLogLevel(LogLevel.DEBUG);
    }

    validateRequiredOptions(opts, process.env, [
      { key: 'sourceSecret', envKey: 'ADMIN_SECRET_KEY', description: 'Source account secret key', optName: '--source-secret' },
      { key: 'escrowContract', envKey: 'ESCROW_CONTRACT_ADDRESS', description: 'Escrow contract address', optName: '--escrow-contract' },
      { key: 'rateOracleContract', envKey: 'RATE_ORACLE_CONTRACT_ADDRESS', description: 'Rate oracle contract address', optName: '--rate-oracle-contract' },
      { key: 'complianceContract', envKey: 'COMPLIANCE_CONTRACT_ADDRESS', description: 'Compliance contract address', optName: '--compliance-contract' },
    ]);

    // Normalize an explicitly-provided --format to lowercase so values like
    // CSV, XLSX, or MT103 match the InputFormat enum. When omitted, the format
    // is auto-detected from the (case-insensitive) file extension.
    const format = opts.format
      ? (opts.format.toLowerCase() as InputFormat)
      : detectFormat(opts.input);

    await executeBatch({
      inputFile: path.resolve(opts.input),
      format,
      sourceSecret: opts.sourceSecret,
      network: opts.network as NetworkType,
      horizonUrl: opts.horizonUrl,
      networkPassphrase: opts.networkPassphrase || '',
      dryRun: opts.dryRun,
      maxOpsPerTx: Math.min(parseInt(opts.maxOps, 10), 100),
      maxFee: parseInt(opts.maxFee, 10),
      concurrency: parseInt(opts.concurrency, 10),
      feeSurgeThreshold: parseInt(opts.feeSurgeThreshold, 10),
      rateLockMinutes: parseInt(opts.rateLockMinutes, 10),
      escrowContractAddress: opts.escrowContract || '',
      rateOracleContractAddress: opts.rateOracleContract || '',
      complianceContractAddress: opts.complianceContract || '',
      dbPath: opts.dbPath,
    });
  });

// ── status command ───────────────────────────────────────────────────
program
  .command('status')
  .description(
    'Query batch payment status from the local database.\n' +
    '  Omit --batch-id to list the 10 most recent batches.\n' +
    '  Use --follow to stream live progress while a batch is running.\n\n' +
    '  Examples:\n' +
    '    stellar-payout status\n' +
    '    stellar-payout status --batch-id <id>\n' +
    '    stellar-payout status --batch-id <id> --follow\n' +
    '    stellar-payout status --batch-id <id> --follow --horizon-url https://horizon.stellar.org'
  )
  .option('-b, --batch-id <id>', 'Batch ID to inspect (omit to list 10 most recent batches)')
  .option(
    '-f, --follow',
    'Stream live updates: polls the local DB every 2 s and Horizon every 5 s until the batch completes (Ctrl+C to stop)',
    false,
  )
  .option(
    '--horizon-url <url>',
    'Horizon endpoint used for transaction streaming with --follow (or HORIZON_URL)',
    envDefault('HORIZON_URL', DEFAULT_HORIZON_URL),
  )
  .option(
    '--db-path <path>',
    'Path to the SQLite database written by "stellar-payout batch" — must match the path used when the batch was started (or DB_PATH)',
    envDefault('DB_PATH', DEFAULT_DB_PATH),
  )
  .option('--verbose', 'Print debug output including the Horizon stream endpoint', false)
  .action(async (opts) => {
    if (opts.verbose) {
      setLogLevel(LogLevel.DEBUG);
    }

    await executeStatus({
      batchId: opts.batchId || '',
      follow: opts.follow,
      dbPath: opts.dbPath,
      horizonUrl: opts.horizonUrl,
    });
  });

// ── retry command ────────────────────────────────────────────────────
program
  .command('retry')
  .description('Automatically resubmit failed transactions with exponential backoff')
  .requiredOption('-b, --batch-id <id>', 'Batch ID to retry failed entries')
  .option('-s, --source-secret <key>', 'Source account secret key (or ADMIN_SECRET_KEY)')
  .option('--max-retries <number>', 'Maximum retry attempts per entry', '3')
  .option('--backoff-base <ms>', 'Base backoff delay in milliseconds', '1000')
  .option('--backoff-max <ms>', 'Maximum backoff delay in milliseconds', '30000')
  .option('--horizon-url <url>', 'Horizon URL (or HORIZON_URL)', envDefault('HORIZON_URL', DEFAULT_HORIZON_URL))
  .option('--network-passphrase <passphrase>', 'Network passphrase (or NETWORK_PASSPHRASE)', envDefault('NETWORK_PASSPHRASE', DEFAULT_NETWORK_PASSPHRASE))
  .option('--db-path <path>', 'SQLite database path (or DB_PATH)', envDefault('DB_PATH', DEFAULT_DB_PATH))
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (opts) => {
    if (opts.verbose) {
      setLogLevel(LogLevel.DEBUG);
    }

    validateRequiredOptions(opts, process.env, [
      { key: 'sourceSecret', envKey: 'ADMIN_SECRET_KEY', description: 'Source account secret key', optName: '--source-secret' },
    ]);

    await executeRetry({
      batchId: opts.batchId,
      maxRetries: parseInt(opts.maxRetries, 10),
      backoffBase: parseInt(opts.backoffBase, 10),
      backoffMax: parseInt(opts.backoffMax, 10),
      maxTotalRetryTime: parseInt(opts.maxTotalRetryTime, 10),
      dbPath: opts.dbPath,
      sourceSecret: opts.sourceSecret,
      horizonUrl: opts.horizonUrl,
      networkPassphrase: opts.networkPassphrase,
    });
  });

// ── report command ───────────────────────────────────────────────────
program
  .command('report')
  .description('Generate compliance audit trail reports in PDF or CSV format')
  .requiredOption('-b, --batch-id <id>', 'Batch ID to generate report for')
  .option('--format <format>', 'Report format: pdf or csv', 'csv')
  .option('-o, --output <path>', 'Output file path (auto-generated if omitted)')
  .option('--db-path <path>', 'SQLite database path (or DB_PATH)', envDefault('DB_PATH', DEFAULT_DB_PATH))
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (opts) => {
    if (opts.verbose) {
      setLogLevel(LogLevel.DEBUG);
    }

    // Validate the format up front so an unsupported value fails fast with a
    // clear message instead of producing a misnamed or empty file.
    const format = normalizeReportFormat(opts.format);

    await executeReport({
      batchId: opts.batchId,
      format,
      outputPath: opts.output || '',
      dbPath: opts.dbPath,
    });
  });

program.parse();
