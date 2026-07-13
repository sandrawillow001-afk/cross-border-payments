import { isValidStellarAddress } from '@stellar-cross-border/sdk';

export { isValidStellarAddress };

export const SUPPORTED_TOKENS = ['XLM', 'USDC', 'EURC', 'yXLM'] as const;
export type SupportedToken = typeof SUPPORTED_TOKENS[number];

/** Sentinel value used in the token <select> to indicate the user wants a custom asset. */
export const CUSTOM_ASSET_VALUE = '__custom__' as const;

/**
 * Constraints on a custom Stellar asset entered by the user.
 *
 * - assetCode: 1–12 alphanumeric uppercase characters (Stellar spec).
 * - assetIssuer: a valid G... Stellar account address (56 chars, base32).
 */
export interface CustomAsset {
  assetCode:   string;
  assetIssuer: string;
}

/** Returns true when the selected token is the custom-asset sentinel. */
export function isCustomAsset(token: string): token is typeof CUSTOM_ASSET_VALUE {
  return token === CUSTOM_ASSET_VALUE;
}

/**
 * Builds the canonical asset identifier used by the SDK and contracts.
 *
 * - Native XLM  →  'native'
 * - Known token →  issuer contract address (as stored in commonTokens)
 * - Custom asset →  'CODE:GISSUER...'
 */
export function resolveTokenValue(token: string, custom?: Partial<CustomAsset>): string {
  if (isCustomAsset(token)) {
    if (!custom?.assetCode || !custom?.assetIssuer) return '';
    return `${custom.assetCode.toUpperCase().trim()}:${custom.assetIssuer.trim()}`;
  }
  return token;
}

export interface PaymentFormValues {
  sender:      string;
  receiver:    string;
  amount:      string;
  /** Either a whitelisted contract address / 'native', or the CUSTOM_ASSET_VALUE sentinel. */
  token:       string;
  releaseTime: number | string; // unix seconds or empty
  /** Populated only when token === CUSTOM_ASSET_VALUE */
  customAssetCode?:   string;
  customAssetIssuer?: string;
}

export interface FormErrors {
  sender?:           string;
  receiver?:         string;
  amount?:           string;
  token?:            string;
  customAssetCode?:  string;
  customAssetIssuer?: string;
  releaseTime?:      string;
}

// Stellar asset code: 1–12 uppercase alphanumeric characters
const ASSET_CODE_RE = /^[A-Z0-9]{1,12}$/;

const MAX_RELEASE_TIME_DAYS = 365 * 5; // 5 years

export function validatePaymentForm(values: PaymentFormValues): FormErrors {
  const errors: FormErrors = {};

  // ── Address validation ──────────────────────────────────────────────────────
  if (!values.sender)
    errors.sender = 'Sender address is required.';
  else if (!isValidStellarAddress(values.sender))
    errors.sender = 'Enter a valid Stellar address.';

  if (!values.receiver)
    errors.receiver = 'Receiver address is required.';
  else if (!isValidStellarAddress(values.receiver))
    errors.receiver = 'Enter a valid Stellar address.';
  else if (values.receiver === values.sender)
    errors.receiver = 'Receiver must differ from sender.';

  // ── Amount validation ───────────────────────────────────────────────────────
  const amt = parseFloat(values.amount);
  if (!values.amount)
    errors.amount = 'Amount is required.';
  else if (isNaN(amt))
    errors.amount = 'Amount must be a number.';
  else if (amt <= 0)
    errors.amount = 'Amount must be greater than zero.';
  else if (!/^\d+(\.\d{1,7})?$/.test(values.amount))
    errors.amount = 'Maximum 7 decimal places (stroop precision).';

  // ── Token / custom asset validation ────────────────────────────────────────
  if (!values.token) {
    errors.token = 'Please select a token.';
  } else if (!(SUPPORTED_TOKENS as readonly string[]).includes(values.token)) {
    errors.token = `Unsupported token. Choose one of: ${SUPPORTED_TOKENS.join(', ')}.`;
  }

  // ── Release time validation ─────────────────────────────────────────────────
  if (values.releaseTime !== '' && values.releaseTime !== undefined) {
    const rt  = Number(values.releaseTime);
    const now = Math.floor(Date.now() / 1000);
    const max = now + MAX_RELEASE_TIME_DAYS * 24 * 60 * 60;

    if (isNaN(rt) || rt <= 0)
      errors.releaseTime = 'Release time must be a positive number.';
    else if (rt <= now)
      errors.releaseTime = 'Release time must be in the future.';
    else if (rt > max)
      errors.releaseTime = `Release time cannot exceed ${MAX_RELEASE_TIME_DAYS / 365} years from now.`;
  }

  return errors;
}

export function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0;
}