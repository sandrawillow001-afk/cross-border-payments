import * as fs from 'fs';
import { PaymentRecord, MT103Message } from '../types';

/**
 * SWIFT MT103 message parser for bank integration.
 *
 * Parses MT103 "Single Customer Credit Transfer" messages and converts them to
 * PaymentRecord format for batch processing.
 *
 * ## Field support
 *
 * | Tag   | Name                        | Mapped to                           |
 * |-------|-----------------------------|-------------------------------------|
 * | :20:  | Transaction Reference       | `memo` (fallback when :70: absent)  |
 * | :23B: | Bank Operation Code         | (informational, not mapped)         |
 * | :32A: | Value Date / Currency / Amt | `valueDate`, `currency`, `amount`   |
 * | :50K: | Ordering Customer           | `orderingCustomer` (account + name) |
 * | :50A: | Ordering Customer (BIC)     | `orderingCustomer` (BIC form)       |
 * | :52A: | Ordering Institution        | `senderBIC`                         |
 * | :57A: | Account With Institution    | `receiverBIC`                       |
 * | :59:  | Beneficiary Customer        | `beneficiaryAccount` + `destination`|
 * | :59A: | Beneficiary Customer (BIC)  | `beneficiaryCustomer`               |
 * | :70:  | Remittance Information      | `remittanceInfo` → `memo`           |
 * | :71A: | Details of Charges          | (informational, not mapped)         |
 * | :72:  | Sender-to-Receiver Info     | (informational, not mapped)         |
 *
 * ## Field 32A — Value Date / Currency / Amount
 *
 * Format: `YYMMDD` + ISO-4217 currency code (3 uppercase letters) + amount.
 * The amount uses a comma as the decimal separator per SWIFT convention;
 * this parser normalises it to a period.  A trailing comma (e.g. `USD1000,`)
 * is treated as a whole-number amount.
 *
 * ## Field 59 — Beneficiary Customer
 *
 * The field may start with an account number (IBAN, Stellar address, etc.) on
 * the tag line or on the first continuation line, followed by the beneficiary
 * name on subsequent lines.
 *
 * Parsing priority:
 * 1. A 56-character Stellar public key (`G[A-Z2-7]{55}`) anywhere in the field
 *    value — used directly as the payment destination.
 * 2. An `/`-prefixed IBAN / account string on the first line of the field value
 *    (e.g. `/DE89370400440532013000`).
 * 3. The raw first non-empty line of the field value as a fallback.
 *
 * ## Field 70 — Remittance Information
 *
 * May span multiple continuation lines (each prefixed with `/`).  The parser
 * joins them into a single string, stripping the leading `/` from each line,
 * and trims whitespace.  When field :70: is absent the transaction reference
 * from field :20: is used as the memo.
 *
 * ## Field 50K / 50A — Ordering Customer
 *
 * `:50K:` carries the account number on the first line (possibly on the same
 * line as the tag) and the customer name on subsequent lines.
 * `:50A:` carries only a BIC; both are stored in `orderingCustomer`.
 * The ordering customer field is parsed correctly and does not bleed into
 * the beneficiary destination — fields are isolated by the field-boundary
 * regex.
 *
 * ## Multi-message files
 *
 * A file may contain multiple MT103 messages separated by `{4:` block
 * delimiters.  Each message block is parsed independently.  Messages that lack
 * both a beneficiary destination **and** an amount are silently skipped.
 *
 * ## Field boundary detection
 *
 * Multiline field values (`:50K:`, `:59:`, `:70:`) are captured up to the
 * first of:
 * - a newline followed by the next SWIFT tag (`\r?\n:[0-9A-Z]{2,3}:`), or
 * - the block-end marker (`\r?\n-}`), or
 * - end of string.
 *
 * This three-part lookahead prevents fields from consuming content in the next
 * block when multiple messages are present in the same file.
 */
export function parseMT103(filePath: string): PaymentRecord[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const messages = splitMT103Messages(content);
  return messages
    .map(convertMT103ToPayment)
    .filter((r) => r !== null) as PaymentRecord[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extended internal representation that carries all parsed MT103 fields before
 * the final mapping to PaymentRecord.
 */
interface ParsedMT103 extends MT103Message {
  /** Raw account identifier extracted from field :59: (before Stellar key detection). */
  beneficiaryAccount: string;
}

/**
 * Lookahead pattern that terminates a multiline field capture.
 *
 * Matches immediately before:
 * - the start of any subsequent SWIFT tag (`\r?\n:[0-9A-Z]{2,3}:`), or
 * - the MT103 block-end marker (`\r?\n-}`), or
 * - the end of the string.
 *
 * Including `\r?\n-}` prevents multiline fields at the end of a block from
 * consuming content in the next block when multiple messages are present.
 */
const FIELD_END = /(?=\r?\n:[0-9A-Z]{2,3}:|\r?\n-}|$)/;

function splitMT103Messages(content: string): ParsedMT103[] {
  // An MT103 file consists of one or more message blocks.  Each block begins
  // with `{4:` (SWIFT block 4 delimiter) and ends at the next `{4:` or EOF.
  const messageBlocks = content.split(/\{4:/);
  const messages: ParsedMT103[] = [];

  for (const block of messageBlocks) {
    if (!block.trim()) continue;

    const msg = parseMessageBlock(block);

    // Only keep messages with a usable destination and a non-zero amount.
    if (msg.beneficiaryCustomer && msg.amount) {
      messages.push(msg);
    }
  }

  return messages;
}

/**
 * Build a regex that matches a specific SWIFT tag and captures its (possibly
 * multiline) value, terminating at `FIELD_END`.
 *
 * @param tag  The tag text without colons, e.g. `'50K'`, `'59'`, `'70'`.
 * @returns    A regex with capture group 1 being the raw field value.
 */
function fieldRegex(tag: string): RegExp {
  return new RegExp(`:${tag}:([\\s\\S]*?)` + FIELD_END.source);
}

/**
 * Parse a single MT103 block (the content after `{4:`) into a structured
 * ParsedMT103 object.
 */
function parseMessageBlock(block: string): ParsedMT103 {
  const msg: ParsedMT103 = {
    senderBIC: '',
    receiverBIC: '',
    transactionRef: '',
    valueDate: '',
    currency: '',
    amount: '',
    orderingCustomer: '',
    beneficiaryCustomer: '',
    beneficiaryAccount: '',
    remittanceInfo: '',
  };

  // -------------------------------------------------------------------------
  // :20: Transaction Reference
  // -------------------------------------------------------------------------
  const refMatch = block.match(/:20:([^\r\n]+)/);
  if (refMatch) msg.transactionRef = refMatch[1].trim();

  // -------------------------------------------------------------------------
  // :32A: Value Date / Currency / Amount
  //
  // Format: YYMMDD + 3-letter ISO currency + amount (comma decimal separator,
  // optional trailing comma for whole amounts, e.g. `250101USD1000,`).
  // -------------------------------------------------------------------------
  const valueMatch = block.match(/:32A:(\d{6})([A-Z]{3})([0-9,]+)/);
  if (valueMatch) {
    msg.valueDate = valueMatch[1];
    msg.currency = valueMatch[2];
    // Normalise: replace comma decimal separator with period, strip trailing comma.
    const rawAmount = valueMatch[3].replace(/,$/, '').replace(',', '.');
    msg.amount = rawAmount;
  }

  // -------------------------------------------------------------------------
  // :52A: Ordering Institution (sender BIC)
  // -------------------------------------------------------------------------
  const senderBICMatch = block.match(/:52A:([^\r\n]+)/);
  if (senderBICMatch) msg.senderBIC = senderBICMatch[1].trim();

  // -------------------------------------------------------------------------
  // :57A: Account With Institution (receiver BIC)
  // -------------------------------------------------------------------------
  const receiverBICMatch = block.match(/:57A:([^\r\n]+)/);
  if (receiverBICMatch) msg.receiverBIC = receiverBICMatch[1].trim();

  // -------------------------------------------------------------------------
  // :50K: / :50A: Ordering Customer
  //
  // :50K: format:
  //   :50K:<optional-account-on-same-line>
  //   <name-line-1>
  //   <name-line-2>  (optional)
  //
  // :50A: format:
  //   :50A:<BIC>
  //
  // We capture the entire field value (everything until the next SWIFT tag,
  // the block-end marker, or end of string) and normalise it.
  // -------------------------------------------------------------------------
  const ordering50KMatch = block.match(fieldRegex('50K'));
  if (ordering50KMatch) {
    msg.orderingCustomer = parseMultilineField(ordering50KMatch[1]);
  } else {
    const ordering50AMatch = block.match(/:50A:([^\r\n]+)/);
    if (ordering50AMatch) msg.orderingCustomer = ordering50AMatch[1].trim();
  }

  // -------------------------------------------------------------------------
  // :59: / :59A: Beneficiary Customer
  //
  // Field :59: may include an account on the tag line or the first continuation
  // line, followed by the beneficiary name.  We attempt to find a Stellar
  // public key first (56 chars, starts with G), then an IBAN-style `/`-prefixed
  // account, then fall back to the raw first line.
  //
  // The tag pattern `:59:?` matches both `:59:` (plain) and `:59A:` / `:59B:`
  // variants via the `?` on the optional letter suffix — but we handle :59A:
  // separately below to avoid ambiguity.
  //
  // Field :59A: contains a BIC instead of an account number.
  // -------------------------------------------------------------------------
  const beneficiary59Match = block.match(/:59:([\s\S]*?)(?=\r?\n:[0-9A-Z]{2,3}:|\r?\n-}|$)/);
  if (beneficiary59Match) {
    parseBeneficiaryField(beneficiary59Match[1], msg);
  } else {
    // :59A: — BIC-based beneficiary (less common in direct Stellar use cases)
    const beneficiary59AMatch = block.match(/:59A:([^\r\n]+)/);
    if (beneficiary59AMatch) {
      msg.beneficiaryCustomer = beneficiary59AMatch[1].trim();
      msg.beneficiaryAccount = msg.beneficiaryCustomer;
    }
  }

  // -------------------------------------------------------------------------
  // :70: Remittance Information
  //
  // May span multiple lines; each continuation line starts with `/`.
  // We join them into a single string and strip the leading `/` separators.
  // Falls back to :20: transaction reference when absent.
  // -------------------------------------------------------------------------
  const remittanceMatch = block.match(fieldRegex('70'));
  if (remittanceMatch) {
    msg.remittanceInfo = parseRemittanceField(remittanceMatch[1]);
  }

  return msg;
}

/**
 * Parse field :59: content into msg.beneficiaryCustomer and
 * msg.beneficiaryAccount.
 *
 * Priority:
 * 1. Stellar public key (56 chars, G + base32) anywhere in the field value.
 * 2. IBAN / account prefixed with `/` on the first non-empty line.
 * 3. Raw first non-empty line as fallback.
 */
function parseBeneficiaryField(fieldValue: string, msg: ParsedMT103): void {
  // Priority 1: Stellar public key (56 chars, starts with G, base32 alphabet)
  const stellarKeyMatch = fieldValue.match(/\bG[A-Z2-7]{55}\b/);
  if (stellarKeyMatch) {
    msg.beneficiaryCustomer = stellarKeyMatch[0];
    msg.beneficiaryAccount = stellarKeyMatch[0];
    return;
  }

  // Priority 2: IBAN / account prefixed with /
  const ibanMatch = fieldValue.match(/^\/([^\r\n]+)/m);
  if (ibanMatch) {
    msg.beneficiaryAccount = ibanMatch[1].trim();
    // The account acts as the destination; name lines are informational only.
    msg.beneficiaryCustomer = msg.beneficiaryAccount;
    return;
  }

  // Priority 3: Raw first non-empty line
  const firstLine = fieldValue.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  msg.beneficiaryCustomer = firstLine;
  msg.beneficiaryAccount = firstLine;
}

/**
 * Parse a multiline MT103 field value into a single trimmed string.
 * Each line is stripped of leading/trailing whitespace; empty lines are dropped.
 */
function parseMultilineField(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Parse a SWIFT :70: remittance field.
 *
 * SWIFT line continuation uses `/` as a line separator within structured
 * narrative codes (e.g. `/INV/2024-001/RFB/PO-456`).  We strip the leading
 * slash from each continuation line and join with a space so the result is
 * human-readable while preserving all structured codes.
 */
function parseRemittanceField(raw: string): string {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines
    .map((l) => (l.startsWith('/') ? l.slice(1) : l))
    .join(' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Conversion: ParsedMT103 → PaymentRecord
// ---------------------------------------------------------------------------

/**
 * Maps ISO-4217 currency codes commonly found in MT103 messages to the
 * corresponding Stellar/Soroban asset codes used in this SDK.
 *
 * Currencies not listed here pass through unchanged (e.g. `GBP` → `GBP`).
 * This avoids silently coercing unknown currencies to `USDC`.
 */
const CURRENCY_TO_ASSET: Record<string, string> = {
  USD: 'USDC',
  EUR: 'EURC',
  GBP: 'GBP',
  MXN: 'MXN',
  BRL: 'BRL',
  NGN: 'NGN',
  KES: 'KES',
  PHP: 'PHP',
  INR: 'INR',
  JPY: 'JPY',
  AED: 'AED',
  CNY: 'CNY',
  SGD: 'SGD',
  HKD: 'HKD',
};

function convertMT103ToPayment(msg: ParsedMT103): PaymentRecord | null {
  const destination = msg.beneficiaryAccount || msg.beneficiaryCustomer;

  // Require a usable destination and a non-zero amount.
  if (!destination || !msg.amount) return null;

  // Prefer remittance info as memo; fall back to transaction reference.
  // Memos are capped at 28 bytes for Stellar text memos — truncation happens
  // in the transaction builder, not here, so we store the full value.
  const memo = msg.remittanceInfo || msg.transactionRef || '';

  return {
    destination,
    amount: msg.amount,
    // Unknown currencies pass through unchanged rather than defaulting to USDC.
    asset: CURRENCY_TO_ASSET[msg.currency] ?? msg.currency,
    asset_issuer: '',
    memo,
    // Default to 24-hour escrow for SWIFT bank transfers, matching the typical
    // same-day SWIFT settlement window.
    escrow_duration: 86400,
  };
}
