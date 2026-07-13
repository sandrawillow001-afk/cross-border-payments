export { StellarClient } from './client';
export { StellarPayments } from './payments';
export { PathPaymentService } from './pathPayment';
export { RateOptimizer } from './rateOptimizer';
export { TrustlineService } from './trustlines';
export { TransactionEventEmitter } from './events';
export * from './types';
export {
  isValidStellarPublicKey,
  isValidStellarContractAddress,
  isValidStellarAddress,
  defaultStellarAddressValidator,
} from './validation';
export type { AddressValidator } from './validation';

import { StellarClient } from './client';
import { StellarPayments } from './payments';
import { PathPaymentService } from './pathPayment';
import { RateOptimizer } from './rateOptimizer';
import { TrustlineService } from './trustlines';
import { TransactionEventEmitter, SDKCallbacks, SDKEventMap } from './events';
import { StellarConfig, ContractAddresses } from './types';

/**
 * StellarCrossBorderSDK
 *
 * Main entry point for the Stellar cross-border payments SDK. Wraps all
 * service classes and exposes a typed event emitter so applications can react
 * to transaction lifecycle changes without polling.
 *
 * ### Event emitter usage
 * ```ts
 * const sdk = new StellarCrossBorderSDK(config, contracts);
 *
 * sdk.on('submitted',      ({ hash }) => log('Tx sent:', hash));
 * sdk.on('confirmed',      ({ hash }) => log('Tx confirmed:', hash));
 * sdk.on('failed',         ({ error }) => alert('Tx failed:', error));
 * sdk.on('escrow:created', ({ escrowId, request }) => saveToDb(escrowId));
 * sdk.on('escrow:released',({ escrowId }) => notify('Funds released', escrowId));
 * sdk.on('escrow:refunded',({ escrowId }) => notify('Funds refunded', escrowId));
 * sdk.on('escrow:disputed',({ escrowId, reason }) => openTicket(escrowId, reason));
 * ```
 *
 * ### Callback props usage
 * ```ts
 * const sdk = new StellarCrossBorderSDK(config, contracts, {
 *   onSubmitted:      ({ hash })    => log('Tx sent:', hash),
 *   onConfirmed:      ({ hash })    => log('Tx confirmed:', hash),
 *   onFailed:         ({ error })   => alert(error),
 *   onEscrowCreated:  ({ escrowId }) => saveToDb(escrowId),
 * });
 * ```
 */
export class StellarCrossBorderSDK {
  private client: StellarClient;
  private payments: StellarPayments;
  private pathPayment: PathPaymentService;
  private rateOptimizer: RateOptimizer;
  private trustlines: TrustlineService;

  /** Typed event emitter — use `sdk.on(...)` / `sdk.once(...)` / `sdk.off(...)` */
  readonly events: TransactionEventEmitter;

  /**
   * @param config    - Network configuration (use `createTestnetConfig()` etc.)
   * @param contracts - Deployed contract addresses for escrow, rateOracle, compliance
   * @param callbacks - Optional callback props as an alternative to event listeners
   */
  constructor(
    config: StellarConfig,
    contracts: ContractAddresses,
    callbacks?: SDKCallbacks
  ) {
    this.events = new TransactionEventEmitter();

    // Register any provided callback props as event listeners
    if (callbacks) {
      if (callbacks.onSubmitted)      this.events.on('submitted',      callbacks.onSubmitted);
      if (callbacks.onConfirmed)      this.events.on('confirmed',      callbacks.onConfirmed);
      if (callbacks.onFailed)         this.events.on('failed',         callbacks.onFailed);
      if (callbacks.onEscrowCreated)  this.events.on('escrow:created', callbacks.onEscrowCreated);
      if (callbacks.onEscrowReleased) this.events.on('escrow:released',callbacks.onEscrowReleased);
      if (callbacks.onEscrowRefunded) this.events.on('escrow:refunded',callbacks.onEscrowRefunded);
      if (callbacks.onEscrowDisputed) this.events.on('escrow:disputed',callbacks.onEscrowDisputed);
    }

    this.client       = new StellarClient(config, contracts);
    this.payments     = new StellarPayments(this.client, this.events);
    this.pathPayment  = new PathPaymentService(this.client);
    this.rateOptimizer = new RateOptimizer(this.client);
    this.trustlines   = new TrustlineService(this.client);
  }

  // ── Event emitter proxy methods ───────────────────────────────────────────

  /**
   * Subscribe to a transaction lifecycle event.
   *
   * @example
   * sdk.on('confirmed', ({ hash }) => console.log('confirmed', hash));
   */
  on<K extends keyof SDKEventMap>(event: K, listener: SDKEventMap[K]): this {
    this.events.on(event, listener);
    return this;
  }

  /**
   * Subscribe to a transaction lifecycle event for a single occurrence.
   * The listener is automatically removed after the first invocation.
   */
  once<K extends keyof SDKEventMap>(event: K, listener: SDKEventMap[K]): this {
    this.events.once(event, listener);
    return this;
  }

  /**
   * Remove a previously registered event listener.
   */
  off<K extends keyof SDKEventMap>(event: K, listener: SDKEventMap[K]): this {
    this.events.off(event, listener);
    return this;
  }

  // ── Service getters ───────────────────────────────────────────────────────

  get clientInstance(): StellarClient {
    return this.client;
  }

  get paymentsInstance(): StellarPayments {
    return this.payments;
  }

  get pathPaymentInstance(): PathPaymentService {
    return this.pathPayment;
  }

  get rateOptimizerInstance(): RateOptimizer {
    return this.rateOptimizer;
  }

  get trustlinesInstance(): TrustlineService {
    return this.trustlines;
  }

  // ── Static factory methods ────────────────────────────────────────────────

  static createTestnetConfig(horizonUrl?: string, sorobanRpcUrl?: string): StellarConfig {
    return {
      horizonUrl: horizonUrl || 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: sorobanRpcUrl || 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      defaultTimeout: 30000,
    };
  }

  static createMainnetConfig(horizonUrl?: string, sorobanRpcUrl?: string): StellarConfig {
    return {
      horizonUrl: horizonUrl || 'https://horizon.stellar.org',
      sorobanRpcUrl: sorobanRpcUrl || 'https://soroban.stellar.org',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
      defaultTimeout: 30000,
    };
  }

  static createFuturenetConfig(horizonUrl?: string, sorobanRpcUrl?: string): StellarConfig {
    return {
      horizonUrl: horizonUrl || 'https://horizon-futurenet.stellar.org',
      sorobanRpcUrl: sorobanRpcUrl || 'https://soroban-futurenet.stellar.org',
      networkPassphrase: 'Test SDF Future Network ; October 2022',
      defaultTimeout: 30000,
    };
  }
}

export default StellarCrossBorderSDK;
