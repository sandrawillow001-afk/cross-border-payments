import * as fs from 'fs';
import { PaymentRecord } from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single entry that failed validation — carries its 1-based index and errors. */
export interface JSONEntryError {
  /**
   * 1-based position in the payments array (entry 1 = first payment object).
   */
  index: number;
  errors: string[];
}

/** Result returned by parseJSON. */
export interface JSONParseResult {
  /** Entries that passed all validation checks, ready for batch submission. */
  records: PaymentRecord[];
  /** Entries that failed validation, each with their index and error messages. */
  errors: JSONEntryError[];
}

// ---------------------------------------------------------------------------
// Accepted raw shape of a single payment entry in the JSON input
// ---------------------------------------------------------------------------

interface RawPaymentEntry {
  destination?: unknown;
  amount?: unknown;
  asset?: unknown;
  asset_issuer?: unknown;
  memo?: unknown;
  escrow_duration?: unknown;
  // Allow unknown extra keys without TypeScript errors
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a JSON payment file into a validated set of PaymentRecords.
 *
 * ### Accepted top-level shapes
 * - Array of payment objects: `[{ destination, amount, ... }, ...]`
 * - Wrapper object with a `payments` key: `{ "payments": [...] }`
 *
 * ### Validation
 * Every entry is validated before being included in `records`.  Entries that
 * fail validation are collected in `errors` with their 1-based index and a
 * list of human-readable error messages.
 *
 * ### Required fields
 * `destination` and `amount` are required and must be non-empty.
 *
 * ### Field normalisation
 * - `amount`: accepted as a string or number; normalised to a trimmed string.
 * - `asset`: trimmed and upper-cased; defaults to `"XLM"` when absent.
 * - `asset_issuer`, `memo`: trimmed strings, default to `""`.
 * - `escrow_duration`: must be a non-negative integer; defaults to `0` when absent.
 *
 * @param filePath  Absolute or relative path to the JSON file.
 * @returns         `{ records, errors }` — valid records and per-entry errors.
 * @throws          If the file cannot be read, the content is not valid JSON,
 *                  or the top-level value is not an array or a `{ payments }` object.
 */
export function parseJSON(filePath: string): JSONParseResult {
  const content = fs.readFileSync(filePath, 'utf-8');

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    throw new SyntaxError(
      `Invalid JSON in file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const rawEntries = extractEntries(data, filePath);

  const records: PaymentRecord[] = [];
  const errors: JSONEntryError[] = [];

  for (let i = 0; i < rawEntries.length; i++) {
    const index = i + 1; // 1-based
    const entry = rawEntries[i];

    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({
        index,
        errors: [`Entry ${index}: expected a JSON object, got ${Array.isArray(entry) ? 'array' : String(entry)}`],
      });
      continue;
    }

    const raw = entry as RawPaymentEntry;
    const entryErrors = validateEntry(raw, index);

    if (entryErrors.length > 0) {
      errors.push({ index, errors: entryErrors });
      continue;
    }

    records.push(buildRecord(raw));
  }

  return { records, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the flat array of raw payment entries from the parsed JSON value.
 * Accepts both a top-level array and a `{ payments: [...] }` wrapper.
 * Throws with a clear message for any other shape.
 */
function extractEntries(data: unknown, filePath: string): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if ('payments' in obj) {
      if (!Array.isArray(obj.payments)) {
        throw new TypeError(
          `Invalid JSON in file "${filePath}": "payments" key must be an array, ` +
            `got ${typeof obj.payments}`,
        );
      }
      return obj.payments as unknown[];
    }
  }

  throw new TypeError(
    `Invalid JSON in file "${filePath}": expected a top-level array or an object ` +
      `with a "payments" key, got ${Array.isArray(data) ? 'array' : typeof data}`,
  );
}

/**
 * Validate a single raw payment entry object.
 * Returns an array of human-readable error strings; empty means valid.
 */
function validateEntry(entry: RawPaymentEntry, index: number): string[] {
  const errs: string[] = [];

  // --- destination (required, non-empty string) ---
  const destination = trimStr(entry.destination);
  if (destination === undefined) {
    errs.push(`Entry ${index}: missing required field "destination"`);
  } else if (destination.length === 0) {
    errs.push(`Entry ${index}: "destination" must not be empty`);
  } else if (typeof entry.destination !== 'string') {
    errs.push(`Entry ${index}: "destination" must be a string, got ${typeof entry.destination}`);
  }

  // --- amount (required, positive number) ---
  const rawAmount = entry.amount;
  if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
    errs.push(`Entry ${index}: missing required field "amount"`);
  } else {
    const amountStr = trimStr(rawAmount);
    const num = Number(amountStr);
    if (amountStr === undefined || isNaN(num)) {
      errs.push(`Entry ${index}: "amount" is not a valid number (got ${JSON.stringify(rawAmount)})`);
    } else if (num <= 0) {
      errs.push(`Entry ${index}: "amount" must be greater than zero (got ${num})`);
    }
  }

  // --- asset (optional, must be a non-empty string if present) ---
  if (entry.asset !== undefined && entry.asset !== null && entry.asset !== '') {
    if (typeof entry.asset !== 'string') {
      errs.push(`Entry ${index}: "asset" must be a string, got ${typeof entry.asset}`);
    } else if (entry.asset.trim().length === 0) {
      errs.push(`Entry ${index}: "asset" must not be blank`);
    }
  }

  // --- asset_issuer (optional, must be a string if present) ---
  if (entry.asset_issuer !== undefined && entry.asset_issuer !== null && entry.asset_issuer !== '') {
    if (typeof entry.asset_issuer !== 'string') {
      errs.push(`Entry ${index}: "asset_issuer" must be a string, got ${typeof entry.asset_issuer}`);
    }
  }

  // --- memo (optional, must be a string if present) ---
  if (entry.memo !== undefined && entry.memo !== null && entry.memo !== '') {
    if (typeof entry.memo !== 'string') {
      errs.push(`Entry ${index}: "memo" must be a string, got ${typeof entry.memo}`);
    }
  }

  // --- escrow_duration (optional, must be a non-negative integer if present) ---
  if (entry.escrow_duration !== undefined && entry.escrow_duration !== null) {
    const n = Number(entry.escrow_duration);
    if (isNaN(n)) {
      errs.push(
        `Entry ${index}: "escrow_duration" is not a valid number ` +
          `(got ${JSON.stringify(entry.escrow_duration)}) — use 0 to disable escrow`,
      );
    } else if (!Number.isInteger(n) || n < 0) {
      errs.push(
        `Entry ${index}: "escrow_duration" must be a non-negative integer (got ${n})`,
      );
    }
  }

  return errs;
}

/** Build a normalised PaymentRecord from a validated entry. */
function buildRecord(entry: RawPaymentEntry): PaymentRecord {
  const assetRaw = trimStr(entry.asset);
  const asset = assetRaw ? assetRaw.toUpperCase() : 'XLM';

  return {
    destination: (trimStr(entry.destination) ?? '').trim(),
    amount: String(trimStr(entry.amount) ?? '0').trim(),
    asset,
    asset_issuer: trimStr(entry.asset_issuer) ?? '',
    memo: trimStr(entry.memo) ?? '',
    escrow_duration: parseEscrowDuration(entry.escrow_duration),
  };
}

/** Safely coerce a value to a trimmed string; returns undefined for null/undefined/empty. */
function trimStr(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

function parseEscrowDuration(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
