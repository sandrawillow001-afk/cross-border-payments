import { EventEmitter } from 'events';
import {
  EscrowCreationResult,
  TransactionResult,
  PaymentRequest,
} from './types';

// ─── Event payload types ─────────────────────────────────────────────────────

/**
 * Emitted immediately after a transaction XDR has been broadcast to Horizon.
 * At this point the transaction is in-flight; confirmation is not guaranteed.
 */
export interface TransactionSubmittedEvent {
  /** Stellar transaction hash */
  hash: string;
  /** Unix timestamp (ms) when the transaction was submitted */
  timestamp: number;
}

/**
 * Emitted when Horizon confirms that a transaction was included in a ledger
 * and executed successfully.
 */
export interface TransactionConfirmedEvent {
  hash: string;
  /** Ledger close timestamp (seconds) from the Horizon response */
  ledgerTimestamp?: number;
  /** Raw Horizon transaction record; narrow before use */
  result?: unknown;
}

/**
 * Emitted when a transaction is rejected by Horizon, times out waiting for
 * confirmation, or the SDK encounters an unrecoverable submission error.
 */
export interface TransactionFailedEvent {
  hash: string;
  /** Human-readable reason for the failure */
  error: string;
}

/**
 * Emitted when a new escrow has been created on-chain.
 */
export interface EscrowCreatedEvent {
  escrowId: string;
  hash: string;
  /** Mirrors the `PaymentRequest` that triggered this escrow */
  request: PaymentRequest;
}

/**
 * Emitted when an escrow has been released to the receiver.
 */
export interface EscrowReleasedEvent {
  escrowId: string;
  hash: string;
}

/**
 * Emitted when an escrow has been refunded to the sender.
 */
export interface EscrowRefundedEvent {
  escrowId: string;
  hash: string;
}

/**
 * Emitted when an escrow dispute has been submitted on-chain.
 */
export interface EscrowDisputedEvent {
  escrowId: string;
  hash: string;
  challenger: string;
  reason: string;
}

// ─── Typed event map ─────────────────────────────────────────────────────────

/**
 * Complete map of all events emitted by `TransactionEventEmitter`.
 *
 * Use this type to get IntelliSense on `sdk.on('event', handler)` calls.
 */
export interface SDKEventMap {
  /** A transaction XDR has been broadcast to Horizon */
  submitted: (event: TransactionSubmittedEvent) => void;
  /** Horizon confirmed the transaction was included in a ledger */
  confirmed: (event: TransactionConfirmedEvent) => void;
  /** The transaction was rejected or timed out */
  failed: (event: TransactionFailedEvent) => void;
  /** A new escrow was created on-chain */
  'escrow:created': (event: EscrowCreatedEvent) => void;
  /** An escrow was released to the receiver */
  'escrow:released': (event: EscrowReleasedEvent) => void;
  /** An escrow was refunded to the sender */
  'escrow:refunded': (event: EscrowRefundedEvent) => void;
  /** A dispute was raised against an escrow */
  'escrow:disputed': (event: EscrowDisputedEvent) => void;
}

// ─── Callback options ─────────────────────────────────────────────────────────

/**
 * Optional callback props that can be passed to `StellarCrossBorderSDK`
 * constructor as an alternative to the event-emitter API.
 *
 * @example
 * ```ts
 * const sdk = new StellarCrossBorderSDK(config, contracts, {
 *   onSubmitted: ({ hash }) => console.log('sent', hash),
 *   onConfirmed: ({ hash }) => console.log('done', hash),
 *   onFailed:    ({ error }) => console.error('failed', error),
 * });
 * ```
 */
export interface SDKCallbacks {
  onSubmitted?: (event: TransactionSubmittedEvent) => void;
  onConfirmed?: (event: TransactionConfirmedEvent) => void;
  onFailed?: (event: TransactionFailedEvent) => void;
  onEscrowCreated?: (event: EscrowCreatedEvent) => void;
  onEscrowReleased?: (event: EscrowReleasedEvent) => void;
  onEscrowRefunded?: (event: EscrowRefundedEvent) => void;
  onEscrowDisputed?: (event: EscrowDisputedEvent) => void;
}

// ─── TransactionEventEmitter ──────────────────────────────────────────────────

/**
 * Typed event emitter for the Stellar cross-border SDK.
 *
 * Extends Node's `EventEmitter` with a strongly-typed `on/once/off/emit`
 * interface that maps each event name to its exact payload type.
 *
 * You do **not** instantiate this directly. Access it via
 * `StellarCrossBorderSDK` which exposes `on`, `once`, and `off` proxy methods.
 *
 * @example
 * ```ts
 * sdk.on('submitted',     ({ hash }) => console.log('Tx submitted:', hash));
 * sdk.on('confirmed',     ({ hash }) => console.log('Tx confirmed:', hash));
 * sdk.on('failed',        ({ error }) => console.error('Tx failed:',  error));
 * sdk.on('escrow:created', ({ escrowId }) => saveToDb(escrowId));
 * ```
 */
export class TransactionEventEmitter extends EventEmitter {
  // ── Typed overloads ───────────────────────────────────────────────────────

  on<K extends keyof SDKEventMap>(event: K, listener: SDKEventMap[K]): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  once<K extends keyof SDKEventMap>(event: K, listener: SDKEventMap[K]): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  off<K extends keyof SDKEventMap>(event: K, listener: SDKEventMap[K]): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  emit<K extends keyof SDKEventMap>(
    event: K,
    payload: Parameters<SDKEventMap[K]>[0]
  ): boolean;
  emit(event: string, ...args: unknown[]): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  // ── Convenience emitters (called internally by the SDK) ───────────────────

  emitSubmitted(payload: TransactionSubmittedEvent): void {
    this.emit('submitted', payload);
  }

  emitConfirmed(payload: TransactionConfirmedEvent): void {
    this.emit('confirmed', payload);
  }

  emitFailed(payload: TransactionFailedEvent): void {
    this.emit('failed', payload);
  }

  emitEscrowCreated(payload: EscrowCreatedEvent): void {
    this.emit('escrow:created', payload);
  }

  emitEscrowReleased(payload: EscrowReleasedEvent): void {
    this.emit('escrow:released', payload);
  }

  emitEscrowRefunded(payload: EscrowRefundedEvent): void {
    this.emit('escrow:refunded', payload);
  }

  emitEscrowDisputed(payload: EscrowDisputedEvent): void {
    this.emit('escrow:disputed', payload);
  }
}
