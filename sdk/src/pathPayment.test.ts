/**
 * pathPayment.test.ts
 *
 * Unit tests for PathPaymentService covering:
 *   - Route lookup and BestPathResult construction
 *   - Path string parsing (native XLM and issued assets)
 *   - Slippage-protected operation assembly (executePathPayment)
 *   - Liquidity score helper
 *   - Error handling for unsupported / empty corridors
 */

import { Asset, Operation, Networks } from 'stellar-sdk';
import BigNumber from 'bignumber.js';
import { PathPaymentService, BestPathResult } from './pathPayment';
import { StellarClient } from './client';

// ─── Shared test config ──────────────────────────────────────────────────────

const TEST_CONFIG = {
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
};

const TEST_CONTRACTS = {
  escrow: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  rateOracle: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  compliance: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const MXN_ISSUER  = 'GBZRMGST652BZPFUABHSVGRJOJRQP46ZB6GJ7D7FS37BZLZ6PJ5KYRBG';

const USDC = new Asset('USDC', USDC_ISSUER);
const MXN  = new Asset('MXN',  MXN_ISSUER);

const DESTINATION = 'GAI63MHBCK4PLZ6MVJK7OMSXH5GT3IDDKNAI2T7GL2GKJGM6VYYCJ7KN';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeRecord(sourceAmount: string, destAmount: string, path: any[] = []) {
  return { source_amount: sourceAmount, destination_amount: destAmount, path };
}

function makeClient(horizonMock: object): StellarClient {
  const client = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
  jest.spyOn(client, 'getHorizon').mockReturnValue(horizonMock as any);
  return client;
}

/**
 * Calls executePathPayment and decodes the XDR operation back into a plain
 * JS object so assertions can read .type, .sendMax, .sendAsset, etc.
 */
async function execAndDecode(
  service: PathPaymentService,
  pathResult: BestPathResult,
  destination: string,
  slippageBps?: number
) {
  const xdrOp = await service.executePathPayment(pathResult, destination, slippageBps);
  return Operation.fromXDRObject(xdrOp as any);
}

// ─── findBestPath ────────────────────────────────────────────────────────────

describe('PathPaymentService.findBestPath', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the cheapest route when multiple paths are available', async () => {
    const records = [
      makeFakeRecord('12.0000000', '100.0000000'),
      makeFakeRecord('10.5000000', '100.0000000'),
      makeFakeRecord('15.0000000', '100.0000000'),
    ];
    const client = makeClient({
      strictReceivePaths: () => ({ call: async () => ({ records }) }),
    });
    const result = await new PathPaymentService(client).findBestPath(USDC, MXN, '100');
    expect(result.sourceAmount).toBe('10.5000000');
    expect(result.destinationAmount).toBe('100.0000000');
  });

  it('populates sourceAsset and destinationAsset correctly', async () => {
    const client = makeClient({
      strictReceivePaths: () => ({
        call: async () => ({ records: [makeFakeRecord('5', '100')] }),
      }),
    });
    const result = await new PathPaymentService(client).findBestPath(USDC, MXN, '100');
    expect(result.sourceAsset).toBe(USDC.toString());
    expect(result.destinationAsset).toBe(MXN.toString());
  });

  it('converts native XLM path entries to the string "XLM"', async () => {
    const records = [{
      source_amount: '5', destination_amount: '100',
      path: [{ asset_type: 'native' }],
    }];
    const client = makeClient({
      strictReceivePaths: () => ({ call: async () => ({ records }) }),
    });
    const result = await new PathPaymentService(client).findBestPath(USDC, MXN, '100');
    expect(result.path).toContain('XLM');
  });

  it('converts issued-asset path entries to "<CODE>:<ISSUER>" format', async () => {
    const records = [{
      source_amount: '5', destination_amount: '100',
      path: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC_ISSUER }],
    }];
    const client = makeClient({
      strictReceivePaths: () => ({ call: async () => ({ records }) }),
    });
    const result = await new PathPaymentService(client).findBestPath(USDC, MXN, '100');
    expect(result.path[0]).toBe(`USDC:${USDC_ISSUER}`);
  });

  it('calculates the exchange rate as destinationAmount / sourceAmount', async () => {
    const src = '4.0000000';
    const dst = '100.0000000';
    const client = makeClient({
      strictReceivePaths: () => ({
        call: async () => ({ records: [makeFakeRecord(src, dst)] }),
      }),
    });
    const result = await new PathPaymentService(client).findBestPath(USDC, MXN, '100');
    const expected = parseFloat(new BigNumber(dst).dividedBy(src).toFixed(7));
    expect(result.rate).toBeCloseTo(expected, 6);
  });

  it('assigns a positive liquidity score', async () => {
    const client = makeClient({
      strictReceivePaths: () => ({
        call: async () => ({ records: [makeFakeRecord('10', '100')] }),
      }),
    });
    const result = await new PathPaymentService(client).findBestPath(USDC, MXN, '100');
    expect(result.score).toBeGreaterThan(0);
  });

  it('throws when no paths exist for an unsupported currency pair', async () => {
    const client = makeClient({
      strictReceivePaths: () => ({ call: async () => ({ records: [] }) }),
    });
    await expect(
      new PathPaymentService(client).findBestPath(USDC, MXN, '100')
    ).rejects.toThrow(/No path found/);
  });

  it('includes both asset codes in the "No path found" error message', async () => {
    const client = makeClient({
      strictReceivePaths: () => ({ call: async () => ({ records: [] }) }),
    });
    await expect(
      new PathPaymentService(client).findBestPath(USDC, MXN, '100')
    ).rejects.toThrow(new RegExp(`${USDC.toString()}.*${MXN.toString()}`));
  });

  it('propagates Horizon network errors as thrown exceptions', async () => {
    const client = makeClient({
      strictReceivePaths: () => ({
        call: async () => { throw new Error('Horizon 503'); },
      }),
    });
    await expect(
      new PathPaymentService(client).findBestPath(USDC, MXN, '100')
    ).rejects.toThrow('Horizon 503');
  });
});

// ─── executePathPayment ──────────────────────────────────────────────────────

describe('PathPaymentService.executePathPayment', () => {
  const basePath: BestPathResult = {
    path: [],
    sourceAmount: '10.0000000',
    sourceAsset: `USDC:${USDC_ISSUER}`,
    destinationAmount: '100.0000000',
    destinationAsset: `MXN:${MXN_ISSUER}`,
    rate: 10,
    score: 0.1,
  };

  function makeService(): PathPaymentService {
    return new PathPaymentService(new StellarClient(TEST_CONFIG, TEST_CONTRACTS));
  }

  it('returns a pathPaymentStrictReceive operation', async () => {
    const op = await execAndDecode(makeService(), basePath, DESTINATION);
    expect(op.type).toBe('pathPaymentStrictReceive');
  });

  it('sets destAmount equal to the BestPathResult destinationAmount', async () => {
    const op = await execAndDecode(makeService(), basePath, DESTINATION);
    expect(op.destAmount).toBe(basePath.destinationAmount);
  });

  it('sets destination to the given address', async () => {
    const op = await execAndDecode(makeService(), basePath, DESTINATION);
    expect(op.destination).toBe(DESTINATION);
  });

  describe('slippage protection — sendMax', () => {
    it('defaults to 50 bps (0.5%) above the source amount', async () => {
      const op = await execAndDecode(makeService(), basePath, DESTINATION);
      const expected = new BigNumber('10.0000000').times(1.005).toFixed(7);
      expect(op.sendMax).toBe(expected);
    });

    it('applies custom slippage when supplied', async () => {
      const op = await execAndDecode(makeService(), basePath, DESTINATION, 100);
      const expected = new BigNumber('10.0000000').times(1.01).toFixed(7);
      expect(op.sendMax).toBe(expected);
    });

    it('sendMax is strictly greater than sourceAmount (non-zero slippage)', async () => {
      const op = await execAndDecode(makeService(), basePath, DESTINATION);
      expect(new BigNumber(op.sendMax).isGreaterThan(basePath.sourceAmount)).toBe(true);
    });

    it('allows 0 bps slippage — sendMax equals sourceAmount', async () => {
      const op = await execAndDecode(makeService(), basePath, DESTINATION, 0);
      expect(op.sendMax).toBe(new BigNumber('10.0000000').toFixed(7));
    });

    it('handles large slippage values without precision loss', async () => {
      const op = await execAndDecode(makeService(), basePath, DESTINATION, 500);
      const expected = new BigNumber('10.0000000').times(1.05).toFixed(7);
      expect(op.sendMax).toBe(expected);
    });
  });

  describe('asset parsing in the assembled operation', () => {
    it('parses the native XLM source asset correctly', async () => {
      const xlmPath: BestPathResult = { ...basePath, sourceAsset: 'XLM' };
      const op = await execAndDecode(makeService(), xlmPath, DESTINATION);
      expect(op.sendAsset.isNative()).toBe(true);
    });

    it('parses an issued source asset correctly', async () => {
      const op = await execAndDecode(makeService(), basePath, DESTINATION);
      expect(op.sendAsset.getCode()).toBe('USDC');
      expect(op.sendAsset.getIssuer()).toBe(USDC_ISSUER);
    });

    it('parses the native XLM destination asset correctly', async () => {
      const xlmPath: BestPathResult = { ...basePath, destinationAsset: 'XLM' };
      const op = await execAndDecode(makeService(), xlmPath, DESTINATION);
      expect(op.destAsset.isNative()).toBe(true);
    });

    it('parses an issued destination asset correctly', async () => {
      const op = await execAndDecode(makeService(), basePath, DESTINATION);
      expect(op.destAsset.getCode()).toBe('MXN');
      expect(op.destAsset.getIssuer()).toBe(MXN_ISSUER);
    });

    it('parses intermediate path assets correctly', async () => {
      const withHop: BestPathResult = {
        ...basePath,
        path: [`USDC:${USDC_ISSUER}`, 'XLM'],
      };
      const op = await execAndDecode(makeService(), withHop, DESTINATION);
      expect(op.path).toHaveLength(2);
      expect(op.path[0].getCode()).toBe('USDC');
      expect(op.path[1].isNative()).toBe(true);
    });
  });
});

// ─── getLiquidityScore ───────────────────────────────────────────────────────

describe('PathPaymentService.getLiquidityScore', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns a positive score based on orderbook depth', async () => {
    const mockOrderbook = {
      bids: Array(10).fill({ amount: '1000' }),
      asks: Array(10).fill({ amount: '800' }),
    };
    const client = makeClient({
      orderbook: () => ({ call: async () => mockOrderbook }),
    });
    const score = await new PathPaymentService(client).getLiquidityScore(USDC);
    // Average of bid depth (10_000) and ask depth (8_000) → 9_000
    expect(score).toBeCloseTo(9000, 0);
  });

  it('handles fewer than 10 bids/asks without throwing', async () => {
    const client = makeClient({
      orderbook: () => ({ call: async () => ({ bids: [{ amount: '500' }], asks: [{ amount: '200' }] }) }),
    });
    const score = await new PathPaymentService(client).getLiquidityScore(USDC);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 when the orderbook call fails (graceful degradation)', async () => {
    const client = makeClient({
      orderbook: () => ({ call: async () => { throw new Error('network error'); } }),
    });
    const score = await new PathPaymentService(client).getLiquidityScore(USDC);
    expect(score).toBe(0);
  });

  it('returns 0 for an empty orderbook', async () => {
    const client = makeClient({
      orderbook: () => ({ call: async () => ({ bids: [], asks: [] }) }),
    });
    const score = await new PathPaymentService(client).getLiquidityScore(USDC);
    expect(score).toBe(0);
  });
});
