/**
 * pathPayment.integration.test.ts
 *
 * Integration tests for the end-to-end path selection pipeline.
 *
 * Scope
 * ─────
 * These tests wire PathPaymentService and RateOptimizer together without
 * stubbing their internal collaboration.  The only seam mocked here is the
 * outbound Horizon HTTP call (strictReceivePaths / orderbook), which cannot
 * run in CI without a live network.  Everything else — BestPathResult
 * construction, rate derivation, slippage maths, operation assembly, and
 * RateOptimizer venue selection — executes through real code.
 *
 * What this covers that unit tests do not
 * ────────────────────────────────────────
 * 1. PathPaymentService.findBestPath → RateOptimizer.getDexQuote pipeline:
 *    the optimizer's DEX venue actually calls the real PathPaymentService
 *    instance, so a change in how BestPathResult is shaped will surface here.
 *
 * 2. Full path selection → executePathPayment round-trip:
 *    findBestPath result flows directly into executePathPayment; the assembled
 *    XDR operation is decoded and every field is verified against the original
 *    Horizon record.
 *
 * 3. Multi-hop corridor assembly:
 *    a two-hop USDC → XLM → MXN path is discovered, selected as best, and
 *    assembled into an operation with the correct intermediate assets.
 *
 * 4. Optimizer selects DEX over External when DEX offers a better rate:
 *    the External placeholder always returns 0.92; any DEX rate above that
 *    should beat it.  This tests the ranking integration, not just mocked spies.
 *
 * 5. Slippage flows from findBestPath through to the assembled sendMax:
 *    sourceAmount from the real BestPathResult is used — not a hard-coded
 *    fixture — so arithmetic errors in the pipeline are caught.
 *
 * 6. Unsupported corridor: when Horizon returns no paths, RateOptimizer
 *    swallows the DEX error (returns null for that venue) and still resolves
 *    via External, proving the two components degrade gracefully together.
 */

import { Asset, Operation, Networks } from 'stellar-sdk';
import BigNumber from 'bignumber.js';
import { PathPaymentService, BestPathResult } from './pathPayment';
import { RateOptimizer } from './rateOptimizer';
import { StellarClient } from './client';

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_CONFIG = {
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
};

const TEST_CONTRACTS = {
  escrow:     'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  rateOracle: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  compliance: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

// Valid Stellar public keys used as asset issuers / destination
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const MXN_ISSUER  = 'GBZRMGST652BZPFUABHSVGRJOJRQP46ZB6GJ7D7FS37BZLZ6PJ5KYRBG';
const EUR_ISSUER  = 'GDEZZKSAXLNQ66JVKZ3D2CWSSQJFU7TGDJBQYADOPM3KVQD2FEVQMFPO';
const RECEIVER    = 'GAI63MHBCK4PLZ6MVJK7OMSXH5GT3IDDKNAI2T7GL2GKJGM6VYYCJ7KN';

const USDC = new Asset('USDC', USDC_ISSUER);
const MXN  = new Asset('MXN',  MXN_ISSUER);
const EUR  = new Asset('EUR',  EUR_ISSUER);
const XLM  = Asset.native();

const FROM_USDC = `USDC:${USDC_ISSUER}`;
const TO_MXN    = `MXN:${MXN_ISSUER}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a StellarClient whose Horizon server is replaced with a lightweight
 * fake.  Only the methods exercised by the pipeline need to be implemented.
 */
function buildClient(horizonFake: object): StellarClient {
  const client = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
  jest.spyOn(client, 'getHorizon').mockReturnValue(horizonFake as any);
  return client;
}

/** Decode an XDR operation back to a plain JS object for assertions. */
function decode(xdrOp: any) {
  return Operation.fromXDRObject(xdrOp);
}

/**
 * Minimal Horizon strictReceivePaths response for a single direct path.
 */
function horizonWithRecords(records: object[]) {
  return {
    strictReceivePaths: () => ({ call: async () => ({ records }) }),
    // orderbook is called by getLiquidityScore — return empty to keep it inert
    orderbook: () => ({ call: async () => ({ bids: [], asks: [] }) }),
  };
}

// ─── 1. findBestPath → executePathPayment round-trip ─────────────────────────

describe('Integration: findBestPath → executePathPayment round-trip', () => {
  afterEach(() => jest.restoreAllMocks());

  it('assembled operation reflects the rate and amounts returned by Horizon', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '9.5000000', destination_amount: '100.0000000', path: [] },
    ]));
    const service = new PathPaymentService(client);

    const best = await service.findBestPath(USDC, MXN, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER));

    // destination amount must match what Horizon returned
    expect(op.destAmount).toBe('100.0000000');
    // sendMax must be source + 0.5% default slippage
    const expectedSendMax = new BigNumber('9.5000000').times(1.005).toFixed(7);
    expect(op.sendMax).toBe(expectedSendMax);
    // assets round-trip correctly
    expect(op.sendAsset.getCode()).toBe('USDC');
    expect(op.destAsset.getCode()).toBe('MXN');
    expect(op.destination).toBe(RECEIVER);
  });

  it('cheapest of three Horizon records flows all the way into sendMax', async () => {
    // Horizon returns three routes; the cheapest source (8.0) should be chosen
    const client = buildClient(horizonWithRecords([
      { source_amount: '12.0000000', destination_amount: '100.0000000', path: [] },
      { source_amount: '8.0000000',  destination_amount: '100.0000000', path: [] },
      { source_amount: '10.0000000', destination_amount: '100.0000000', path: [] },
    ]));
    const service = new PathPaymentService(client);

    const best = await service.findBestPath(USDC, MXN, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER));

    expect(best.sourceAmount).toBe('8.0000000');
    const expectedSendMax = new BigNumber('8.0000000').times(1.005).toFixed(7);
    expect(op.sendMax).toBe(expectedSendMax);
  });

  it('custom slippage propagates end-to-end from findBestPath result to sendMax', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '10.0000000', destination_amount: '100.0000000', path: [] },
    ]));
    const service = new PathPaymentService(client);

    const best = await service.findBestPath(USDC, MXN, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER, 200)); // 200 bps = 2%

    const expectedSendMax = new BigNumber('10.0000000').times(1.02).toFixed(7);
    expect(op.sendMax).toBe(expectedSendMax);
  });

  it('XLM-source path is assembled with native sendAsset', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '50.0000000', destination_amount: '100.0000000', path: [] },
    ]));
    const service = new PathPaymentService(client);

    // Find best path from XLM to MXN
    const best = await service.findBestPath(XLM, MXN, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER));

    expect(op.sendAsset.isNative()).toBe(true);
    expect(op.destAsset.getCode()).toBe('MXN');
  });

  it('XLM-destination path is assembled with native destAsset', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '5.0000000', destination_amount: '100.0000000', path: [] },
    ]));
    const service = new PathPaymentService(client);

    const best = await service.findBestPath(USDC, XLM, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER));

    expect(op.sendAsset.getCode()).toBe('USDC');
    expect(op.destAsset.isNative()).toBe(true);
  });
});

// ─── 2. Multi-hop corridor ────────────────────────────────────────────────────

describe('Integration: multi-hop path selection and operation assembly', () => {
  afterEach(() => jest.restoreAllMocks());

  it('selects the two-hop route over the direct route when it is cheaper', async () => {
    const directRecord = {
      source_amount: '12.0000000',
      destination_amount: '100.0000000',
      path: [],
    };
    const twoHopRecord = {
      source_amount: '9.0000000',
      destination_amount: '100.0000000',
      path: [{ asset_type: 'native' }], // USDC → XLM → MXN
    };

    const client  = buildClient(horizonWithRecords([directRecord, twoHopRecord]));
    const service = new PathPaymentService(client);

    const best = await service.findBestPath(USDC, MXN, '100');
    expect(best.sourceAmount).toBe('9.0000000');
    expect(best.path).toContain('XLM');
  });

  it('assembles the intermediate XLM hop correctly in the operation', async () => {
    const client = buildClient(horizonWithRecords([{
      source_amount: '9.0000000',
      destination_amount: '100.0000000',
      path: [{ asset_type: 'native' }],
    }]));
    const service = new PathPaymentService(client);

    const best = await service.findBestPath(USDC, MXN, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER));

    expect(op.path).toHaveLength(1);
    expect(op.path[0].isNative()).toBe(true);
  });

  it('assembles a two-issued-asset hop (USDC → EUR → MXN) correctly', async () => {
    const client = buildClient(horizonWithRecords([{
      source_amount: '8.5000000',
      destination_amount: '100.0000000',
      path: [{ asset_type: 'credit_alphanum4', asset_code: 'EUR', asset_issuer: EUR_ISSUER }],
    }]));
    const service = new PathPaymentService(client);

    const best = await service.findBestPath(USDC, MXN, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER));

    expect(op.path).toHaveLength(1);
    expect(op.path[0].getCode()).toBe('EUR');
    expect(op.path[0].getIssuer()).toBe(EUR_ISSUER);
  });

  it('rate is computed correctly from the chosen multi-hop record', async () => {
    const src = '9.0000000';
    const dst = '100.0000000';
    const client = buildClient(horizonWithRecords([{
      source_amount: src,
      destination_amount: dst,
      path: [{ asset_type: 'native' }],
    }]));
    const service = new PathPaymentService(client);

    const best = await service.findBestPath(USDC, MXN, '100');

    const expectedRate = parseFloat(new BigNumber(dst).dividedBy(src).toFixed(7));
    expect(best.rate).toBeCloseTo(expectedRate, 6);
  });
});

// ─── 3. RateOptimizer DEX venue uses real PathPaymentService ──────────────────

describe('Integration: RateOptimizer DEX venue wired to real PathPaymentService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('optimizer returns DEX venue when Horizon has a better rate than External', async () => {
    // External always returns 0.92 (92 units per 100).
    // DEX returns a source of 5 for a dest of 100, so rate = 20 → 2000 units per 100.
    const client    = buildClient(horizonWithRecords([
      { source_amount: '5.0000000', destination_amount: '100.0000000', path: [] },
    ]));
    const optimizer = new RateOptimizer(client);

    // Stub only Oracle (requires live Soroban) to prevent it from throwing
    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockRejectedValue(
      new Error('oracle not available in test')
    );

    const result = await optimizer.findCheapestExecution(FROM_USDC, TO_MXN, '100');

    expect(result.venue).toBe('DEX');
    expect(result.amount).toBe('100.0000000');
    expect(result.path).toBeDefined();
  });

  it('optimizer falls back to External when Horizon returns no paths', async () => {
    // Horizon returns empty records → DEX venue returns null
    const client = buildClient({
      strictReceivePaths: () => ({ call: async () => ({ records: [] }) }),
      orderbook: () => ({ call: async () => ({ bids: [], asks: [] }) }),
    });
    const optimizer = new RateOptimizer(client);

    // Also stub Oracle so only External survives
    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockRejectedValue(
      new Error('oracle not available in test')
    );

    const result = await optimizer.findCheapestExecution(FROM_USDC, TO_MXN, '100');

    expect(result.venue).toBe('External');
    expect(new BigNumber(result.amount).isGreaterThan(0)).toBe(true);
  });

  it('optimizer DEX path array is populated from the real PathPaymentService result', async () => {
    const client = buildClient(horizonWithRecords([{
      source_amount: '5.0000000',
      destination_amount: '100.0000000',
      path: [{ asset_type: 'native' }], // XLM hop
    }]));
    const optimizer = new RateOptimizer(client);

    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockRejectedValue(
      new Error('oracle not available in test')
    );

    const result = await optimizer.findCheapestExecution(FROM_USDC, TO_MXN, '100');

    expect(result.venue).toBe('DEX');
    expect(result.path).toContain('XLM');
  });

  it('optimizer DEX confidence is 95 when the DEX route is selected', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '5.0000000', destination_amount: '100.0000000', path: [] },
    ]));
    const optimizer = new RateOptimizer(client);

    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockRejectedValue(
      new Error('oracle not available in test')
    );

    const result = await optimizer.findCheapestExecution(FROM_USDC, TO_MXN, '100');

    expect(result.confidence).toBe(95);
  });
});

// ─── 4. findBestPath result drives full operation assembly ────────────────────

describe('Integration: BestPathResult drives complete operation fields', () => {
  afterEach(() => jest.restoreAllMocks());

  it('operation type is always pathPaymentStrictReceive', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '10.0000000', destination_amount: '200.0000000', path: [] },
    ]));
    const service = new PathPaymentService(client);
    const best = await service.findBestPath(USDC, MXN, '200');
    const op   = decode(await service.executePathPayment(best, RECEIVER));
    expect(op.type).toBe('pathPaymentStrictReceive');
  });

  it('destination address in the operation matches the receiver argument', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '10.0000000', destination_amount: '100.0000000', path: [] },
    ]));
    const service = new PathPaymentService(client);
    const best = await service.findBestPath(USDC, MXN, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER));
    expect(op.destination).toBe(RECEIVER);
  });

  it('destAmount in the operation matches Horizon destination_amount exactly', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '10.0000000', destination_amount: '350.5000000', path: [] },
    ]));
    const service = new PathPaymentService(client);
    const best = await service.findBestPath(USDC, MXN, '350.5000000');
    const op   = decode(await service.executePathPayment(best, RECEIVER));
    expect(op.destAmount).toBe('350.5000000');
  });

  it('sendMax is always strictly greater than Horizon source_amount (default slippage)', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '7.3000000', destination_amount: '100.0000000', path: [] },
    ]));
    const service = new PathPaymentService(client);
    const best = await service.findBestPath(USDC, MXN, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER));

    expect(new BigNumber(op.sendMax).isGreaterThan('7.3000000')).toBe(true);
  });

  it('sendMax precision is always 7 decimal places regardless of source amount', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '3.1415926', destination_amount: '100.0000000', path: [] },
    ]));
    const service = new PathPaymentService(client);
    const best = await service.findBestPath(USDC, MXN, '100');
    const op   = decode(await service.executePathPayment(best, RECEIVER));

    const decimalPart = op.sendMax.split('.')[1] ?? '';
    expect(decimalPart.length).toBe(7);
  });

  it('rate on BestPathResult is consistent with sendMax and destAmount', async () => {
    const src = '10.0000000';
    const dst = '172.0000000';
    const client = buildClient(horizonWithRecords([
      { source_amount: src, destination_amount: dst, path: [] },
    ]));
    const service = new PathPaymentService(client);
    const best = await service.findBestPath(USDC, MXN, dst);
    const op   = decode(await service.executePathPayment(best, RECEIVER));

    // rate = dst / src
    const expectedRate = parseFloat(new BigNumber(dst).dividedBy(src).toFixed(7));
    expect(best.rate).toBeCloseTo(expectedRate, 5);

    // Verify sendMax > sourceAmount
    expect(new BigNumber(op.sendMax).isGreaterThan(src)).toBe(true);
  });
});

// ─── 5. Liquidity score feeds into path scoring ───────────────────────────────

describe('Integration: liquidity score is computed from the selected path record', () => {
  afterEach(() => jest.restoreAllMocks());

  it('score is inversely proportional to source amount (cheaper = higher score)', async () => {
    const cheapRecord     = { source_amount: '5.0000000',  destination_amount: '100.0000000', path: [] };
    const expensiveRecord = { source_amount: '20.0000000', destination_amount: '100.0000000', path: [] };

    const clientCheap     = buildClient(horizonWithRecords([cheapRecord]));
    const clientExpensive = buildClient(horizonWithRecords([expensiveRecord]));

    const cheapResult     = await new PathPaymentService(clientCheap).findBestPath(USDC, MXN, '100');
    const expensiveResult = await new PathPaymentService(clientExpensive).findBestPath(USDC, MXN, '100');

    // 100 / 5 = 20  >  100 / 20 = 5
    expect(cheapResult.score).toBeGreaterThan(expensiveResult.score);
  });

  it('score is always positive for any valid Horizon record', async () => {
    const client = buildClient(horizonWithRecords([
      { source_amount: '999.9999999', destination_amount: '100.0000000', path: [] },
    ]));
    const result = await new PathPaymentService(client).findBestPath(USDC, MXN, '100');
    expect(result.score).toBeGreaterThan(0);
  });
});

// ─── 6. Error propagation across the pipeline ────────────────────────────────

describe('Integration: error propagation across PathPaymentService and RateOptimizer', () => {
  afterEach(() => jest.restoreAllMocks());

  it('Horizon 503 surfaces from findBestPath without being swallowed', async () => {
    const client = buildClient({
      strictReceivePaths: () => ({
        call: async () => { throw new Error('upstream Horizon 503'); },
      }),
      orderbook: () => ({ call: async () => ({ bids: [], asks: [] }) }),
    });
    const service = new PathPaymentService(client);

    await expect(service.findBestPath(USDC, MXN, '100')).rejects.toThrow('upstream Horizon 503');
  });

  it('RateOptimizer treats PathPaymentService Horizon error as DEX null, not total failure', async () => {
    const client = buildClient({
      strictReceivePaths: () => ({
        call: async () => { throw new Error('upstream Horizon 503'); },
      }),
      orderbook: () => ({ call: async () => ({ bids: [], asks: [] }) }),
    });
    const optimizer = new RateOptimizer(client);

    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockRejectedValue(
      new Error('oracle not available in test')
    );

    // External still works → should resolve, not throw
    const result = await optimizer.findCheapestExecution(FROM_USDC, TO_MXN, '100');
    expect(result.venue).toBe('External');
  });

  it('optimizer throws only when all three venues are unavailable', async () => {
    const client = buildClient({
      strictReceivePaths: () => ({
        call: async () => { throw new Error('Horizon down'); },
      }),
      orderbook: () => ({ call: async () => ({ bids: [], asks: [] }) }),
    });
    const optimizer = new RateOptimizer(client);

    // Stub oracle to fail
    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockRejectedValue(
      new Error('oracle down')
    );
    // Stub external to fail too
    jest.spyOn(optimizer as any, 'getExternalQuote').mockResolvedValue(null);

    await expect(
      optimizer.findCheapestExecution(FROM_USDC, TO_MXN, '100')
    ).rejects.toThrow(/No execution path found/);
  });

  it('unsupported pair (empty Horizon records) surfaces as "No path found" from PathPaymentService', async () => {
    const client = buildClient({
      strictReceivePaths: () => ({ call: async () => ({ records: [] }) }),
      orderbook: () => ({ call: async () => ({ bids: [], asks: [] }) }),
    });
    const service = new PathPaymentService(client);

    await expect(service.findBestPath(USDC, MXN, '100')).rejects.toThrow(/No path found/);
  });
});
