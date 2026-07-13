import * as XLSX from 'xlsx';
import { PaymentRecord } from '../types';

// ---------------------------------------------------------------------------
// Column header normalisation
// ---------------------------------------------------------------------------

/**
 * Maps every accepted spelling/casing variant for a column to its canonical
 * internal key.  The normalisation step converts each raw header to lowercase
 * and strips leading/trailing whitespace before looking it up here, so the
 * mapping only needs lowercase keys.
 *
 * Canonical keys match the PaymentRecord field names so the rest of the parser
 * can use them directly.
 */
const HEADER_ALIASES: Record<string, string> = {
  // destination
  destination: 'destination',
  dest: 'destination',
  recipient: 'destination',
  'recipient address': 'destination',
  'wallet address': 'destination',
  address: 'destination',
  'stellar address': 'destination',
  // amount
  amount: 'amount',
  amt: 'amount',
  value: 'amount',
  'payment amount': 'amount',
  // asset
  asset: 'asset',
  currency: 'asset',
  token: 'asset',
  'asset code': 'asset',
  coin: 'asset',
  // asset_issuer
  asset_issuer: 'asset_issuer',
  'asset issuer': 'asset_issuer',
  issuer: 'asset_issuer',
  'issuer address': 'asset_issuer',
  // memo
  memo: 'memo',
  note: 'memo',
  notes: 'memo',
  reference: 'memo',
  description: 'memo',
  ref: 'memo',
  // escrow_duration
  escrow_duration: 'escrow_duration',
  'escrow duration': 'escrow_duration',
  escrow: 'escrow_duration',
  'lock duration': 'escrow_duration',
  'lock time': 'escrow_duration',
  duration: 'escrow_duration',
};

/** Columns that must be present and non-empty for a row to be valid. */
const REQUIRED_COLUMNS = ['destination', 'amount'] as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A row that failed validation — carries the 1-based row number and all errors. */
export interface XLSXRowError {
  /** 1-based row number in the spreadsheet (header = row 1, first data row = 2). */
  row: number;
  errors: string[];
}

/** Result returned by parseXLSX. */
export interface XLSXParseResult {
  /** Rows that passed validation and are ready for batch submission. */
  records: PaymentRecord[];
  /** Rows that failed validation, each with their row number and error list. */
  errors: XLSXRowError[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an XLSX / XLS file into a validated set of PaymentRecords.
 *
 * ### Header normalisation
 * Column headers are matched case-insensitively and trimmed.  Common aliases
 * (e.g. "Amount", "AMOUNT", "amt", "Payment Amount") are all accepted and
 * mapped to the canonical field name.
 *
 * ### Validation
 * Every data row is validated before being included in `records`.  Rows that
 * fail validation are collected in `errors` with their 1-based row number and
 * a list of human-readable error messages.  The caller can log or surface
 * these errors before submitting the batch.
 *
 * ### Required columns
 * `destination` and `amount` must be present in the sheet headers, otherwise
 * the function throws with a clear message listing the missing columns.
 *
 * @param filePath  Absolute or relative path to the .xlsx / .xls file.
 * @returns         `{ records, errors }` — valid records and per-row errors.
 * @throws          If the file cannot be read or required columns are absent.
 */
export function parseXLSX(filePath: string): XLSXParseResult {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Read as raw rows where headers are raw strings — normalisation happens below.
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    // Keep the raw header strings (don't sanitise) so we can normalise ourselves.
    raw: false,
    defval: '',
  });

  if (rawRows.length === 0) {
    return { records: [], errors: [] };
  }

  // -------------------------------------------------------------------------
  // Build a normalised header map: rawHeader → canonicalKey
  // -------------------------------------------------------------------------
  const rawHeaders = Object.keys(rawRows[0]);
  const headerMap = buildHeaderMap(rawHeaders);

  // -------------------------------------------------------------------------
  // Validate that required columns are present in the sheet
  // -------------------------------------------------------------------------
  const missingRequired = REQUIRED_COLUMNS.filter((col) => !headerMap.has(col));
  if (missingRequired.length > 0) {
    throw new Error(
      `XLSX file is missing required column(s): ${missingRequired.join(', ')}. ` +
        `Found headers: ${rawHeaders.join(', ')}`,
    );
  }

  // -------------------------------------------------------------------------
  // Process each data row
  // -------------------------------------------------------------------------
  const records: PaymentRecord[] = [];
  const errors: XLSXRowError[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    // Row numbers are 1-based; row 1 is the header, so data starts at row 2.
    const rowNumber = i + 2;
    const rawRow = rawRows[i];

    // Remap raw column names to canonical keys.
    const row = remapRow(rawRow, headerMap);

    // Validate and collect errors.
    const rowErrors = validateRow(row, rowNumber);
    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, errors: rowErrors });
      continue;
    }

    records.push(buildRecord(row));
  }

  return { records, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a Map from canonical column key → raw header string (for value lookup)
 * by matching each raw header against HEADER_ALIASES.
 *
 * We store canonical→raw so that later lookups can pull the value out of the
 * original row object using the exact raw key.
 */
function buildHeaderMap(rawHeaders: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of rawHeaders) {
    const normalised = raw.trim().toLowerCase();
    const canonical = HEADER_ALIASES[normalised];
    if (canonical && !map.has(canonical)) {
      // First occurrence wins when two columns alias to the same canonical key.
      map.set(canonical, raw);
    }
  }
  return map;
}

/**
 * Produce a plain object keyed by canonical field names from a single raw row.
 */
function remapRow(
  rawRow: Record<string, unknown>,
  headerMap: Map<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [canonical, rawHeader] of headerMap.entries()) {
    out[canonical] = rawRow[rawHeader];
  }
  return out;
}

/**
 * Validate a single (already remapped) row.  Returns an array of error
 * messages; an empty array means the row is valid.
 */
function validateRow(row: Record<string, unknown>, rowNumber: number): string[] {
  const errors: string[] = [];

  // --- destination ---
  const destination = trimString(row.destination);
  if (!destination) {
    errors.push(`Row ${rowNumber}: missing required field "destination"`);
  } else if (!isNonEmptyString(destination)) {
    errors.push(`Row ${rowNumber}: "destination" must be a non-empty string`);
  }

  // --- amount ---
  const rawAmount = trimString(row.amount);
  if (!rawAmount) {
    errors.push(`Row ${rowNumber}: missing required field "amount"`);
  } else {
    const num = Number(rawAmount);
    if (isNaN(num)) {
      errors.push(`Row ${rowNumber}: "amount" is not a valid number ("${rawAmount}")`);
    } else if (num <= 0) {
      errors.push(`Row ${rowNumber}: "amount" must be greater than zero (got ${num})`);
    }
  }

  // --- escrow_duration (optional but must be a non-negative integer if present) ---
  const rawEscrow = row.escrow_duration;
  if (rawEscrow !== undefined && rawEscrow !== '') {
    const escrowNum = Number(rawEscrow);
    if (isNaN(escrowNum)) {
      errors.push(
        `Row ${rowNumber}: "escrow_duration" is not a valid number ("${rawEscrow}") — use 0 to disable escrow`,
      );
    } else if (!Number.isInteger(escrowNum) || escrowNum < 0) {
      errors.push(
        `Row ${rowNumber}: "escrow_duration" must be a non-negative integer (got ${escrowNum})`,
      );
    }
  }

  return errors;
}

/** Build a PaymentRecord from a validated, remapped row. */
function buildRecord(row: Record<string, unknown>): PaymentRecord {
  return {
    destination: trimString(row.destination) ?? '',
    amount: trimString(row.amount) ?? '0',
    asset: trimString(row.asset) || 'XLM',
    asset_issuer: trimString(row.asset_issuer) ?? '',
    memo: trimString(row.memo) ?? '',
    escrow_duration: parseEscrowDuration(row.escrow_duration),
  };
}

/** Safely trim a value to a string, returning undefined if falsy. */
function trimString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return String(value).trim();
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function parseEscrowDuration(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
