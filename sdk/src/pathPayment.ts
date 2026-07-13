import {
  Asset,
  Horizon,
  Operation,
  TransactionBuilder,
  Address,
  ScInt,
  xdr,
} from 'stellar-sdk';
import BigNumber from 'bignumber.js';
import { StellarClient } from './client';

export interface PathStep {
  asset: string;
  amount: string;
}

export interface BestPathResult {
  path: string[];
  sourceAmount: string;
  sourceAsset: string;
  destinationAmount: string;
  destinationAsset: string;
  rate: number;
  score: number;
}

export class PathPaymentService {
  private client: StellarClient;

  constructor(client: StellarClient) {
    this.client = client;
  }

  /**
   * findBestPath - DEX path discovery via Horizon
   */
  async findBestPath(
    fromAsset: Asset,
    toAsset: Asset,
    destinationAmount: string
  ): Promise<BestPathResult> {
    const horizon = this.client.getHorizon();
    
    // Query path payments from Horizon
    const paths = await horizon
      .strictReceivePaths([fromAsset], toAsset, destinationAmount)
      .call();

    if (paths.records.length === 0) {
      throw new Error(`No path found from ${fromAsset.toString()} to ${toAsset.toString()}`);
    }

    // Sort by cheapest source amount
    const bestRecord = paths.records.sort((a: any, b: any) =>
      new BigNumber(a.source_amount).comparedTo(b.source_amount) ?? 0
    )[0];

    const pathStrings = bestRecord.path.map((p: any) => 
      p.asset_type === 'native' ? 'XLM' : `${p.asset_code}:${p.asset_issuer}`
    );

    return {
      path: pathStrings,
      sourceAmount: bestRecord.source_amount,
      sourceAsset: fromAsset.toString(),
      destinationAmount: bestRecord.destination_amount,
      destinationAsset: toAsset.toString(),
      rate: parseFloat(new BigNumber(bestRecord.destination_amount).dividedBy(bestRecord.source_amount).toFixed(7)),
      score: this.calculateLiquidityScore(bestRecord),
    };
  }

  /**
   * executePathPayment - Transaction building with slippage protection
   */
  async executePathPayment(
    pathResult: BestPathResult,
    destination: string,
    maxSlippageBps: number = 50
  ) {
    const slippageMultiplier = new BigNumber(1).plus(maxSlippageBps / 10000);
    const sendMax = new BigNumber(pathResult.sourceAmount)
      .times(slippageMultiplier)
      .toFixed(7);

    const path = pathResult.path.map(p => this.parseAsset(p));

    return Operation.pathPaymentStrictReceive({
      destination,
      sendAsset: this.parseAsset(pathResult.sourceAsset),
      sendMax,
      destAsset: this.parseAsset(pathResult.destinationAsset),
      destAmount: pathResult.destinationAmount,
      path,
    });
  }

  /**
   * getLiquidityScore - Depth analysis for corridor reliability
   */
  async getLiquidityScore(asset: Asset): Promise<number> {
    const horizon = this.client.getHorizon();
    try {
      const orderbook = await horizon.orderbook(asset, Asset.native()).call();
      // Simple score: sum of top 10 bid/ask volumes
      const bidDepth = orderbook.bids.slice(0, 10).reduce((sum: number, b: any) => sum + parseFloat(b.amount), 0);
      const askDepth = orderbook.asks.slice(0, 10).reduce((sum: number, a: any) => sum + parseFloat(a.amount), 0);
      return (bidDepth + askDepth) / 2;
    } catch {
      return 0;
    }
  }

  private calculateLiquidityScore(record: Horizon.ServerApi.PaymentPathRecord): number {
    // Simplified score for the path
    return 100 / parseFloat(record.source_amount);
  }

  private parseAsset(assetStr: string): Asset {
    if (assetStr === 'XLM' || assetStr === 'native') return Asset.native();
    const [code, issuer] = assetStr.split(':');
    return new Asset(code, issuer);
  }
}
