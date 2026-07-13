import { Address, xdr } from 'stellar-sdk';

// Re-export event and callback types so consumers can import from one place
export type {
  SDKCallbacks,
  SDKEventMap,
  TransactionSubmittedEvent,
  TransactionConfirmedEvent,
  TransactionFailedEvent,
  EscrowCreatedEvent,
  EscrowReleasedEvent,
  EscrowRefundedEvent,
  EscrowDisputedEvent,
} from './events';

// ─── Metadata helpers ────────────────────────────────────────────────────────

/** Supported value types for SCVal metadata maps */
export type MetadataValue = string | number | boolean;

/** A flat key-value record where values are convertible to Soroban SCVal */
export type MetadataRecord = Record<string, MetadataValue>;

export enum EscrowStatus {
  Pending = 'Pending',
  Completed = 'Completed',
  Refunded = 'Refunded',
  Disputed = 'Disputed',
}

export enum ComplianceLevel {
  None = 'None',
  Basic = 'Basic',
  Enhanced = 'Enhanced',
  Full = 'Full',
}

export enum RiskLevel {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
  Restricted = 'Restricted',
}

export interface Escrow {
  id: string;
  sender: string;
  receiver: string;
  amount: string;
  token: string;
  status: EscrowStatus;
  release_time: number;
  created_at: number;
  metadata: Record<string, Uint8Array>;
}

export interface Dispute {
  escrow_id: string;
  challenger: string;
  reason: string;
  evidence: Uint8Array;
  created_at: number;
  resolved: boolean;
}

export interface ExchangeRate {
  from_currency: string;
  to_currency: string;
  rate: string;
  timestamp: number;
  source: string;
  confidence: number;
}

export interface RateSource {
  name: string;
  address: string;
  weight: number;
  active: boolean;
}

export interface AggregatedRate {
  rate: string;
  weighted_average: string;
  sources_count: number;
  last_updated: number;
  deviation_threshold: number;
}

export interface ComplianceRecord {
  user: string;
  kyc_level: ComplianceLevel;
  risk_level: RiskLevel;
  jurisdiction: string;
  registration_date: number;
  last_updated: number;
  aml_flags: string[];
  transaction_limits: Record<string, string>;
}

export interface TransactionRule {
  id: string;
  name: string;
  description: string;
  conditions: Record<string, Uint8Array>;
  actions: Record<string, Uint8Array>;
  active: boolean;
  priority: number;
}

export interface ComplianceCheck {
  transaction_id: string;
  from_user: string;
  to_user: string;
  amount: string;
  currency: string;
  jurisdiction_from: string;
  jurisdiction_to: string;
  timestamp: number;
  approved: boolean;
  reason: string;
  rules_triggered: string[];
}

export interface PaymentRequest {
  from: string;
  to: string;
  amount: string;
  token: string;
  release_time?: number;
  metadata?: Record<string, Uint8Array>;
}

export interface PaymentOptions {
  feeBump?: boolean;
  timeout?: number;
  memo?: string;
  submit?: boolean;
}

export interface ExchangeRateRequest {
  from_currency: string;
  to_currency: string;
  sources?: string[];
}

export interface ComplianceRequest {
  from_user: string;
  to_user: string;
  amount: string;
  currency: string;
  jurisdiction_from: string;
  jurisdiction_to: string;
}

export interface StellarConfig {
  horizonUrl: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
  feeBumpAccount?: string;
  defaultTimeout?: number;
}

export interface ContractAddresses {
  escrow: string;
  rateOracle: string;
  compliance: string;
}

export interface TransactionResult {
  hash: string;
  success: boolean;
  /** Raw Horizon/Soroban response. Typed as unknown; narrow before use. */
  result?: unknown;
  error?: string;
}

export interface EscrowCreationResult extends TransactionResult {
  escrowId: string;
}

export interface ComplianceCheckResult extends TransactionResult {
  approved: boolean;
  reason: string;
  rulesTriggered: string[];
}

export interface ExchangeRateResult {
  rate: string;
  timestamp: number;
  sources: ExchangeRate[];
  aggregated: AggregatedRate;
}

export interface PaymentStatus {
  escrowId: string;
  status: EscrowStatus;
  amount: string;
  sender: string;
  receiver: string;
  created_at: number;
  release_time: number;
  can_release: boolean;
  can_refund: boolean;
}

export interface NetworkInfo {
  horizonUrl: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
  friendbotUrl?: string;
}

export interface AccountInfo {
  accountId: string;
  balance: string;
  sequence: string;
  numSubentries: number;
  flags: {
    authRequired: boolean;
    authRevocable: boolean;
    authImmutable: boolean;
  };
}

export interface TokenInfo {
  contractId: string;
  symbol: string;
  decimals: number;
  name: string;
  totalSupply: string;
}

export interface FeeEstimate {
  minFee: string;
  maxFee: string;
  recommendedFee: string;
  feeBumpFee: string;
}

export interface TransactionMetadata {
  memo?: string;
  feeBump?: boolean;
  timeout?: number;
  operations: number;
  xdr?: string;
}

export interface ErrorInfo {
  code: string;
  message: string;
  /** Additional error context from the API; narrow before use. */
  details?: unknown;
  transactionResult?: xdr.TransactionResult;
}

/** Allowed scalar types for metadata values passed to contracts. */
export type MetadataValue = string | number | boolean;

/** A flat key/value map used for payment and escrow metadata. */
export type MetadataRecord = Record<string, MetadataValue>;

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ErrorInfo;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}
