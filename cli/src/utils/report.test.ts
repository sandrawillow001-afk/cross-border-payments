import {
  normalizeReportFormat,
  defaultReportOutputPath,
  SUPPORTED_REPORT_FORMATS,
} from './report';
import { ReportFormat } from '../types';

describe('normalizeReportFormat', () => {
  test('accepts lowercase csv and pdf', () => {
    expect(normalizeReportFormat('csv')).toBe(ReportFormat.CSV);
    expect(normalizeReportFormat('pdf')).toBe(ReportFormat.PDF);
  });

  test('is case-insensitive', () => {
    expect(normalizeReportFormat('CSV')).toBe(ReportFormat.CSV);
    expect(normalizeReportFormat('Pdf')).toBe(ReportFormat.PDF);
    expect(normalizeReportFormat('PDF')).toBe(ReportFormat.PDF);
  });

  test('ignores surrounding whitespace', () => {
    expect(normalizeReportFormat('  pdf  ')).toBe(ReportFormat.PDF);
  });

  test('throws on an unsupported format, listing the supported ones', () => {
    expect(() => normalizeReportFormat('json')).toThrow(/Unsupported report format "json"/);
    expect(() => normalizeReportFormat('json')).toThrow(/csv, pdf/);
  });

  test('throws on an empty format', () => {
    expect(() => normalizeReportFormat('')).toThrow(/Unsupported report format/);
  });

  test('only csv and pdf are supported', () => {
    expect(SUPPORTED_REPORT_FORMATS).toEqual([ReportFormat.CSV, ReportFormat.PDF]);
  });
});

describe('defaultReportOutputPath', () => {
  test('builds a predictable name with the csv extension', () => {
    expect(defaultReportOutputPath('batch-123', ReportFormat.CSV)).toBe(
      'stellar-payout-report-batch-123.csv'
    );
  });

  test('builds a predictable name with the pdf extension', () => {
    expect(defaultReportOutputPath('batch-123', ReportFormat.PDF)).toBe(
      'stellar-payout-report-batch-123.pdf'
    );
  });

  test('extension always matches the validated format', () => {
    const fmt = normalizeReportFormat('PDF');
    expect(defaultReportOutputPath('abc', fmt).endsWith('.pdf')).toBe(true);
  });
});
