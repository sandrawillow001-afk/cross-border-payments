import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import { PaymentRecord } from '../types';

export function parseCSV(filePath: string): PaymentRecord[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    cast: (value: string, context: { column: string | number }) => {
      if (context.column === 'escrow_duration') {
        return parseInt(value, 10) || 0;
      }
      return value;
    },
  }) as Array<Record<string, string | number>>;

  return records.map((row) => ({
    destination: String(row.destination || ''),
    amount: String(row.amount || '0'),
    asset: String(row.asset || 'XLM'),
    asset_issuer: String(row.asset_issuer || ''),
    memo: String(row.memo || ''),
    escrow_duration: Number(row.escrow_duration) || 0,
  }));
}
