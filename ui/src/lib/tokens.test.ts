/**
 * Tests for the token list utilities (requirement a).
 */
import {
  DEFAULT_TOKENS,
  fetchTokenList,
  mergeTokenMetadata,
  TokenEntry,
  TokenMetadataSource,
} from './tokens';

// ---------------------------------------------------------------------------
// mergeTokenMetadata
// ---------------------------------------------------------------------------

describe('mergeTokenMetadata', () => {
  it('returns the base list unchanged when the metadata map is empty', () => {
    const result = mergeTokenMetadata(DEFAULT_TOKENS, {});
    expect(result).toEqual(DEFAULT_TOKENS);
  });

  it('patches matching entries with fetched metadata', () => {
    const usdcContract = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFLBKYXRH7CL5BJM4A3';
    const patch = { priceUsd: 1.0, name: 'USD Coin (updated)' };

    const result = mergeTokenMetadata(DEFAULT_TOKENS, { [usdcContract]: patch });

    const usdc = result.find((t) => t.symbol === 'USDC');
    expect(usdc?.priceUsd).toBe(1.0);
    expect(usdc?.name).toBe('USD Coin (updated)');
  });

  it('leaves non-matching tokens untouched', () => {
    const usdcContract = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFLBKYXRH7CL5BJM4A3';
    const result = mergeTokenMetadata(DEFAULT_TOKENS, {
      [usdcContract]: { priceUsd: 0.99 },
    });

    const xlm = result.find((t) => t.symbol === 'XLM');
    expect(xlm?.priceUsd).toBeUndefined();
  });

  it('does not mutate the original token objects', () => {
    const original = JSON.parse(JSON.stringify(DEFAULT_TOKENS)) as TokenEntry[];
    const usdcContract = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFLBKYXRH7CL5BJM4A3';

    mergeTokenMetadata(DEFAULT_TOKENS, { [usdcContract]: { priceUsd: 5 } });

    expect(DEFAULT_TOKENS).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// fetchTokenList
// ---------------------------------------------------------------------------

describe('fetchTokenList', () => {
  it('returns the default list when no source is supplied', async () => {
    const result = await fetchTokenList();
    expect(result).toEqual(DEFAULT_TOKENS);
  });

  it('returns the custom base list unchanged when no source is supplied', async () => {
    const custom: TokenEntry[] = [
      { symbol: 'FOO', name: 'Foo Token', contract: 'CFOO' },
    ];
    const result = await fetchTokenList(custom);
    expect(result).toEqual(custom);
  });

  it('enriches tokens via the metadata source', async () => {
    const usdcContract = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFLBKYXRH7CL5BJM4A3';

    const source: TokenMetadataSource = {
      fetchMetadata: jest.fn().mockResolvedValue({
        [usdcContract]: { priceUsd: 1.001, name: 'USD Coin Live' },
      }),
    };

    const result = await fetchTokenList(DEFAULT_TOKENS, source);

    expect(source.fetchMetadata).toHaveBeenCalledWith(
      expect.arrayContaining([usdcContract])
    );

    const usdc = result.find((t) => t.symbol === 'USDC');
    expect(usdc?.priceUsd).toBe(1.001);
    expect(usdc?.name).toBe('USD Coin Live');
  });

  it('does NOT include the "native" contract when calling fetchMetadata', async () => {
    const source: TokenMetadataSource = {
      fetchMetadata: jest.fn().mockResolvedValue({}),
    };

    await fetchTokenList(DEFAULT_TOKENS, source);

    const calledWith = (source.fetchMetadata as jest.Mock).mock.calls[0][0] as string[];
    expect(calledWith).not.toContain('native');
  });

  it('falls back to the base list when the source throws', async () => {
    const source: TokenMetadataSource = {
      fetchMetadata: jest.fn().mockRejectedValue(new Error('Network error')),
    };

    const result = await fetchTokenList(DEFAULT_TOKENS, source);
    expect(result).toEqual(DEFAULT_TOKENS);
  });

  it('contains at least XLM, USDC, and EURC in the default list', async () => {
    const symbols = DEFAULT_TOKENS.map((t) => t.symbol);
    expect(symbols).toContain('XLM');
    expect(symbols).toContain('USDC');
    expect(symbols).toContain('EURC');
  });
});
