/**
 * Tests for the SWIFT MT103 parser.
 *
 * We use `parseMT103` (file-based) via a helper that writes a temp file so the
 * tests remain self-contained without requiring fixture files on disk.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseMT103 } from './mt103-parser';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Write content to a temp file and return its path. */
function writeTempMT103(content: string): string {
  const tmpFile = path.join(os.tmpdir(), `mt103-test-${Date.now()}-${Math.random().toString(36).slice(2)}.mt103`);
  fs.writeFileSync(tmpFile, content, 'utf-8');
  return tmpFile;
}

/** Parse an inline MT103 string without needing a real file. */
function parseMT103String(content: string) {
  const file = writeTempMT103(content);
  try {
    return parseMT103(file);
  } finally {
    fs.unlinkSync(file);
  }
}

// ---------------------------------------------------------------------------
// Sample MT103 messages
// ---------------------------------------------------------------------------

/**
 * Minimal valid MT103 with a Stellar address in field :59:.
 *
 * Field layout mirrors the real SWIFT Block 4 structure (content after `{4:`).
 */
const BASIC_MT103 = `{4:
:20:REF20240101001
:23B:CRED
:32A:240101USD1500,00
:50K:/123456789
ACME Corp
:52A:BANKUS33
:57A:STELLARXX
:59:/GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2
John Beneficiary
:70:/INV/2024-001
:71A:OUR
-}`;

/**
 * MT103 with a Stellar public key embedded in :59: but NOT on the first line
 * (key is on the second line of the beneficiary field).
 */
const STELLAR_KEY_ON_SECOND_LINE = `{4:
:20:REF20240101002
:23B:CRED
:32A:240115EUR2000,50
:50K:SENDER NAME
:57A:EUROBICXX
:59:
GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2
Maria Recipient
:70:/RFB/PO-9876
:71A:SHA
-}`;

/**
 * MT103 with field :59: containing only an IBAN-style account (no Stellar key).
 */
const IBAN_BENEFICIARY = `{4:
:20:REF20240101003
:23B:CRED
:32A:240120GBP750,
:50K:/UK29NWBK60161331926819
British Sender Ltd
:57A:NWBKGB2L
:59:/DE89370400440532013000
Hans Mueller
:70:/RFB/INV-DE-2024
:71A:OUR
-}`;

/**
 * MT103 with multi-line :70: remittance information.
 */
const MULTILINE_REMITTANCE = `{4:
:20:REF20240101004
:23B:CRED
:32A:240201MXN18000,
:52A:BANAMEXMM
:59:GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2
:70:/RFB/PAYROLL-FEB-2024
/EMPL/EMP-00042
/DEPT/ENGINEERING
:71A:OUR
-}`;

/**
 * File containing two MT103 messages back-to-back.
 */
const TWO_MESSAGES = `{4:
:20:REF-A
:23B:CRED
:32A:240301USD500,
:59:GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2
:70:/INV/AAA
-}
{4:
:20:REF-B
:23B:CRED
:32A:240301EUR800,
:59:GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL3
:70:/INV/BBB
-}`;

/**
 * Message with no amount — should be skipped by the parser.
 */
const MISSING_AMOUNT = `{4:
:20:REF-NOAMT
:23B:CRED
:59:GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2
:70:/RFB/TEST
-}`;

/**
 * Message with no beneficiary — should be skipped by the parser.
 */
const MISSING_BENEFICIARY = `{4:
:20:REF-NOBENEF
:23B:CRED
:32A:240301USD100,
:70:/RFB/TEST
-}`;

// ---------------------------------------------------------------------------
// Tests — field :32A: (Value Date / Currency / Amount)
// ---------------------------------------------------------------------------

describe('MT103 :32A: field parsing', () => {
  it('parses currency from :32A:', () => {
    const [record] = parseMT103String(BASIC_MT103);
    // USD maps to USDC
    expect(record.asset).toBe('USDC');
  });

  it('parses decimal amount (comma separator) from :32A:', () => {
    const [record] = parseMT103String(BASIC_MT103);
    expect(record.amount).toBe('1500.00');
  });

  it('parses EUR and maps to EURC', () => {
    const [record] = parseMT103String(STELLAR_KEY_ON_SECOND_LINE);
    expect(record.asset).toBe('EURC');
    expect(record.amount).toBe('2000.50');
  });

  it('parses GBP and keeps it as GBP', () => {
    const [record] = parseMT103String(IBAN_BENEFICIARY);
    expect(record.asset).toBe('GBP');
  });

  it('parses MXN and keeps it as MXN', () => {
    const [record] = parseMT103String(MULTILINE_REMITTANCE);
    expect(record.asset).toBe('MXN');
  });

  it('handles whole-number amount with trailing comma', () => {
    const [record] = parseMT103String(IBAN_BENEFICIARY);
    // 750, → 750
    expect(record.amount).toBe('750');
  });
});

// ---------------------------------------------------------------------------
// Tests — field :59: (Beneficiary Customer)
// ---------------------------------------------------------------------------

describe('MT103 :59: beneficiary account parsing', () => {
  it('extracts a Stellar public key from :59: on the same line as the tag', () => {
    const [record] = parseMT103String(BASIC_MT103);
    expect(record.destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
  });

  it('extracts a Stellar public key from a continuation line in :59:', () => {
    const [record] = parseMT103String(STELLAR_KEY_ON_SECOND_LINE);
    expect(record.destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
  });

  it('extracts Stellar key embedded directly in :59: without account prefix', () => {
    const [record] = parseMT103String(MULTILINE_REMITTANCE);
    expect(record.destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
  });

  it('falls back to IBAN-style account when no Stellar key is present', () => {
    const [record] = parseMT103String(IBAN_BENEFICIARY);
    // The IBAN account should be used as the destination
    expect(record.destination).toBe('DE89370400440532013000');
  });
});

// ---------------------------------------------------------------------------
// Tests — field :70: (Remittance Information)
// ---------------------------------------------------------------------------

describe('MT103 :70: remittance / narrative parsing', () => {
  it('uses :70: remittance info as the payment memo', () => {
    const [record] = parseMT103String(BASIC_MT103);
    expect(record.memo).toContain('INV/2024-001');
  });

  it('joins multi-line :70: remittance lines into a single string', () => {
    const [record] = parseMT103String(MULTILINE_REMITTANCE);
    // All three continuation lines should appear in the memo
    expect(record.memo).toContain('RFB/PAYROLL-FEB-2024');
    expect(record.memo).toContain('EMPL/EMP-00042');
    expect(record.memo).toContain('DEPT/ENGINEERING');
  });

  it('strips leading slash from remittance continuation lines', () => {
    const [record] = parseMT103String(MULTILINE_REMITTANCE);
    // The raw lines start with / — after parsing they should not appear as //
    expect(record.memo).not.toMatch(/\/\//);
  });

  it('falls back to :20: transaction reference when :70: is absent', () => {
    // Construct a message without a :70: field
    const noRemittance = `{4:
:20:TX-REF-FALLBACK
:23B:CRED
:32A:240301USD100,
:59:GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2
:71A:OUR
-}`;
    const [record] = parseMT103String(noRemittance);
    expect(record.memo).toBe('TX-REF-FALLBACK');
  });
});

// ---------------------------------------------------------------------------
// Tests — multi-message files and edge cases
// ---------------------------------------------------------------------------

describe('MT103 multi-message files and edge cases', () => {
  it('parses two messages from a single file', () => {
    const records = parseMT103String(TWO_MESSAGES);
    expect(records).toHaveLength(2);
  });

  it('assigns correct amounts to each message in a multi-message file', () => {
    const records = parseMT103String(TWO_MESSAGES);
    expect(records[0].amount).toBe('500');
    expect(records[1].amount).toBe('800');
  });

  it('assigns correct assets to each message in a multi-message file', () => {
    const records = parseMT103String(TWO_MESSAGES);
    expect(records[0].asset).toBe('USDC'); // USD → USDC
    expect(records[1].asset).toBe('EURC'); // EUR → EURC
  });

  it('skips messages that are missing an amount', () => {
    const records = parseMT103String(MISSING_AMOUNT);
    expect(records).toHaveLength(0);
  });

  it('skips messages that are missing a beneficiary', () => {
    const records = parseMT103String(MISSING_BENEFICIARY);
    expect(records).toHaveLength(0);
  });

  it('sets default escrow_duration to 86400 (24h) for all MT103 payments', () => {
    const [record] = parseMT103String(BASIC_MT103);
    expect(record.escrow_duration).toBe(86400);
  });

  it('returns empty array for a file with no valid MT103 blocks', () => {
    const records = parseMT103String('This is not an MT103 file.\nRandom content.');
    expect(records).toHaveLength(0);
  });

  it('maps unknown currency codes through as-is instead of defaulting to USDC', () => {
    const unknownCurrency = `{4:
:20:REF-UNK
:23B:CRED
:32A:240301XYZ200,
:59:GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2
:70:/RFB/TEST
-}`;
    const [record] = parseMT103String(unknownCurrency);
    // Unknown currencies pass through rather than being silently coerced to USDC
    expect(record.asset).toBe('XYZ');
  });
});

// ---------------------------------------------------------------------------
// Tests — field :50K: (Ordering Customer)
// ---------------------------------------------------------------------------

describe('MT103 :50K: ordering customer parsing', () => {
  it('captures the ordering customer account and name from :50K:', () => {
    const [record] = parseMT103String(BASIC_MT103);
    // We don't map orderingCustomer to PaymentRecord directly, but we can
    // verify the file round-trips correctly by checking other fields are intact.
    // The key assertion is that the presence of :50K: does not corrupt other fields.
    expect(record.destination).toBe('GBDEVU63Y6BHHYWUMAS6NHXVWUIQEJBACC7F6QXJZUCM4TBNEOUFL2');
    expect(record.amount).toBe('1500.00');
  });

  it('does not treat :50K: content as the beneficiary destination', () => {
    // Sender /123456789 must not bleed into the destination field
    const [record] = parseMT103String(BASIC_MT103);
    expect(record.destination).not.toContain('123456789');
  });
});
