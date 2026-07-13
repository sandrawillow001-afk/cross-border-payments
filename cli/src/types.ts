/**
 * CLI Types for Stellar Payout batch processing
 */

export interface PaymentRecord {
  destination: string;
  amount: string;
  asset: string;
  asset_issuer: string;
  memo: string;
  escrow_duration: number;
}

export interface BatchPaymentEntry extends PaymentRecord {
  index: number;
  status: BatchEntryStatus;
  txHash: string;
  error: string;
  retryCount: number;
  submittedAt: number;
  completedAt: number;
  batchGroup: number;
}

export enum BatchEntryStatus {
  Pending = 'pending',
  Validating = 'validating',
  Submitted = 'submitted',
  Confirmed = 'confirmed',
  Failed = 'failed',
  Retrying = 'retrying',
  Skipped = 'skipped',
}

export interface BatchConfig {
  inputFile: string;
  format: InputFormat;
  sourceSecret: string;
  network: NetworkType;
  horizonUrl: string;
  networkPassphrase: string;
  dryRun: boolean;
  maxOpsPerTx: number;
  maxFee: number;
  concurrency: number;
  feeSurgeThreshold: number;
  rateLockMinutes: number;
  escrowContractAddress: string;
  rateOracleContractAddress: string;
  complianceContractAddress: string;
  dbPath: string;
}

export enum InputFormat {
  CSV = 'csv',
  JSON = 'json',
  XLSX = 'xlsx',
  MT103 = 'mt103',
}

export enum NetworkType {
  Testnet = 'testnet',
  Mainnet = 'mainnet',
  Futurenet = 'futurenet',
}

export interface BatchState {
  batchId: string;
  totalPayments: number;
  processedPayments: number;
  successfulPayments: number;
  failedPayments: number;
  skippedPayments: number;
  startedAt: number;
  completedAt: number | null;
  status: BatchStatus;
  sourceAccount: string;
  network: NetworkType;
  dryRun: boolean;
}

export enum BatchStatus {
  Created = 'created',
  Running = 'running',
  Paused = 'paused',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export interface TransactionGroup {
  groupIndex: number;
  entries: BatchPaymentEntry[];
  txHash: string;
  status: BatchEntryStatus;
  fee: string;
  submittedAt: number;
  confirmedAt: number;
}

export interface StatusStreamOptions {
  batchId: string;
  follow: boolean;
  dbPath: string;
  horizonUrl: string;
}

export interface RetryOptions {
  batchId: string;
  maxRetries: number;
  backoffBase: number;
  backoffMax: number;
  /** Total retry time budget in milliseconds (0 = no time limit). */
  maxTotalRetryTime: number;
  dbPath: string;
  sourceSecret: string;
  horizonUrl: string;
  networkPassphrase: string;
}

export interface ReportOptions {
  batchId: string;
  format: ReportFormat;
  outputPath: string;
  dbPath: string;
}

export enum ReportFormat {
  PDF = 'pdf',
  CSV = 'csv',
}

export interface FeeInfo {
  baseFee: number;
  currentFee: number;
  surgeActive: boolean;
  recommendedFee: number;
}

export interface ValidationResult {
  valid: boolean;
  accountExists: boolean;
  hasTrustline: boolean;
  errors: string[];
}

export interface MT103Message {
  senderBIC: string;
  receiverBIC: string;
  transactionRef: string;
  valueDate: string;
  currency: string;
  amount: string;
  orderingCustomer: string;
  beneficiaryCustomer: string;
  remittanceInfo: string;
}
