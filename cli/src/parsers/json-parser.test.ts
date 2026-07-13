/**
 * Tests for the JSON parser.
 *
 * Uses temp files to remain self-contained without fixture files on disk.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseJSON } from './json-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTempJSON(content: string): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `json-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(tmpFile, content, 'utf-8');
  return tmpFile;
}

function parseJSONString(content: string) {
  const file = writeTempJSON(content);
  try {
    return parseJSON(file);
  } finally {
    fs.unlinkSync(file);
  }
}

// ---------------------------------------------------------------------------
// Sample inputs
// ---------------------------------------------------------------------------

const VALID_ENTRY_1 = {
  destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2',
  amount: '150',
  asset: 'USDC',
  asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  memo: 'Invoice-007',
  escrow_duration: 3600,
};

const VALID_ENTRY_2 = {
  destination: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3',
  amount: 75,
  asset: 'XLM',
  asset_issuer: '',
  memo: '',
  escrow_duration: 0,
};

const ARRAY_FORMAT = JSON.stringify([VALID_ENTRY_1, VALID_ENTRY_2]);

const OBJECT_WRAPPER_FORMAT = JSON.stringify({
  payments: [
    {
      destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2',
      amount: '200',
      asset: 'EURC',
      memo: 'Payroll-Q1',
    },
  ],
});

const MINIMAL_ENTRY = JSON.stringify([
  { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10' },
]);

// ---------------------------------------------------------------------------
// Tests — valid inputs, top-level array format
// ---------------------------------------------------------------------------

describe('parseJSON — top-level array format', () => {
  it('returns records and empty errors for a fully valid array', () => {
    const { records, errors } = parseJSONString(ARRAY_FORMAT);
    expect(records).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });

  it('maps destination correctly', () => {
    const { records } = parseJSONString(ARRAY_FORMAT);
    expect(records[0].destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
  });

  it('maps string amount correctly', () => {
    const { records } = parseJSONString(ARRAY_FORMAT);
    expect(records[0].amount).toBe('150');
  });

  it('coerces numeric amount to string', () => {
    const { records } = parseJSONString(ARRAY_FORMAT);
    expect(records[1].amount).toBe('75');
    expect(typeof records[1].amount).toBe('string');
  });

  it('maps asset correctly', () => {
    const { records } = parseJSONString(ARRAY_FORMAT);
    expect(records[0].asset).toBe('USDC');
  });

  it('upper-cases the asset value', () => {
    const { records } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', asset: 'usdc' }]),
    );
    expect(records[0].asset).toBe('USDC');
  });

  it('maps asset_issuer correctly', () => {
    const { records } = parseJSONString(ARRAY_FORMAT);
    expect(records[0].asset_issuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
  });

  it('maps memo correctly', () => {
    const { records } = parseJSONString(ARRAY_FORMAT);
    expect(records[0].memo).toBe('Invoice-007');
  });

  it('maps escrow_duration correctly', () => {
    const { records } = parseJSONString(ARRAY_FORMAT);
    expect(records[0].escrow_duration).toBe(3600);
  });

  it('maps second entry independently', () => {
    const { records } = parseJSONString(ARRAY_FORMAT);
    expect(records[1].destination).toBe('GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3');
    expect(records[1].amount).toBe('75');
    expect(records[1].asset).toBe('XLM');
    expect(records[1].escrow_duration).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — { payments: [...] } wrapper format
// ---------------------------------------------------------------------------

describe('parseJSON — object wrapper { payments: [...] } format', () => {
  it('reads entries from the payments key', () => {
    const { records, errors } = parseJSONString(OBJECT_WRAPPER_FORMAT);
    expect(records).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('maps fields from wrapped format correctly', () => {
    const { records } = parseJSONString(OBJECT_WRAPPER_FORMAT);
    expect(records[0].destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
    expect(records[0].amount).toBe('200');
    expect(records[0].asset).toBe('EURC');
    expect(records[0].memo).toBe('Payroll-Q1');
  });

  it('throws when the payments key is not an array', () => {
    expect(() =>
      parseJSONString(JSON.stringify({ payments: 'not-an-array' })),
    ).toThrow(/payments.*must be an array/i);
  });
});

// ---------------------------------------------------------------------------
// Tests — default / fallback values for missing optional fields
// ---------------------------------------------------------------------------

describe('parseJSON — default values for missing optional fields', () => {
  it('defaults asset to XLM when absent', () => {
    const { records } = parseJSONString(MINIMAL_ENTRY);
    expect(records[0].asset).toBe('XLM');
  });

  it('defaults asset_issuer to empty string when absent', () => {
    const { records } = parseJSONString(MINIMAL_ENTRY);
    expect(records[0].asset_issuer).toBe('');
  });

  it('defaults memo to empty string when absent', () => {
    const { records } = parseJSONString(MINIMAL_ENTRY);
    expect(records[0].memo).toBe('');
  });

  it('defaults escrow_duration to 0 when absent', () => {
    const { records } = parseJSONString(MINIMAL_ENTRY);
    expect(records[0].escrow_duration).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — field normalisation
// ---------------------------------------------------------------------------

describe('parseJSON — field normalisation', () => {
  it('trims whitespace from destination', () => {
    const { records } = parseJSONString(
      JSON.stringify([{ destination: '  GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2  ', amount: '5' }]),
    );
    expect(records[0].destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
  });

  it('trims whitespace from amount', () => {
    const { records } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '  42  ' }]),
    );
    expect(records[0].amount).toBe('42');
  });

  it('converts numeric amount to string', () => {
    const { records } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: 99 }]),
    );
    expect(records[0].amount).toBe('99');
    expect(typeof records[0].amount).toBe('string');
  });

  it('upper-cases asset from lowercase input', () => {
    const { records } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', asset: 'eurc' }]),
    );
    expect(records[0].asset).toBe('EURC');
  });

  it('upper-cases asset from mixed-case input', () => {
    const { records } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', asset: 'Usdc' }]),
    );
    expect(records[0].asset).toBe('USDC');
  });

  it('trims whitespace from memo', () => {
    const { records } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', memo: '  ref-001  ' }]),
    );
    expect(records[0].memo).toBe('ref-001');
  });
});

// ---------------------------------------------------------------------------
// Tests — entry-level validation errors
// ---------------------------------------------------------------------------

describe('parseJSON — entry-level validation', () => {
  it('returns an error when destination is missing', () => {
    const { records, errors } = parseJSONString(
      JSON.stringify([{ amount: '10' }]),
    );
    expect(records).toHaveLength(0);
    expect(errors[0].index).toBe(1);
    expect(errors[0].errors[0]).toMatch(/destination/i);
  });

  it('returns an error when destination is an empty string', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: '', amount: '10' }]),
    );
    expect(errors[0].errors[0]).toMatch(/destination/i);
  });

  it('returns an error when amount is missing', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2' }]),
    );
    expect(errors[0].errors[0]).toMatch(/amount/i);
  });

  it('returns an error when amount is not a number', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: 'abc' }]),
    );
    expect(errors[0].errors[0]).toMatch(/not a valid number/i);
  });

  it('returns an error when amount is zero', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: 0 }]),
    );
    expect(errors[0].errors[0]).toMatch(/greater than zero/i);
  });

  it('returns an error when amount is negative', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: -5 }]),
    );
    expect(errors[0].errors[0]).toMatch(/greater than zero/i);
  });

  it('returns an error when asset is a non-string type', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', asset: 123 }]),
    );
    expect(errors[0].errors[0]).toMatch(/asset.*must be a string/i);
  });

  it('returns an error when memo is a non-string type', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', memo: 99 }]),
    );
    expect(errors[0].errors[0]).toMatch(/memo.*must be a string/i);
  });

  it('returns an error when escrow_duration is non-numeric', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', escrow_duration: 'bad' }]),
    );
    expect(errors[0].errors[0]).toMatch(/escrow_duration.*not a valid number/i);
  });

  it('returns an error when escrow_duration is negative', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', escrow_duration: -1 }]),
    );
    expect(errors[0].errors[0]).toMatch(/non-negative integer/i);
  });

  it('returns an error when escrow_duration is a non-integer', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '5', escrow_duration: 1.5 }]),
    );
    expect(errors[0].errors[0]).toMatch(/non-negative integer/i);
  });

  it('returns an error when an entry is not an object', () => {
    const { errors } = parseJSONString(JSON.stringify(['not-an-object']));
    expect(errors[0].index).toBe(1);
    expect(errors[0].errors[0]).toMatch(/expected a JSON object/i);
  });

  it('reports multiple errors for the same entry', () => {
    const { errors } = parseJSONString(
      JSON.stringify([{ destination: '', amount: 0 }]),
    );
    expect(errors[0].errors.length).toBeGreaterThanOrEqual(2);
  });

  it('assigns correct 1-based index to each error', () => {
    const { errors } = parseJSONString(
      JSON.stringify([
        { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10' }, // valid → index 1
        { destination: '', amount: '5' },                                                          // invalid → index 2
        { destination: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3', amount: '20' }, // valid → index 3
        { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: -1 },   // invalid → index 4
      ]),
    );
    expect(errors).toHaveLength(2);
    expect(errors[0].index).toBe(2);
    expect(errors[1].index).toBe(4);
  });

  it('returns valid entries alongside entries that have errors', () => {
    const { records, errors } = parseJSONString(
      JSON.stringify([
        { destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10' },
        { destination: '', amount: '5' },
        { destination: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGVA2XM9DWBF32LLVBF3', amount: '20' },
      ]),
    );
    expect(records).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it('accepts escrow_duration of 0 (disabled escrow)', () => {
    const { records, errors } = parseJSONString(
      JSON.stringify([{ destination: 'GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2', amount: '10', escrow_duration: 0 }]),
    );
    expect(errors).toHaveLength(0);
    expect(records[0].escrow_duration).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — top-level schema errors
// ---------------------------------------------------------------------------

describe('parseJSON — top-level schema errors', () => {
  it('throws on malformed JSON', () => {
    expect(() => parseJSONString('{ invalid json')).toThrow(SyntaxError);
  });

  it('throws when top-level value is a plain string', () => {
    expect(() => parseJSONString('"just a string"')).toThrow(/expected a top-level array/i);
  });

  it('throws when top-level value is a number', () => {
    expect(() => parseJSONString('42')).toThrow(/expected a top-level array/i);
  });

  it('throws when top-level object has no payments key', () => {
    expect(() => parseJSONString(JSON.stringify({ data: [] }))).toThrow(/expected a top-level array/i);
  });

  it('throws when payments key is not an array', () => {
    expect(() => parseJSONString(JSON.stringify({ payments: {} }))).toThrow(/must be an array/i);
  });

  it('throws when the file does not exist', () => {
    expect(() => parseJSON('/nonexistent/path/file.json')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests — edge cases
// ---------------------------------------------------------------------------

describe('parseJSON — edge cases', () => {
  it('returns empty records and errors for an empty top-level array', () => {
    const { records, errors } = parseJSONString('[]');
    expect(records).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('returns empty records and errors for an empty payments wrapper', () => {
    const { records, errors } = parseJSONString(JSON.stringify({ payments: [] }));
    expect(records).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('returns all required PaymentRecord keys on every valid record', () => {
    const { records } = parseJSONString(ARRAY_FORMAT);
    for (const record of records) {
      expect(record).toHaveProperty('destination');
      expect(record).toHaveProperty('amount');
      expect(record).toHaveProperty('asset');
      expect(record).toHaveProperty('asset_issuer');
      expect(record).toHaveProperty('memo');
      expect(record).toHaveProperty('escrow_duration');
    }
  });
});
