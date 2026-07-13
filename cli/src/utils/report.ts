import { ReportFormat } from '../types';

/** The report formats the CLI supports, lowercase. */
export const SUPPORTED_REPORT_FORMATS: ReportFormat[] = [
  ReportFormat.CSV,
  ReportFormat.PDF,
];

/**
 * Validate and normalize a `--format` value for the report command.
 *
 * Accepts `csv` or `pdf` in any case (and ignores surrounding whitespace), and
 * throws a clear error for anything else so an unsupported format fails fast
 * before any work or file I/O happens.
 */
export function normalizeReportFormat(input: string): ReportFormat {
  const normalized = (input ?? '').trim().toLowerCase();
  if (normalized === ReportFormat.CSV) {
    return ReportFormat.CSV;
  }
  if (normalized === ReportFormat.PDF) {
    return ReportFormat.PDF;
  }
  throw new Error(
    `Unsupported report format "${input}". Supported formats: ${SUPPORTED_REPORT_FORMATS.join(', ')}.`
  );
}

/**
 * Build the default output path for a report when `--output` is omitted, so the
 * file name is always predictable and carries the correct extension for the
 * (already validated) format.
 */
export function defaultReportOutputPath(batchId: string, format: ReportFormat): string {
  return `stellar-payout-report-${batchId}.${format}`;
}
