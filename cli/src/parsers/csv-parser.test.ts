/**
 * Tests for the CSV parser.
 *
 * Uses temp files to remain self-contained without fixture files on disk.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseCSV } from './csv-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTempCSV(content: string): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `csv-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`,
  );
  fs.writeFileSync(tmpFile, content, 'utf-8');
  return tmpFile;
}

function parseCSVString(content: string) {
  const file = writeTempCSV(content);
  try {
    return parseCSV(file);
  } finally {
    fs.unlinkSync(file);
  }
}

// ---------------------------------------------------------------------------
// Sample inputs
// ---------------------------------------------------------------------------

const VALID_CSV = `destination,amount,asset,asset_issuer,memo,escrow_duration
GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2,100,USDC,GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN,Invoice-001,3600
GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3,50,XLM,,Payroll,0`;

const MINIMAL_CSV = `destination,amount
GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2,200`;

const EMPTY_ROWS_CSV = `destination,amount,asset,asset_issuer,memo,escrow_duration
GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2,10,XLM,,,0

GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3,20,XLM,,,0`;

const WHITESPACE_CSV = `destination , amount , asset
  GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2 , 75 , XLM`;

const MISSING_OPTIONAL_FIELDS_CSV = `destination,amount
GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2,99`;

const ESCROW_DURATION_CSV = `destination,amount,asset,asset_issuer,memo,escrow_duration
GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2,50,XLM,,,7200`;

const INVALID_ESCROW_CSV = `destination,amount,asset,asset_issuer,memo,escrow_duration
GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2,50,XLM,,,notanumber`;

// ---------------------------------------------------------------------------
// Tests — valid inputs
// ---------------------------------------------------------------------------

describe('parseCSV — valid inputs', () => {
  it('returns one PaymentRecord per data row', () => {
    const records = parseCSVString(VALID_CSV);
    expect(records).toHaveLength(2);
  });

  it('maps destination correctly', () => {
    const [first] = parseCSVString(VALID_CSV);
    expect(first.destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
  });

  it('maps amount as a string', () => {
    const [first] = parseCSVString(VALID_CSV);
    expect(first.amount).toBe('100');
  });

  it('maps asset correctly', () => {
    const [first] = parseCSVString(VALID_CSV);
    expect(first.asset).toBe('USDC');
  });

  it('maps asset_issuer correctly', () => {
    const [first] = parseCSVString(VALID_CSV);
    expect(first.asset_issuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
  });

  it('maps memo correctly', () => {
    const [first] = parseCSVString(VALID_CSV);
    expect(first.memo).toBe('Invoice-001');
  });

  it('maps escrow_duration as a number', () => {
    const [first] = parseCSVString(VALID_CSV);
    expect(first.escrow_duration).toBe(3600);
  });

  it('maps second row independently', () => {
    const [, second] = parseCSVString(VALID_CSV);
    expect(second.destination).toBe('GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3');
    expect(second.amount).toBe('50');
    expect(second.asset).toBe('XLM');
    expect(second.escrow_duration).toBe(0);
  });

  it('parses escrow_duration as integer', () => {
    const [record] = parseCSVString(ESCROW_DURATION_CSV);
    expect(record.escrow_duration).toBe(7200);
    expect(typeof record.escrow_duration).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Tests — default / fallback values
// ---------------------------------------------------------------------------

describe('parseCSV — default values for missing optional fields', () => {
  it('defaults asset to XLM when column is absent', () => {
    const [record] = parseCSVString(MISSING_OPTIONAL_FIELDS_CSV);
    expect(record.asset).toBe('XLM');
  });

  it('defaults asset_issuer to empty string when column is absent', () => {
    const [record] = parseCSVString(MISSING_OPTIONAL_FIELDS_CSV);
    expect(record.asset_issuer).toBe('');
  });

  it('defaults memo to empty string when column is absent', () => {
    const [record] = parseCSVString(MISSING_OPTIONAL_FIELDS_CSV);
    expect(record.memo).toBe('');
  });

  it('defaults escrow_duration to 0 when column is absent', () => {
    const [record] = parseCSVString(MISSING_OPTIONAL_FIELDS_CSV);
    expect(record.escrow_duration).toBe(0);
  });

  it('defaults amount to "0" when amount column is absent', () => {
    const csv = `destination\nGBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2`;
    const [record] = parseCSVString(csv);
    expect(record.amount).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Tests — edge cases
// ---------------------------------------------------------------------------

describe('parseCSV — edge cases', () => {
  it('skips empty lines', () => {
    const records = parseCSVString(EMPTY_ROWS_CSV);
    expect(records).toHaveLength(2);
  });

  it('trims whitespace from values', () => {
    const [record] = parseCSVString(WHITESPACE_CSV);
    expect(record.destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
    expect(record.amount).toBe('75');
    expect(record.asset).toBe('XLM');
  });

  it('treats non-numeric escrow_duration as 0', () => {
    const [record] = parseCSVString(INVALID_ESCROW_CSV);
    expect(record.escrow_duration).toBe(0);
  });

  it('returns an empty array for a header-only CSV', () => {
    const headerOnly = `destination,amount,asset,asset_issuer,memo,escrow_duration`;
    const records = parseCSVString(headerOnly);
    expect(records).toHaveLength(0);
  });

  it('returns all required PaymentRecord keys on every record', () => {
    const records = parseCSVString(VALID_CSV);
    for (const record of records) {
      expect(record).toHaveProperty('destination');
      expect(record).toHaveProperty('amount');
      expect(record).toHaveProperty('asset');
      expect(record).toHaveProperty('asset_issuer');
      expect(record).toHaveProperty('memo');
      expect(record).toHaveProperty('escrow_duration');
    }
  });

  it('throws when the file does not exist', () => {
    expect(() => parseCSV('/nonexistent/path/file.csv')).toThrow();
  });
});
