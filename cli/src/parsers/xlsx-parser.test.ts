/**
 * Tests for the XLSX parser.
 *
 * Uses the `xlsx` library to programmatically build workbooks in memory and
 * write them to temp files, so no fixture files are needed on disk.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parseXLSX } from './xlsx-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SheetRow = Record<string, string | number | undefined>;

/** Build a single-sheet .xlsx temp file from an array of row objects. */
function writeTempXLSX(rows: SheetRow[]): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `xlsx-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`,
  );
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, tmpFile);
  return tmpFile;
}

function parseRows(rows: SheetRow[]) {
  const file = writeTempXLSX(rows);
  try {
    return parseXLSX(file);
  } finally {
    fs.unlinkSync(file);
  }
}

// ---------------------------------------------------------------------------
// Sample row data — canonical headers
// ---------------------------------------------------------------------------

const FULL_ROWS: SheetRow[] = [
  {
    destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2',
    amount: '100',
    asset: 'USDC',
    asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    memo: 'Invoice-001',
    escrow_duration: 3600,
  },
  {
    destination: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3',
    amount: 50,
    asset: 'XLM',
    asset_issuer: '',
    memo: '',
    escrow_duration: 0,
  },
];

const MINIMAL_ROWS: SheetRow[] = [
  { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '200' },
];

const NUMERIC_AMOUNT_ROW: SheetRow[] = [
  { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: 77 },
];

// ---------------------------------------------------------------------------
// Tests — valid inputs (canonical headers)
// ---------------------------------------------------------------------------

describe('parseXLSX — valid inputs', () => {
  it('returns one record per valid data row', () => {
    const { records, errors } = parseRows(FULL_ROWS);
    expect(records).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });

  it('maps destination correctly', () => {
    const { records } = parseRows(FULL_ROWS);
    expect(records[0].destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
  });

  it('maps string amount correctly', () => {
    const { records } = parseRows(FULL_ROWS);
    expect(records[0].amount).toBe('100');
  });

  it('coerces numeric amount to string', () => {
    const { records } = parseRows(FULL_ROWS);
    expect(records[1].amount).toBe('50');
    expect(typeof records[1].amount).toBe('string');
  });

  it('maps asset correctly', () => {
    const { records } = parseRows(FULL_ROWS);
    expect(records[0].asset).toBe('USDC');
  });

  it('maps asset_issuer correctly', () => {
    const { records } = parseRows(FULL_ROWS);
    expect(records[0].asset_issuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
  });

  it('maps memo correctly', () => {
    const { records } = parseRows(FULL_ROWS);
    expect(records[0].memo).toBe('Invoice-001');
  });

  it('maps escrow_duration as a number', () => {
    const { records } = parseRows(FULL_ROWS);
    expect(records[0].escrow_duration).toBe(3600);
  });

  it('maps second row independently', () => {
    const { records } = parseRows(FULL_ROWS);
    expect(records[1].destination).toBe('GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3');
    expect(records[1].amount).toBe('50');
    expect(records[1].asset).toBe('XLM');
    expect(records[1].escrow_duration).toBe(0);
  });

  it('coerces numeric cell amount to string', () => {
    const { records } = parseRows(NUMERIC_AMOUNT_ROW);
    expect(records[0].amount).toBe('77');
    expect(typeof records[0].amount).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Tests — default / fallback values for missing optional columns
// ---------------------------------------------------------------------------

describe('parseXLSX — default values for missing optional columns', () => {
  it('defaults asset to XLM', () => {
    const { records } = parseRows(MINIMAL_ROWS);
    expect(records[0].asset).toBe('XLM');
  });

  it('defaults asset_issuer to empty string', () => {
    const { records } = parseRows(MINIMAL_ROWS);
    expect(records[0].asset_issuer).toBe('');
  });

  it('defaults memo to empty string', () => {
    const { records } = parseRows(MINIMAL_ROWS);
    expect(records[0].memo).toBe('');
  });

  it('defaults escrow_duration to 0', () => {
    const { records } = parseRows(MINIMAL_ROWS);
    expect(records[0].escrow_duration).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — header normalisation
// ---------------------------------------------------------------------------

describe('parseXLSX — header normalisation', () => {
  it('accepts uppercase headers (DESTINATION, AMOUNT)', () => {
    const { records, errors } = parseRows([
      { DESTINATION: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', AMOUNT: '10' },
    ] as SheetRow[]);
    expect(errors).toHaveLength(0);
    expect(records[0].destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
    expect(records[0].amount).toBe('10');
  });

  it('accepts mixed-case headers (Destination, Amount)', () => {
    const { records, errors } = parseRows([
      { Destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', Amount: '25' },
    ] as SheetRow[]);
    expect(errors).toHaveLength(0);
    expect(records[0].destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
    expect(records[0].amount).toBe('25');
  });

  it('accepts "amt" as an alias for amount', () => {
    const { records } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amt: '30' },
    ] as SheetRow[]);
    expect(records[0].amount).toBe('30');
  });

  it('accepts "recipient" as an alias for destination', () => {
    const { records } = parseRows([
      { recipient: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5' },
    ] as SheetRow[]);
    expect(records[0].destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
  });

  it('accepts "currency" as an alias for asset', () => {
    const { records } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', currency: 'EURC' },
    ] as SheetRow[]);
    expect(records[0].asset).toBe('EURC');
  });

  it('accepts "token" as an alias for asset', () => {
    const { records } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', token: 'USDC' },
    ] as SheetRow[]);
    expect(records[0].asset).toBe('USDC');
  });

  it('accepts "reference" as an alias for memo', () => {
    const { records } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', reference: 'REF-001' },
    ] as SheetRow[]);
    expect(records[0].memo).toBe('REF-001');
  });

  it('accepts "escrow duration" (with space) as an alias for escrow_duration', () => {
    const { records } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', 'escrow duration': 7200 },
    ] as SheetRow[]);
    expect(records[0].escrow_duration).toBe(7200);
  });

  it('accepts "issuer" as an alias for asset_issuer', () => {
    const { records } = parseRows([
      {
        destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2',
        amount: '5',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      },
    ] as SheetRow[]);
    expect(records[0].asset_issuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
  });

  it('trims whitespace from header names before normalising', () => {
    // Simulate a spreadsheet with accidentally padded column headers
    const ws = XLSX.utils.aoa_to_sheet([
      ['  destination  ', '  amount  '],
      ['GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', '15'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const tmpFile = path.join(os.tmpdir(), `xlsx-trim-${Date.now()}.xlsx`);
    XLSX.writeFile(wb, tmpFile);
    try {
      const { records, errors } = parseXLSX(tmpFile);
      expect(errors).toHaveLength(0);
      expect(records[0].destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
      expect(records[0].amount).toBe('15');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — required column validation
// ---------------------------------------------------------------------------

describe('parseXLSX — required column validation', () => {
  it('throws when both destination and amount columns are absent', () => {
    const ws = XLSX.utils.aoa_to_sheet([['note'], ['hello']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const tmpFile = path.join(os.tmpdir(), `xlsx-nocols-${Date.now()}.xlsx`);
    XLSX.writeFile(wb, tmpFile);
    try {
      expect(() => parseXLSX(tmpFile)).toThrow(/missing required column/i);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('throws when only the destination column is missing', () => {
    const ws = XLSX.utils.aoa_to_sheet([['amount'], ['100']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const tmpFile = path.join(os.tmpdir(), `xlsx-nodest-${Date.now()}.xlsx`);
    XLSX.writeFile(wb, tmpFile);
    try {
      expect(() => parseXLSX(tmpFile)).toThrow(/destination/i);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('throws when only the amount column is missing', () => {
    const ws = XLSX.utils.aoa_to_sheet([['destination'], ['GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const tmpFile = path.join(os.tmpdir(), `xlsx-noamt-${Date.now()}.xlsx`);
    XLSX.writeFile(wb, tmpFile);
    try {
      expect(() => parseXLSX(tmpFile)).toThrow(/amount/i);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('error message includes the found headers', () => {
    const ws = XLSX.utils.aoa_to_sheet([['note', 'ref'], ['x', 'y']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const tmpFile = path.join(os.tmpdir(), `xlsx-hdrs-${Date.now()}.xlsx`);
    XLSX.writeFile(wb, tmpFile);
    try {
      expect(() => parseXLSX(tmpFile)).toThrow(/found headers/i);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — row-level validation
// ---------------------------------------------------------------------------

describe('parseXLSX — row-level validation', () => {
  it('returns a row error when destination is empty', () => {
    const { records, errors } = parseRows([
      { destination: '', amount: '10' },
    ]);
    expect(records).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].errors[0]).toMatch(/destination/i);
  });

  it('returns a row error when amount is empty', () => {
    const { records, errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '' },
    ]);
    expect(records).toHaveLength(0);
    expect(errors[0].row).toBe(2);
    expect(errors[0].errors[0]).toMatch(/amount/i);
  });

  it('returns a row error when amount is not a number', () => {
    const { errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: 'abc' },
    ]);
    expect(errors[0].errors[0]).toMatch(/not a valid number/i);
  });

  it('returns a row error when amount is zero', () => {
    const { errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '0' },
    ]);
    expect(errors[0].errors[0]).toMatch(/greater than zero/i);
  });

  it('returns a row error when amount is negative', () => {
    const { errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '-5' },
    ]);
    expect(errors[0].errors[0]).toMatch(/greater than zero/i);
  });

  it('returns a row error when escrow_duration is non-numeric', () => {
    const { errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10', escrow_duration: 'bad' },
    ]);
    expect(errors[0].errors[0]).toMatch(/escrow_duration/i);
  });

  it('returns a row error when escrow_duration is negative', () => {
    const { errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10', escrow_duration: -1 },
    ]);
    expect(errors[0].errors[0]).toMatch(/non-negative/i);
  });

  it('reports multiple errors per row when both required fields are invalid', () => {
    const { errors } = parseRows([{ destination: '', amount: '0' }]);
    expect(errors[0].errors.length).toBeGreaterThanOrEqual(2);
  });

  it('assigns correct 1-based row numbers (first data row = 2)', () => {
    const { errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10' }, // row 2 — valid
      { destination: '', amount: '10' },  // row 3 — invalid
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '20' }, // row 4 — valid
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '-1' }, // row 5 — invalid
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0].row).toBe(3);
    expect(errors[1].row).toBe(5);
  });

  it('valid rows are returned even when some rows have errors', () => {
    const { records, errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10' },
      { destination: '', amount: '10' },
      { destination: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3', amount: '20' },
    ]);
    expect(records).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it('accepts escrow_duration of 0 (disabled escrow)', () => {
    const { records, errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10', escrow_duration: 0 },
    ]);
    expect(errors).toHaveLength(0);
    expect(records[0].escrow_duration).toBe(0);
  });

  it('rejects a fractional escrow_duration — must be a non-negative integer', () => {
    const { errors } = parseRows([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10', escrow_duration: 3600.9 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].errors[0]).toMatch(/non-negative integer/i);
  });
});

// ---------------------------------------------------------------------------
// Tests — edge cases
// ---------------------------------------------------------------------------

describe('parseXLSX — edge cases', () => {
  it('returns empty records and errors for a sheet with no data rows', () => {
    const { records, errors } = parseRows([]);
    expect(records).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('uses only the first sheet when the workbook has multiple sheets', () => {
    const tmpFile = path.join(os.tmpdir(), `xlsx-multi-${Date.now()}.xlsx`);
    const ws1 = XLSX.utils.json_to_sheet([
      { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10' },
    ]);
    const ws2 = XLSX.utils.json_to_sheet([
      { destination: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3', amount: '20' },
      { destination: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3', amount: '30' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Payments');
    XLSX.utils.book_append_sheet(wb, ws2, 'Other');
    XLSX.writeFile(wb, tmpFile);
    try {
      const { records } = parseXLSX(tmpFile);
      expect(records).toHaveLength(1);
      expect(records[0].amount).toBe('10');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('returns all required PaymentRecord keys on every valid record', () => {
    const { records } = parseRows(FULL_ROWS);
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
    expect(() => parseXLSX('/nonexistent/path/file.xlsx')).toThrow();
  });
});
