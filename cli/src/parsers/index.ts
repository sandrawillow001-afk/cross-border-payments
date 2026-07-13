import { PaymentRecord, InputFormat } from '../types';
import { parseCSV } from './csv-parser';
import { parseJSON } from './json-parser';
import { parseXLSX } from './xlsx-parser';
import { parseMT103 } from './mt103-parser';

export function parseInputFile(filePath: string, format: InputFormat): PaymentRecord[] {
  switch (format) {
    case InputFormat.CSV:
      return parseCSV(filePath);
    case InputFormat.JSON:
      return parseJSON(filePath);
    case InputFormat.XLSX:
      return parseXLSX(filePath);
    case InputFormat.MT103:
      return parseMT103(filePath);
    default:
      throw new Error(`Unsupported input format: ${format}`);
  }
}

export function detectFormat(filePath: string): InputFormat {
  // Normalize the file extension to lowercase before matching so uppercase or
  // mixed-case extensions (e.g. .CSV, .XLSX, .MT103) are detected correctly.
  const ext = (filePath.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'csv':
      return InputFormat.CSV;
    case 'json':
      return InputFormat.JSON;
    case 'xlsx':
    case 'xls':
      return InputFormat.XLSX;
    case 'mt103':
    case 'swift':
    case 'txt':
      return InputFormat.MT103;
    default:
      return InputFormat.CSV;
  }
}

export { parseCSV, parseJSON, parseXLSX, parseMT103 };
