/**
 * rateOptimizer.ts
 *
 * # Overview
 * RateOptimizer fetches quotes from up to three execution venues in parallel and
 * returns whichever venue offers the highest destination amount for a given trade.
 *
 * ## Venues
 * | Venue    | Source                           | Confidence |
 * |----------|----------------------------------|------------|
 * | DEX      | Stellar DEX via PathPaymentService | 95        |
 * | Oracle   | On-chain rate oracle contract    | 50–90      |
 * | External | External FX API (XE / OANDA)     | 100 (mock) |
 *
 * ## Input / Output contract
 *
 * ### findCheapestExecution(fromAsset, toAsset, amount)
 * - `fromAsset`  – asset string in `"CODE:ISSUER"` format, or `"XLM"` for native
 * - `toAsset`    – same format as `fromAsset`
 * - `amount`     – the **source** amount (string, decimal notation, e.g. `"100.00"`)
 * - Returns an `OptimizedRate` for the venue that yields the highest
 *   `destinationAmount`.  Throws when every venue fails.
 *
 * ## Selection algorithm
 * All three quotes are fetched with `Promise.all`.  Failed venues return `null`
 * and are excluded.  The surviving quotes are sorted in descending order of
 * `amount` (using BigNumber for precision) and the first element is returned.
 *
 * ## Edge cases
 * - **All venues fail** → throws `"No execution path found for …"`.
 * - **Equal amounts** → the quote that appears first after a stable sort wins
 *   (order: DEX, Oracle, External).  The caller may override by filtering on
 *   `confidence` after calling this method.
 * - **Zero amount** → venues may return `"0.0000000"` which is valid; callers
 *   should validate amounts before constructing transactions.
 * - **Asset not on DEX** → DEX venue returns `null`; remaining venues are still
 *   considered so the call does not throw unless they also fail.
 *
 * ## Oracle rate precision
 * The on-chain oracle stores rates as 7-decimal fixed-point integers
 * (i.e. `1_000_000` ≡ `0.1`).  `getOracleQuote` divides by `1_000_000` before
 * multiplying by the requested amount.
 */

import { Asset } from 'stellar-sdk';
import BigNumber from 'bignumber.js';
import { StellarClient } from './client';
import { PathPaymentService, BestPathResult } from './pathPayment';
import { StellarPayments } from './payments';
import { ExchangeRateRequest } from './types';

export interface OptimizedRate {
  /** Which venue produced this quote */
  venue: 'DEX' | 'Oracle' | 'External';
  /**
   * Effective exchange rate as a decimal string
   * (destinationAmount / sourceAmount, 7 decimal places)
   */
  rate: string;
  /**
   * Expected destination amount for the given source amount.
   * Precision: 7 decimal places (Stellar stroops).
   */
  amount: string;
  /**
   * Optional DEX route — only present for venue === 'DEX'.
   * Each element is either "XLM" or "CODE:ISSUER".
   */
  path?: string[];
  /**
   * Confidence score 0–100.
   * DEX: 95  |  Oracle: 90 (when sources > 0), 50 otherwise  |  External: 100
   */
  confidence: number;
}

export class RateOptimizer {
  private client: StellarClient;
  private pathService: PathPaymentService;
  private payments: StellarPayments;

  constructor(client: StellarClient) {
    this.client = client;
    this.pathService = new PathPaymentService(client);
    this.payments = new StellarPayments(client);
  }

  /**
   * findCheapestExecution
   *
   * Queries all three execution venues in parallel and returns the one that
   * produces the highest destination amount for `amount` units of `fromAsset`.
   *
   * @param fromAsset - Source asset string (`"CODE:ISSUER"` or `"XLM"`)
   * @param toAsset   - Destination asset string
   * @param amount    - Source amount as a decimal string (e.g. `"500.00"`)
   * @returns The `OptimizedRate` with the highest `amount` field
   * @throws  When no venue can produce a quote
   *
   * @example
   * ```ts
   * const rate = await optimizer.findCheapestExecution(
   *   'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
   *   'MXN:GBV55FNBXMF5QWV3LZUYEJRSXJQ7GJCHHSEJGZGA7NRQQJHQXGYZFPC',
   *   '500'
   * );
   * console.log(rate.venue, rate.amount);
   * ```
   */
  async findCheapestExecution(
    fromAsset: string,
    toAsset: string,
    amount: string
  ): Promise<OptimizedRate> {
    const fromSymbol = this.getAssetSymbol(fromAsset);
    const toSymbol   = this.getAssetSymbol(toAsset);

    const failures: { venue: string; reason: string }[] = [];

    const [dexQuote, oracleQuote, externalQuote] = await Promise.all([
      this.getDexQuote(fromAsset, toAsset, amount).catch((e: Error) => {
        failures.push({ venue: 'DEX', reason: e.message });
        return null;
      }),
      this.getOracleQuote(fromSymbol, toSymbol, amount).catch((e: Error) => {
        failures.push({ venue: 'Oracle', reason: e.message });
        return null;
      }),
      this.getExternalQuote(fromSymbol, toSymbol, amount).catch((e: Error) => {
        failures.push({ venue: 'External', reason: e.message });
        return null;
      }),
    ]);

    const quotes: OptimizedRate[] = [];
    if (dexQuote)      quotes.push(dexQuote);
    if (oracleQuote)   quotes.push(oracleQuote);
    if (externalQuote) quotes.push(externalQuote);

    if (quotes.length === 0) {
      const details = failures.map(f => `${f.venue}: ${f.reason}`).join('; ');
      throw new Error(
        `No execution path found for ${fromAsset} -> ${toAsset}. Failures: ${details}`
      );
    }

    // Sort by best rate (highest amount for destination)
    return quotes.sort((a, b) =>
      new BigNumber(b.amount).comparedTo(a.amount) ?? 0
    )[0];
  }

  // ─── Private venue adapters ───────────────────────────────────────────────

  /**
   * getDexQuote
   * Delegates to PathPaymentService.findBestPath to discover a DEX route.
   * Returns null on any failure (e.g. no DEX liquidity for this pair).
   */
  private async getDexQuote(
    from: string,
    to: string,
    amount: string
  ): Promise<OptimizedRate | null> {
    const fromA   = this.parseAsset(from);
    const toA     = this.parseAsset(to);
    const result: BestPathResult = await this.pathService.findBestPath(fromA, toA, amount);

    return {
      venue:      'DEX',
      rate:       result.rate.toString(),
      amount:     result.destinationAmount,
      path:       result.path,
      confidence: 95,
    };
  }

  /**
   * getOracleQuote
   * Reads from the on-chain rate oracle contract via StellarPayments.getExchangeRate.
   *
   * Rate precision note: the contract stores rates as 7-decimal fixed-point
   * integers, so we divide by 1_000_000 to get the human-readable decimal rate
   * before computing the destination amount.
   *
   * Confidence degrades to 50 when no oracle sources are active.
   */
  private async getOracleQuote(
    from: string,
    to: number | string,
    amount: string
  ): Promise<OptimizedRate | null> {
    const request: ExchangeRateRequest = {
      from_currency: from,
      to_currency:   to.toString(),
    };
    const result = await this.payments.getExchangeRate(request);

    const rateBN    = new BigNumber(result.rate).dividedBy(1_000_000);
    const destAmount = new BigNumber(amount).times(rateBN).toFixed(7);

    return {
      venue:      'Oracle',
      rate:       rateBN.toString(),
      amount:     destAmount,
      confidence: result.aggregated.sources_count > 0 ? 90 : 50,
    };
  }

  /**
   * getExternalQuote
   * Placeholder for External FX APIs (XE, OANDA).
   *
   * In production this calls an HTTP FX feed. The mock returns a static 0.92
   * EUR rate so the method is exercisable without live API keys.
   *
   * Confidence is hard-coded to 100 because the external API is assumed to be
   * the most authoritative FX reference.  Replace with a dynamic confidence
   * score when integrating a real provider.
   */
  private async getExternalQuote(
    from: string,
    to: string,
    amount: string
  ): Promise<OptimizedRate | null> {
    // Placeholder for External FX APIs (XE, OANDA)
    // In a real implementation, this would call axios.get(...)
    return {
      venue:      'External',
      rate:       '0.92', // Mock EUR rate
      amount:     new BigNumber(amount).times(0.92).toFixed(7),
      confidence: 100,
    };
  }

  // ─── Asset helpers ────────────────────────────────────────────────────────

  private parseAsset(assetStr: string): Asset {
    if (assetStr === 'XLM' || assetStr === 'native') return Asset.native();
    const [code, issuer] = assetStr.split(':');
    return new Asset(code, issuer);
  }

  private getAssetSymbol(assetStr: string): string {
    if (assetStr === 'XLM' || assetStr === 'native') return 'XLM';
    return assetStr.split(':')[0];
  }
}
