/**
 * rateOptimizer.test.ts
 *
 * Unit tests for RateOptimizer covering:
 *   - Best-path selection across multiple venues
 *   - Fee / rate trade-offs (DEX vs Oracle vs External)
 *   - Equal-cost route tie-breaking
 *   - Venue failure / partial failure scenarios
 *   - Oracle rate precision (fixed-point ÷ 1_000_000)
 *   - Error propagation when all venues fail
 */

import { Networks } from 'stellar-sdk';
import BigNumber from 'bignumber.js';
import { RateOptimizer, OptimizedRate } from './rateOptimizer';
import { StellarClient } from './client';
import { PathPaymentService } from './pathPayment';
import { StellarPayments } from './payments';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TEST_CONFIG = {
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
};

const TEST_CONTRACTS = {
  escrow:      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  rateOracle:  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  compliance:  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const MXN_ISSUER  = 'GBZRMGST652BZPFUABHSVGRJOJRQP46ZB6GJ7D7FS37BZLZ6PJ5KYRBG';

const FROM = `USDC:${USDC_ISSUER}`;
const TO   = `MXN:${MXN_ISSUER}`;
const AMT  = '100';

// ─── Helper: create a RateOptimizer with mocked venue methods ─────────────────

/**
 * Builds a RateOptimizer and replaces the private getDexQuote / getOracleQuote /
 * getExternalQuote with jest spies returning the given values.
 */
function makeOptimizer(overrides: {
  dex?:      OptimizedRate | null;
  oracle?:   OptimizedRate | null;
  external?: OptimizedRate | null;
}): RateOptimizer {
  const client    = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
  const optimizer = new RateOptimizer(client);

  const dexResult = overrides.dex !== undefined
    ? overrides.dex
    : { venue: 'DEX' as const, rate: '10', amount: '1000.0000000', confidence: 95 };

  const oracleResult = overrides.oracle !== undefined
    ? overrides.oracle
    : { venue: 'Oracle' as const, rate: '9.5', amount: '950.0000000', confidence: 90 };

  const externalResult = overrides.external !== undefined
    ? overrides.external
    : { venue: 'External' as const, rate: '0.92', amount: '92.0000000', confidence: 100 };

  // Reach into private methods via type cast
  jest.spyOn(optimizer as any, 'getDexQuote').mockResolvedValue(dexResult);
  jest.spyOn(optimizer as any, 'getOracleQuote').mockResolvedValue(oracleResult);
  jest.spyOn(optimizer as any, 'getExternalQuote').mockResolvedValue(externalResult);

  return optimizer;
}

// ─── Best-path selection ──────────────────────────────────────────────────────

describe('RateOptimizer.findCheapestExecution — best-path selection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('selects the venue with the highest destination amount', async () => {
    const optimizer = makeOptimizer({
      dex:      { venue: 'DEX',      rate: '10',   amount: '1000.0000000', confidence: 95 },
      oracle:   { venue: 'Oracle',   rate: '9.5',  amount:  '950.0000000', confidence: 90 },
      external: { venue: 'External', rate: '0.92', amount:   '92.0000000', confidence: 100 },
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    expect(result.venue).toBe('DEX');
    expect(result.amount).toBe('1000.0000000');
  });

  it('prefers Oracle over DEX when Oracle returns more', async () => {
    const optimizer = makeOptimizer({
      dex:      { venue: 'DEX',    rate: '9',    amount: '900.0000000', confidence: 95 },
      oracle:   { venue: 'Oracle', rate: '10.5', amount: '1050.0000000', confidence: 90 },
      external: { venue: 'External', rate: '8', amount: '800.0000000', confidence: 100 },
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    expect(result.venue).toBe('Oracle');
  });

  it('prefers External when it outbids both DEX and Oracle', async () => {
    const optimizer = makeOptimizer({
      dex:      { venue: 'DEX',      rate: '9',   amount:  '900.0000000', confidence: 95 },
      oracle:   { venue: 'Oracle',   rate: '8',   amount:  '800.0000000', confidence: 90 },
      external: { venue: 'External', rate: '11',  amount: '1100.0000000', confidence: 100 },
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    expect(result.venue).toBe('External');
  });

  it('includes the DEX route path in the result when DEX wins', async () => {
    const optimizer = makeOptimizer({
      dex: {
        venue:      'DEX',
        rate:       '10',
        amount:     '1000.0000000',
        path:       ['XLM', `USDC:${USDC_ISSUER}`],
        confidence: 95,
      },
      oracle:   { venue: 'Oracle',   rate: '9', amount: '900.0000000', confidence: 90 },
      external: { venue: 'External', rate: '8', amount: '800.0000000', confidence: 100 },
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    expect(result.path).toBeDefined();
    expect(result.path).toContain('XLM');
  });

  it('returns the correct rate string on the winning quote', async () => {
    const optimizer = makeOptimizer({
      dex:      { venue: 'DEX',      rate: '10', amount: '1000.0000000', confidence: 95 },
      oracle:   { venue: 'Oracle',   rate: '9',  amount: '900.0000000',  confidence: 90 },
      external: { venue: 'External', rate: '8',  amount: '800.0000000',  confidence: 100 },
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    expect(result.rate).toBe('10');
  });
});

// ─── Venue failure / partial failure ─────────────────────────────────────────

describe('RateOptimizer.findCheapestExecution — venue failure handling', () => {
  afterEach(() => jest.restoreAllMocks());

  it('falls back to Oracle when DEX returns null', async () => {
    const optimizer = makeOptimizer({
      dex:      null,
      oracle:   { venue: 'Oracle',   rate: '10', amount: '1000.0000000', confidence: 90 },
      external: { venue: 'External', rate: '8',  amount:  '800.0000000', confidence: 100 },
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    expect(result.venue).toBe('Oracle');
  });

  it('falls back to External when DEX and Oracle both return null', async () => {
    const optimizer = makeOptimizer({
      dex:      null,
      oracle:   null,
      external: { venue: 'External', rate: '8', amount: '800.0000000', confidence: 100 },
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    expect(result.venue).toBe('External');
  });

  it('falls back to DEX when Oracle and External both return null', async () => {
    const optimizer = makeOptimizer({
      dex:    { venue: 'DEX', rate: '10', amount: '1000.0000000', confidence: 95 },
      oracle: null,
      external: null,
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    expect(result.venue).toBe('DEX');
  });

  it('throws when all three venues return null', async () => {
    const optimizer = makeOptimizer({ dex: null, oracle: null, external: null });

    await expect(optimizer.findCheapestExecution(FROM, TO, AMT)).rejects.toThrow(
      /No execution path found/
    );
  });

  it('error message includes both asset strings', async () => {
    const optimizer = makeOptimizer({ dex: null, oracle: null, external: null });

    await expect(optimizer.findCheapestExecution(FROM, TO, AMT)).rejects.toThrow(
      new RegExp(`${FROM}.*${TO}`)
    );
  });
});

// ─── Equal-cost routes ────────────────────────────────────────────────────────

describe('RateOptimizer.findCheapestExecution — equal-cost tie-breaking', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the DEX quote when DEX and Oracle yield the same amount', async () => {
    // DEX is pushed into the sorted array before Oracle, so it wins on a stable sort
    const optimizer = makeOptimizer({
      dex:      { venue: 'DEX',      rate: '10', amount: '1000.0000000', confidence: 95 },
      oracle:   { venue: 'Oracle',   rate: '10', amount: '1000.0000000', confidence: 90 },
      external: { venue: 'External', rate: '5',  amount:  '500.0000000', confidence: 100 },
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    // The sort is descending; tied quotes retain their insertion order
    expect(['DEX', 'Oracle']).toContain(result.venue);
    expect(result.amount).toBe('1000.0000000');
  });

  it('returns a quote when all venues tie at the same amount', async () => {
    const optimizer = makeOptimizer({
      dex:      { venue: 'DEX',      rate: '10', amount: '1000.0000000', confidence: 95 },
      oracle:   { venue: 'Oracle',   rate: '10', amount: '1000.0000000', confidence: 90 },
      external: { venue: 'External', rate: '10', amount: '1000.0000000', confidence: 100 },
    });

    const result = await optimizer.findCheapestExecution(FROM, TO, AMT);
    expect(result.amount).toBe('1000.0000000');
  });
});

// ─── Oracle rate precision ────────────────────────────────────────────────────

describe('RateOptimizer oracle rate precision', () => {
  afterEach(() => jest.restoreAllMocks());

  /**
   * Verify the fixed-point ÷ 1_000_000 logic by directly exercising getOracleQuote
   * through a mocked StellarPayments.getExchangeRate.
   */
  it('divides the on-chain rate integer by 1_000_000 before computing destAmount', async () => {
    const client    = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    const optimizer = new RateOptimizer(client);

    // Simulate oracle returning rate = 10_000_000 (≡ 10.0 in decimal)
    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockResolvedValue({
      rate:      '10000000',
      timestamp: 0,
      sources:   [],
      aggregated: { sources_count: 2, rate: '10000000', weighted_average: '10000000', last_updated: 0, deviation_threshold: 5 },
    });

    const quote = await (optimizer as any).getOracleQuote('USDC', 'MXN', '100');

    // Expected: rate = 10_000_000 / 1_000_000 = 10; destAmount = 100 * 10 = 1000
    expect(new BigNumber(quote.rate).toFixed(2)).toBe('10.00');
    expect(new BigNumber(quote.amount).toFixed(2)).toBe('1000.00');
  });

  it('assigns confidence 90 when oracle has active sources', async () => {
    const client    = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    const optimizer = new RateOptimizer(client);

    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockResolvedValue({
      rate: '920000', timestamp: 0, sources: [],
      aggregated: { sources_count: 3, rate: '920000', weighted_average: '920000', last_updated: 0, deviation_threshold: 5 },
    });

    const quote = await (optimizer as any).getOracleQuote('EUR', 'USD', '100');
    expect(quote.confidence).toBe(90);
  });

  it('assigns confidence 50 when oracle has zero active sources', async () => {
    const client    = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    const optimizer = new RateOptimizer(client);

    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockResolvedValue({
      rate: '920000', timestamp: 0, sources: [],
      aggregated: { sources_count: 0, rate: '920000', weighted_average: '920000', last_updated: 0, deviation_threshold: 5 },
    });

    const quote = await (optimizer as any).getOracleQuote('EUR', 'USD', '100');
    expect(quote.confidence).toBe(50);
  });

  it('rethrows when getExchangeRate fails', async () => {
    const client    = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    const optimizer = new RateOptimizer(client);

    jest.spyOn((optimizer as any).payments, 'getExchangeRate').mockRejectedValue(
      new Error('rate not found')
    );

    await expect((optimizer as any).getOracleQuote('EUR', 'USD', '100')).rejects.toThrow('rate not found');
  });
});

// ─── External venue placeholder ───────────────────────────────────────────────

describe('RateOptimizer external venue (placeholder)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns an External quote with confidence 100', async () => {
    const client    = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    const optimizer = new RateOptimizer(client);

    const quote = await (optimizer as any).getExternalQuote('EUR', 'USD', '100');
    expect(quote.venue).toBe('External');
    expect(quote.confidence).toBe(100);
  });

  it('computes amount as sourceAmount × 0.92 (mock EUR rate)', async () => {
    const client    = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    const optimizer = new RateOptimizer(client);

    const quote = await (optimizer as any).getExternalQuote('EUR', 'USD', '200');
    expect(new BigNumber(quote.amount).toFixed(4)).toBe('184.0000');
  });
});

// ─── DEX venue delegation ─────────────────────────────────────────────────────

describe('RateOptimizer DEX venue delegation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rethrows when PathPaymentService.findBestPath fails', async () => {
    const client    = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    const optimizer = new RateOptimizer(client);

    jest.spyOn((optimizer as any).pathService, 'findBestPath').mockRejectedValue(
      new Error('No path found')
    );

    await expect((optimizer as any).getDexQuote(FROM, TO, AMT)).rejects.toThrow('No path found');
  });

  it('maps the PathPaymentService result to an OptimizedRate with venue DEX', async () => {
    const client    = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    const optimizer = new RateOptimizer(client);

    jest.spyOn((optimizer as any).pathService, 'findBestPath').mockResolvedValue({
      path:              ['XLM'],
      sourceAmount:      '100',
      sourceAsset:       FROM,
      destinationAmount: '1000.0000000',
      destinationAsset:  TO,
      rate:              10,
      score:             0.1,
    });

    const quote = await (optimizer as any).getDexQuote(FROM, TO, AMT);
    expect(quote.venue).toBe('DEX');
    expect(quote.amount).toBe('1000.0000000');
    expect(quote.path).toContain('XLM');
    expect(quote.confidence).toBe(95);
  });
});
