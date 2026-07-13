/**
 * trustlines.ts
 *
 * # Overview
 * TrustlineService provides helpers for querying and managing Stellar trustlines.
 * A trustline must exist on an account before it can hold or receive a non-native
 * asset (e.g. USDC, EURC, MXN). Call these helpers before constructing a payment
 * to avoid `op_no_trust` errors at submission time.
 *
 * ## Methods
 *
 * | Method | Description |
 * |--------|-------------|
 * | `hasTrustline(accountId, asset)` | Returns true if the account already trusts the asset |
 * | `getTrustlines(accountId)` | Returns all non-native trustlines on an account |
 * | `getTrustline(accountId, asset)` | Returns a single trustline record, or null if absent |
 * | `buildChangeTrustOp(asset, limit?)` | Builds a CHANGE_TRUST operation (no network call) |
 * | `ensureTrustline(accountId, asset, limit?)` | Returns a CHANGE_TRUST op only when the trustline is missing; null otherwise |
 * | `ensureTrustlines(accountId, assets)` | Batch variant of ensureTrustline |
 * | `buildTrustlineTransaction(accountId, assets, options?)` | Builds and returns a signed-ready TransactionBuilder for one or more trustlines |
 * | `removeTrustline(asset)` | Builds a CHANGE_TRUST op with limit "0" to remove a trustline |
 *
 * ## Trust limit
 * Stellar requires a `limit` on every CHANGE_TRUST operation. When no explicit
 * limit is provided the SDK uses `MAX_TRUST_LIMIT` (the maximum representable
 * value in Stellar's 7-decimal fixed-point format).
 *
 * ## Error handling
 * All public async methods throw a descriptive `Error` on Horizon failures.
 * `hasTrustline`, `getTrustline`, and `ensureTrustline` catch Horizon 404s and
 * return `false` / `null` respectively so callers do not need to guard against
 * unknown accounts in discovery flows.
 */

import {
  Account,
  Asset,
  Operation,
  TransactionBuilder,
} from 'stellar-sdk';
import { StellarClient } from './client';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A single trustline record returned by `getTrustlines` / `getTrustline`.
 */
export interface TrustlineInfo {
  /** Asset code, e.g. "USDC" */
  assetCode: string;
  /** Asset issuer Stellar public key */
  assetIssuer: string;
  /** Current balance held under this trustline */
  balance: string;
  /** Maximum balance permitted by this trustline */
  limit: string;
  /** Whether the issuer has authorised this trustline */
  authorized: boolean;
}

/**
 * Options accepted by `buildTrustlineTransaction`.
 */
export interface TrustlineTransactionOptions {
  /** Override the default fee (in stroops). Defaults to BASE_FEE. */
  fee?: string;
  /** Add a text memo to the transaction. */
  memo?: string;
  /** Transaction timeout in seconds. Defaults to TimeoutInfinite. */
  timeout?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum trust limit in Stellar's 7-decimal fixed-point format.
 * Equivalent to 922,337,203,685.4775807 — effectively unlimited.
 */
export const MAX_TRUST_LIMIT = '922337203685.4775807';

/** Sentinel limit string used by `removeTrustline` to clear a trustline. */
const REMOVE_TRUST_LIMIT = '0';

// ─── TrustlineService ─────────────────────────────────────────────────────────

export class TrustlineService {
  private client: StellarClient;

  constructor(client: StellarClient) {
    this.client = client;
  }

  // ── Query helpers ───────────────────────────────────────────────────────────

  /**
   * hasTrustline
   *
   * Returns `true` when `accountId` already holds a trustline for `asset`.
   * Native XLM always returns `true` (no trustline is needed for native).
   * Returns `false` for unknown accounts (Horizon 404) rather than throwing.
   *
   * @param accountId - Stellar public key of the account to check
   * @param asset     - The asset whose trustline is queried
   *
   * @example
   * ```ts
   * const usdc = new Asset('USDC', 'GA5Z...');
   * if (!await trustlines.hasTrustline(sender, usdc)) {
   *   // build and submit a CHANGE_TRUST transaction first
   * }
   * ```
   */
  async hasTrustline(accountId: string, asset: Asset): Promise<boolean> {
    if (asset.isNative()) return true;
    try {
      const trustline = await this.getTrustline(accountId, asset);
      return trustline !== null;
    } catch {
      return false;
    }
  }

  /**
   * getTrustlines
   *
   * Fetches all non-native trustlines for `accountId` from Horizon and returns
   * them as an array of `TrustlineInfo` objects. An empty array is returned
   * when the account has no issued-asset trustlines.
   *
   * @param accountId - Stellar public key of the account
   * @throws When Horizon returns an unexpected error (non-404)
   *
   * @example
   * ```ts
   * const lines = await trustlines.getTrustlines(accountId);
   * lines.forEach(t => console.log(t.assetCode, t.balance, t.limit));
   * ```
   */
  async getTrustlines(accountId: string): Promise<TrustlineInfo[]> {
    try {
      const balances = await this.fetchAccountBalances(accountId);
      return balances
        .filter((b: any) => b.asset_type !== 'native')
        .map((b: any) => this.balanceToTrustlineInfo(b));
    } catch (error) {
      throw new Error(
        `Failed to fetch trustlines for ${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * getTrustline
   *
   * Returns the `TrustlineInfo` for a specific `asset` on `accountId`, or
   * `null` when the trustline does not exist (including unknown accounts).
   *
   * @param accountId - Stellar public key of the account
   * @param asset     - The specific asset to look up
   *
   * @example
   * ```ts
   * const info = await trustlines.getTrustline(accountId, usdcAsset);
   * if (info) console.log('Balance:', info.balance, '/ Limit:', info.limit);
   * ```
   */
  async getTrustline(accountId: string, asset: Asset): Promise<TrustlineInfo | null> {
    if (asset.isNative()) return null;
    try {
      const balances = await this.fetchAccountBalances(accountId);
      const match = balances.find(
        (b: any) =>
          b.asset_type !== 'native' &&
          b.asset_code === asset.getCode() &&
          b.asset_issuer === asset.getIssuer()
      );
      return match ? this.balanceToTrustlineInfo(match) : null;
    } catch (error: any) {
      // Treat missing accounts as "no trustline" rather than an error
      if (error?.response?.status === 404 || /404/.test(error?.message ?? '')) {
        return null;
      }
      throw new Error(
        `Failed to get trustline for ${asset.getCode()} on ${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // ── Operation builders ──────────────────────────────────────────────────────

  /**
   * buildChangeTrustOp
   *
   * Builds a CHANGE_TRUST operation for `asset` without making any network
   * calls. Use this when you already know the trustline is absent and just
   * need the operation object to include in a transaction.
   *
   * @param asset  - The asset to trust
   * @param limit  - Maximum balance limit. Defaults to `MAX_TRUST_LIMIT`.
   * @returns A `CHANGE_TRUST` `Operation`
   *
   * @example
   * ```ts
   * const op = trustlines.buildChangeTrustOp(usdcAsset);
   * // add op to a TransactionBuilder
   * ```
   */
  buildChangeTrustOp(asset: Asset, limit?: string): Operation {
    return Operation.changeTrust({
      asset,
      limit: limit ?? MAX_TRUST_LIMIT,
    }) as unknown as Operation;
  }

  /**
   * removeTrustline
   *
   * Builds a CHANGE_TRUST operation with limit "0" which removes an existing
   * trustline. The account balance for the asset must be zero before this
   * operation can succeed on-chain.
   *
   * @param asset - The asset whose trustline to remove
   * @returns A `CHANGE_TRUST` operation with `limit = "0"`
   *
   * @example
   * ```ts
   * const op = trustlines.removeTrustline(usdcAsset);
   * ```
   */
  removeTrustline(asset: Asset): Operation {
    return Operation.changeTrust({
      asset,
      limit: REMOVE_TRUST_LIMIT,
    }) as unknown as Operation;
  }

  /**
   * ensureTrustline
   *
   * Checks whether `accountId` already trusts `asset`. If the trustline is
   * absent a `CHANGE_TRUST` operation is returned; if it already exists `null`
   * is returned so callers can skip the operation without extra branching.
   *
   * Native XLM always returns `null` (no trustline needed).
   *
   * @param accountId - Account that should hold the trustline
   * @param asset     - Asset to check / create a trustline for
   * @param limit     - Trust limit. Defaults to `MAX_TRUST_LIMIT`.
   * @returns A `CHANGE_TRUST` operation, or `null` if already trusted
   *
   * @example
   * ```ts
   * const op = await trustlines.ensureTrustline(sender, usdcAsset);
   * if (op) {
   *   // include op in a transaction and submit before payment
   * }
   * ```
   */
  async ensureTrustline(
    accountId: string,
    asset: Asset,
    limit?: string
  ): Promise<Operation | null> {
    if (asset.isNative()) return null;

    const exists = await this.hasTrustline(accountId, asset);
    if (exists) return null;

    return this.buildChangeTrustOp(asset, limit);
  }

  /**
   * ensureTrustlines
   *
   * Batch variant of `ensureTrustline`. Queries all provided assets in parallel
   * and returns only the `CHANGE_TRUST` operations that are actually required
   * (i.e. trustlines that do not yet exist). An empty array means all trustlines
   * are already in place.
   *
   * @param accountId - Account to check
   * @param assets    - List of assets to verify
   * @param limit     - Trust limit applied to every missing trustline. Defaults to `MAX_TRUST_LIMIT`.
   * @returns Array of `CHANGE_TRUST` operations (may be empty)
   *
   * @example
   * ```ts
   * const ops = await trustlines.ensureTrustlines(sender, [usdcAsset, eurcAsset]);
   * if (ops.length > 0) {
   *   // build and submit trustline transaction first
   * }
   * ```
   */
  async ensureTrustlines(
    accountId: string,
    assets: Asset[],
    limit?: string
  ): Promise<Operation[]> {
    const results = await Promise.all(
      assets.map((asset) => this.ensureTrustline(accountId, asset, limit))
    );
    return results.filter((op): op is Operation => op !== null);
  }

  /**
   * buildTrustlineTransaction
   *
   * Convenience method that combines `ensureTrustlines` with transaction
   * building. Returns a `TransactionBuilder` (pre-built, ready to sign and
   * submit) containing all required `CHANGE_TRUST` operations, or `null` when
   * every asset is already trusted (nothing to do).
   *
   * @param accountId - Source account (must already exist on-chain)
   * @param assets    - Assets to ensure trustlines for
   * @param options   - Optional fee, memo, and timeout overrides
   * @returns A built `TransactionBuilder`, or `null` if no ops are needed
   *
   * @example
   * ```ts
   * const builder = await trustlines.buildTrustlineTransaction(
   *   sender,
   *   [usdcAsset, eurcAsset],
   *   { memo: 'setup trustlines' }
   * );
   * if (builder) {
   *   const tx = builder.build();
   *   tx.sign(keypair);
   *   await client.submitTransaction(tx.toXDR());
   * }
   * ```
   */
  async buildTrustlineTransaction(
    accountId: string,
    assets: Asset[],
    options: TrustlineTransactionOptions = {}
  ): Promise<TransactionBuilder | null> {
    const ops = await this.ensureTrustlines(accountId, assets);
    if (ops.length === 0) return null;

    const accountInfo = await this.client.getAccount(accountId);
    const sourceAccount = new Account(accountId, accountInfo.sequence);

    return this.client.buildTransaction(sourceAccount, ops, {
      fee: options.fee,
      memo: options.memo,
      timeout: options.timeout,
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Fetches the raw Horizon balances array for an account.
   * Throws with a clear message on network failure.
   */
  private async fetchAccountBalances(accountId: string): Promise<any[]> {
    const horizon = this.client.getHorizon();
    const account = await horizon.loadAccount(accountId);
    return account.balances as any[];
  }

  /**
   * Maps a raw Horizon balance record to a `TrustlineInfo`.
   */
  private balanceToTrustlineInfo(balance: any): TrustlineInfo {
    return {
      assetCode:   balance.asset_code,
      assetIssuer: balance.asset_issuer,
      balance:     balance.balance,
      limit:       balance.limit,
      authorized:  balance.is_authorized ?? false,
    };
  }
}
