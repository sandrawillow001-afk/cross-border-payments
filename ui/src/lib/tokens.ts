/**
 * Token configuration and metadata utilities for the Stellar cross-border payments UI.
 *
 * Provides a default token list, types for custom token entries, and an async
 * helper that can optionally enrich token metadata (symbol, name, contract
 * address) from an external source.
 */

export interface TokenEntry {
  /** Display ticker, e.g. "USDC" */
  symbol: string;
  /** Human-readable name, e.g. "USD Coin" */
  name: string;
  /**
   * Soroban contract address or the string "native" for XLM.
   * Used as the value submitted in the payment request.
   */
  contract: string;
  /** Optional logo URL for display */
  logoUrl?: string;
  /** Optional current price in USD (populated dynamically when available) */
  priceUsd?: number;
}

// ---------------------------------------------------------------------------
// Default token set
// ---------------------------------------------------------------------------

export const DEFAULT_TOKENS: TokenEntry[] = [
  {
    symbol: 'XLM',
    name: 'Stellar Lumens',
    contract: 'native',
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    contract: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFLBKYXRH7CL5BJM4A3',
  },
  {
    symbol: 'EURC',
    name: 'Euro Coin',
    contract: 'GDZQJFSYNKSWDYM7KKEGZUPXNBNLAO5FQMJGFJFD7ZMPGA2U6WMR5VY',
  },
];

// ---------------------------------------------------------------------------
// Dynamic metadata fetching
// ---------------------------------------------------------------------------

export interface TokenMetadataSource {
  /**
   * Fetch metadata for a list of contract addresses.
   * Implementations may call Horizon, a custom API, or an on-chain oracle.
   * Returns a map of contractAddress → partial TokenEntry.
   */
  fetchMetadata(contracts: string[]): Promise<Record<string, Partial<TokenEntry>>>;
}

/**
 * Merge a base token list with freshly fetched metadata.
 * Fields returned by the source override the base values; missing fields are
 * kept from the base list.
 */
export function mergeTokenMetadata(
  base: TokenEntry[],
  metadata: Record<string, Partial<TokenEntry>>
): TokenEntry[] {
  return base.map((token) => {
    const patch = metadata[token.contract];
    return patch ? { ...token, ...patch } : token;
  });
}

/**
 * Enrich a token list by calling an optional metadata source.
 *
 * @param tokens   - Base list to enrich (defaults to DEFAULT_TOKENS).
 * @param source   - Optional external source; if omitted the base list is returned as-is.
 * @returns        Enriched token list.
 */
export async function fetchTokenList(
  tokens: TokenEntry[] = DEFAULT_TOKENS,
  source?: TokenMetadataSource
): Promise<TokenEntry[]> {
  if (!source) {
    return tokens;
  }

  const contracts = tokens
    .map((t) => t.contract)
    .filter((c) => c !== 'native');

  try {
    const metadata = await source.fetchMetadata(contracts);
    return mergeTokenMetadata(tokens, metadata);
  } catch {
    // Never throw — fall back to the base list so the UI stays functional.
    return tokens;
  }
}
