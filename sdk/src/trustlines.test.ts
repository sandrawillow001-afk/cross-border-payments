/**
 * trustlines.test.ts
 *
 * Unit tests for TrustlineService covering:
 *   - hasTrustline   — query logic, native XLM short-circuit, 404 handling
 *   - getTrustlines  — full account trustline listing
 *   - getTrustline   — single-asset lookup and null returns
 *   - buildChangeTrustOp — pure operation builder (no network)
 *   - removeTrustline    — CHANGE_TRUST with limit "0"
 *   - ensureTrustline    — skips existing, builds op for missing
 *   - ensureTrustlines   — batch parallel checks
 *   - buildTrustlineTransaction — full builder integration
 */

import { Asset, Operation, Account, Networks, Keypair } from 'stellar-sdk';
import { TrustlineService, TrustlineInfo, MAX_TRUST_LIMIT } from './trustlines';
import { StellarClient } from './client';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TEST_CONFIG = {
  horizonUrl:         'https://horizon-testnet.stellar.org',
  sorobanRpcUrl:      'https://soroban-testnet.stellar.org',
  networkPassphrase:  Networks.TESTNET,
};

const TEST_CONTRACTS = {
  escrow:     'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  rateOracle: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  compliance: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const EURC_ISSUER = 'GCXGJYVHP53MTHYDS3DD3AEW2ML5ADONLGRWCS4XTVA5ZPOH2TKIYUO5';
const MXN_ISSUER  = 'GBZRMGST652BZPFUABHSVGRJOJRQP46ZB6GJ7D7FS37BZLZ6PJ5KYRBG';

const USDC = new Asset('USDC', USDC_ISSUER);
const EURC = new Asset('EURC', EURC_ISSUER);
const MXN  = new Asset('MXN',  MXN_ISSUER);
const XLM  = Asset.native();

const ACCOUNT_ID = Keypair.random().publicKey();

// ─── Raw Horizon balance fixtures ─────────────────────────────────────────────

function makeBalance(
  code: string,
  issuer: string,
  balance = '100.0000000',
  limit = MAX_TRUST_LIMIT,
  authorized = true
) {
  return {
    asset_type:    code === 'native' ? 'native' : 'credit_alphanum4',
    asset_code:    code,
    asset_issuer:  issuer,
    balance,
    limit,
    is_authorized: authorized,
  };
}

const NATIVE_BALANCE = {
  asset_type: 'native',
  balance:    '10.0000000',
};

// ─── Client factory ───────────────────────────────────────────────────────────

/**
 * Builds a StellarClient and mocks getHorizon().loadAccount to return the
 * supplied balance records. Also mocks getAccount for sequence lookups.
 */
function makeClient(
  balances: any[],
  sequence = '100'
): StellarClient {
  const client = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);

  jest.spyOn(client, 'getHorizon').mockReturnValue({
    loadAccount: jest.fn().mockResolvedValue({ balances }),
  } as any);

  jest.spyOn(client, 'getAccount').mockResolvedValue({
    accountId:    ACCOUNT_ID,
    balance:      '10.0000000',
    sequence,
    numSubentries: 0,
    flags: { authRequired: false, authRevocable: false, authImmutable: false },
  });

  return client;
}

/** Returns a client whose loadAccount rejects with a Horizon-style 404. */
function makeNotFoundClient(): StellarClient {
  const client = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
  const err: any = new Error('Not Found');
  err.response = { status: 404 };

  jest.spyOn(client, 'getHorizon').mockReturnValue({
    loadAccount: jest.fn().mockRejectedValue(err),
  } as any);

  return client;
}

// ─── hasTrustline ─────────────────────────────────────────────────────────────

describe('TrustlineService.hasTrustline', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns true for native XLM without making a network call', async () => {
    const client  = makeClient([]);
    const service = new TrustlineService(client);

    const result = await service.hasTrustline(ACCOUNT_ID, XLM);

    expect(result).toBe(true);
    expect(client.getHorizon).not.toHaveBeenCalled();
  });

  it('returns true when the account has a matching trustline', async () => {
    const client  = makeClient([makeBalance('USDC', USDC_ISSUER)]);
    const service = new TrustlineService(client);

    expect(await service.hasTrustline(ACCOUNT_ID, USDC)).toBe(true);
  });

  it('returns false when the account has no matching trustline', async () => {
    const client  = makeClient([makeBalance('EURC', EURC_ISSUER)]);
    const service = new TrustlineService(client);

    expect(await service.hasTrustline(ACCOUNT_ID, USDC)).toBe(false);
  });

  it('returns false for an empty balance list', async () => {
    const client  = makeClient([NATIVE_BALANCE]);
    const service = new TrustlineService(client);

    expect(await service.hasTrustline(ACCOUNT_ID, USDC)).toBe(false);
  });

  it('returns false (not throws) when the account does not exist (404)', async () => {
    const service = new TrustlineService(makeNotFoundClient());

    await expect(service.hasTrustline(ACCOUNT_ID, USDC)).resolves.toBe(false);
  });

  it('returns true when the account holds multiple trustlines and one matches', async () => {
    const client = makeClient([
      makeBalance('EURC', EURC_ISSUER),
      makeBalance('USDC', USDC_ISSUER),
      makeBalance('MXN',  MXN_ISSUER),
    ]);
    const service = new TrustlineService(client);

    expect(await service.hasTrustline(ACCOUNT_ID, USDC)).toBe(true);
  });
});

// ─── getTrustlines ────────────────────────────────────────────────────────────

describe('TrustlineService.getTrustlines', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns an empty array when the account has only native XLM', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const lines = await service.getTrustlines(ACCOUNT_ID);
    expect(lines).toHaveLength(0);
  });

  it('returns one TrustlineInfo for each non-native balance', async () => {
    const client = makeClient([
      NATIVE_BALANCE,
      makeBalance('USDC', USDC_ISSUER, '250.0000000', MAX_TRUST_LIMIT, true),
      makeBalance('EURC', EURC_ISSUER, '50.0000000',  '1000.0000000',  false),
    ]);
    const service = new TrustlineService(client);

    const lines = await service.getTrustlines(ACCOUNT_ID);
    expect(lines).toHaveLength(2);
  });

  it('maps assetCode and assetIssuer correctly', async () => {
    const service = new TrustlineService(
      makeClient([makeBalance('USDC', USDC_ISSUER)])
    );

    const lines = await service.getTrustlines(ACCOUNT_ID);
    expect(lines[0].assetCode).toBe('USDC');
    expect(lines[0].assetIssuer).toBe(USDC_ISSUER);
  });

  it('maps balance, limit, and authorized fields correctly', async () => {
    const service = new TrustlineService(
      makeClient([makeBalance('USDC', USDC_ISSUER, '42.0000000', '500.0000000', false)])
    );

    const [line] = await service.getTrustlines(ACCOUNT_ID);
    expect(line.balance).toBe('42.0000000');
    expect(line.limit).toBe('500.0000000');
    expect(line.authorized).toBe(false);
  });

  it('throws a descriptive error when Horizon returns an unexpected error', async () => {
    const client = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    jest.spyOn(client, 'getHorizon').mockReturnValue({
      loadAccount: jest.fn().mockRejectedValue(new Error('Horizon 503')),
    } as any);
    const service = new TrustlineService(client);

    await expect(service.getTrustlines(ACCOUNT_ID)).rejects.toThrow(/Failed to fetch trustlines/);
  });

  it('error message includes the account id', async () => {
    const client = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    jest.spyOn(client, 'getHorizon').mockReturnValue({
      loadAccount: jest.fn().mockRejectedValue(new Error('timeout')),
    } as any);
    const service = new TrustlineService(client);

    await expect(service.getTrustlines(ACCOUNT_ID)).rejects.toThrow(ACCOUNT_ID);
  });
});

// ─── getTrustline ─────────────────────────────────────────────────────────────

describe('TrustlineService.getTrustline', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null for native XLM immediately', async () => {
    const service = new TrustlineService(makeClient([]));

    const result = await service.getTrustline(ACCOUNT_ID, XLM);
    expect(result).toBeNull();
  });

  it('returns the matching TrustlineInfo when the trustline exists', async () => {
    const service = new TrustlineService(
      makeClient([makeBalance('USDC', USDC_ISSUER, '100.0000000', MAX_TRUST_LIMIT, true)])
    );

    const info = await service.getTrustline(ACCOUNT_ID, USDC);
    expect(info).not.toBeNull();
    expect(info!.assetCode).toBe('USDC');
    expect(info!.balance).toBe('100.0000000');
  });

  it('returns null when no matching trustline exists', async () => {
    const service = new TrustlineService(
      makeClient([makeBalance('EURC', EURC_ISSUER)])
    );

    const result = await service.getTrustline(ACCOUNT_ID, USDC);
    expect(result).toBeNull();
  });

  it('returns null (not throws) for a 404 unknown account', async () => {
    const service = new TrustlineService(makeNotFoundClient());

    await expect(service.getTrustline(ACCOUNT_ID, USDC)).resolves.toBeNull();
  });

  it('throws a descriptive error for unexpected network failures', async () => {
    const client = new StellarClient(TEST_CONFIG, TEST_CONTRACTS);
    const err: any = new Error('Internal server error');
    err.response = { status: 500 };
    jest.spyOn(client, 'getHorizon').mockReturnValue({
      loadAccount: jest.fn().mockRejectedValue(err),
    } as any);
    const service = new TrustlineService(client);

    await expect(service.getTrustline(ACCOUNT_ID, USDC)).rejects.toThrow(
      /Failed to get trustline/
    );
  });

  it('does not confuse assets with the same code but different issuers', async () => {
    const OTHER_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    const service = new TrustlineService(
      makeClient([makeBalance('USDC', OTHER_ISSUER)])
    );

    const result = await service.getTrustline(ACCOUNT_ID, USDC);
    expect(result).toBeNull();
  });
});

// ─── buildChangeTrustOp ───────────────────────────────────────────────────────

describe('TrustlineService.buildChangeTrustOp', () => {
  const service = new TrustlineService(
    new StellarClient(TEST_CONFIG, TEST_CONTRACTS)
  );

  it('returns a changeTrust operation', () => {
    const op = service.buildChangeTrustOp(USDC);
    const decoded = Operation.fromXDRObject(op as any);
    expect(decoded.type).toBe('changeTrust');
  });

  it('sets the asset on the operation correctly', () => {
    const op = service.buildChangeTrustOp(USDC);
    const decoded = Operation.fromXDRObject(op as any) as any;
    expect(decoded.line.getCode()).toBe('USDC');
    expect(decoded.line.getIssuer()).toBe(USDC_ISSUER);
  });

  it('defaults limit to MAX_TRUST_LIMIT when not supplied', () => {
    const op = service.buildChangeTrustOp(USDC);
    const decoded = Operation.fromXDRObject(op as any) as any;
    expect(decoded.limit).toBe(MAX_TRUST_LIMIT);
  });

  it('uses the supplied limit when provided', () => {
    const op = service.buildChangeTrustOp(USDC, '1000.0000000');
    const decoded = Operation.fromXDRObject(op as any) as any;
    expect(decoded.limit).toBe('1000.0000000');
  });

  it('makes no network calls', () => {
    const client = makeClient([]);
    const svc    = new TrustlineService(client);
    svc.buildChangeTrustOp(USDC);
    expect(client.getHorizon).not.toHaveBeenCalled();
  });
});

// ─── removeTrustline ─────────────────────────────────────────────────────────

describe('TrustlineService.removeTrustline', () => {
  const service = new TrustlineService(
    new StellarClient(TEST_CONFIG, TEST_CONTRACTS)
  );

  it('returns a changeTrust operation', () => {
    const op = service.removeTrustline(USDC);
    const decoded = Operation.fromXDRObject(op as any);
    expect(decoded.type).toBe('changeTrust');
  });

  it('sets limit to "0" to signal trustline removal', () => {
    const op = service.removeTrustline(USDC);
    const decoded = Operation.fromXDRObject(op as any) as any;
    // stellar-sdk normalises the limit to 7-decimal format on XDR round-trip
    expect(parseFloat(decoded.limit)).toBe(0);
  });

  it('encodes the correct asset on the removal operation', () => {
    const op = service.removeTrustline(MXN);
    const decoded = Operation.fromXDRObject(op as any) as any;
    expect(decoded.line.getCode()).toBe('MXN');
    expect(decoded.line.getIssuer()).toBe(MXN_ISSUER);
  });
});

// ─── ensureTrustline ─────────────────────────────────────────────────────────

describe('TrustlineService.ensureTrustline', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null for native XLM without any network calls', async () => {
    const client  = makeClient([]);
    const service = new TrustlineService(client);

    const op = await service.ensureTrustline(ACCOUNT_ID, XLM);

    expect(op).toBeNull();
    expect(client.getHorizon).not.toHaveBeenCalled();
  });

  it('returns null when the trustline already exists', async () => {
    const service = new TrustlineService(
      makeClient([makeBalance('USDC', USDC_ISSUER)])
    );

    const op = await service.ensureTrustline(ACCOUNT_ID, USDC);
    expect(op).toBeNull();
  });

  it('returns a CHANGE_TRUST operation when the trustline is missing', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const op = await service.ensureTrustline(ACCOUNT_ID, USDC);
    expect(op).not.toBeNull();

    const decoded = Operation.fromXDRObject(op! as any);
    expect(decoded.type).toBe('changeTrust');
  });

  it('applies the default MAX_TRUST_LIMIT on the returned operation', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const op = await service.ensureTrustline(ACCOUNT_ID, USDC);
    const decoded = Operation.fromXDRObject(op! as any) as any;
    expect(decoded.limit).toBe(MAX_TRUST_LIMIT);
  });

  it('applies a custom limit when provided', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const op = await service.ensureTrustline(ACCOUNT_ID, USDC, '500.0000000');
    const decoded = Operation.fromXDRObject(op! as any) as any;
    expect(decoded.limit).toBe('500.0000000');
  });

  it('returns an op for a 404 unknown account (treats as no trustline)', async () => {
    const service = new TrustlineService(makeNotFoundClient());

    const op = await service.ensureTrustline(ACCOUNT_ID, USDC);
    expect(op).not.toBeNull();
  });
});

// ─── ensureTrustlines ────────────────────────────────────────────────────────

describe('TrustlineService.ensureTrustlines', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns an empty array when all trustlines already exist', async () => {
    const service = new TrustlineService(
      makeClient([
        makeBalance('USDC', USDC_ISSUER),
        makeBalance('EURC', EURC_ISSUER),
      ])
    );

    const ops = await service.ensureTrustlines(ACCOUNT_ID, [USDC, EURC]);
    expect(ops).toHaveLength(0);
  });

  it('returns one op per missing trustline', async () => {
    // Only USDC exists; EURC and MXN are missing
    const service = new TrustlineService(
      makeClient([makeBalance('USDC', USDC_ISSUER)])
    );

    const ops = await service.ensureTrustlines(ACCOUNT_ID, [USDC, EURC, MXN]);
    expect(ops).toHaveLength(2);
  });

  it('returns ops for all assets when none are trusted', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const ops = await service.ensureTrustlines(ACCOUNT_ID, [USDC, EURC, MXN]);
    expect(ops).toHaveLength(3);
  });

  it('filters out native XLM from the operation list', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const ops = await service.ensureTrustlines(ACCOUNT_ID, [XLM, USDC]);
    // Only USDC needs a trustline; XLM is skipped
    expect(ops).toHaveLength(1);
  });

  it('returns an empty array for an empty asset list', async () => {
    const service = new TrustlineService(makeClient([]));

    const ops = await service.ensureTrustlines(ACCOUNT_ID, []);
    expect(ops).toHaveLength(0);
  });

  it('applies a shared custom limit to all returned operations', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const ops = await service.ensureTrustlines(ACCOUNT_ID, [USDC, EURC], '1000.0000000');
    for (const op of ops) {
      const decoded = Operation.fromXDRObject(op as any) as any;
      expect(decoded.limit).toBe('1000.0000000');
    }
  });

  it('all returned operations are of type changeTrust', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const ops = await service.ensureTrustlines(ACCOUNT_ID, [USDC, EURC]);
    for (const op of ops) {
      const decoded = Operation.fromXDRObject(op as any);
      expect(decoded.type).toBe('changeTrust');
    }
  });
});

// ─── buildTrustlineTransaction ───────────────────────────────────────────────

describe('TrustlineService.buildTrustlineTransaction', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null when all trustlines already exist', async () => {
    const service = new TrustlineService(
      makeClient([makeBalance('USDC', USDC_ISSUER)])
    );

    const builder = await service.buildTrustlineTransaction(ACCOUNT_ID, [USDC]);
    expect(builder).toBeNull();
  });

  it('returns a TransactionBuilder when at least one trustline is missing', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const builder = await service.buildTrustlineTransaction(ACCOUNT_ID, [USDC]);
    expect(builder).not.toBeNull();
  });

  it('the built transaction can be serialised to XDR without throwing', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const builder = await service.buildTrustlineTransaction(ACCOUNT_ID, [USDC]);
    expect(() => builder!.build().toXDR()).not.toThrow();
  });

  it('includes one operation per missing trustline in the transaction', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const builder = await service.buildTrustlineTransaction(ACCOUNT_ID, [USDC, EURC]);
    const tx = builder!.build();
    expect(tx.operations).toHaveLength(2);
  });

  it('passes a memo through to the transaction when provided', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const builder = await service.buildTrustlineTransaction(
      ACCOUNT_ID,
      [USDC],
      { memo: 'setup trustlines' }
    );
    const tx = builder!.build();
    expect((tx.memo as any).value).toBe('setup trustlines');
  });

  it('passes a custom fee to the transaction builder when provided', async () => {
    const service = new TrustlineService(makeClient([NATIVE_BALANCE]));

    const builder = await service.buildTrustlineTransaction(
      ACCOUNT_ID,
      [USDC],
      { fee: '500' }
    );
    expect(builder!.baseFee).toBe('500');
  });
});
