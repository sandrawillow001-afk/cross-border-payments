import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify/sync';
import PDFDocument from 'pdfkit';
import { ReportOptions, ReportFormat, BatchEntryStatus } from '../types';
import { BatchDatabase } from '../utils/database';
import * as logger from '../utils/logger';
import { defaultReportOutputPath } from '../utils/report';

export async function executeReport(options: ReportOptions): Promise<void> {
  const db = new BatchDatabase(options.dbPath);

  logger.banner('Stellar Payout - Compliance Report');

  const batch = db.getBatch(options.batchId);
  if (!batch) {
    logger.error(`Batch not found: ${options.batchId}`);
    db.close();
    return;
  }

  const entries = db.getEntries(options.batchId);
  const groups = db.getGroups(options.batchId);

  logger.info(`Generating ${options.format.toUpperCase()} report for batch ${options.batchId}`);
  logger.info(`Total entries: ${entries.length}`);

  const outputPath =
    options.outputPath || defaultReportOutputPath(options.batchId, options.format);

  switch (options.format) {
    case ReportFormat.CSV:
      generateCSVReport(batch, entries, groups, outputPath);
      break;
    case ReportFormat.PDF:
      await generatePDFReport(batch, entries, groups, outputPath);
      break;
    default:
      logger.error(`Unsupported report format: ${options.format}`);
      db.close();
      return;
  }

  logger.success(`Report generated: ${path.resolve(outputPath)}`);
  db.close();
}

function generateCSVReport(
  batch: ReturnType<BatchDatabase['getBatch']>,
  entries: ReturnType<BatchDatabase['getEntries']>,
  groups: ReturnType<BatchDatabase['getGroups']>,
  outputPath: string
): void {
  if (!batch) return;

  // Summary section
  const summaryRows = [
    ['Report Type', 'Stellar Payout Batch Compliance Report'],
    ['Generated At', new Date().toISOString()],
    ['Batch ID', batch.batchId],
    ['Network', batch.network],
    ['Source Account', batch.sourceAccount],
    ['Status', batch.status],
    ['Total Payments', String(batch.totalPayments)],
    ['Successful', String(batch.successfulPayments)],
    ['Failed', String(batch.failedPayments)],
    ['Skipped', String(batch.skippedPayments)],
    ['Started At', new Date(batch.startedAt).toISOString()],
    ['Completed At', batch.completedAt ? new Date(batch.completedAt).toISOString() : 'N/A'],
    ['Dry Run', batch.dryRun ? 'Yes' : 'No'],
    [],
    ['--- Payment Details ---'],
  ];

  const entryHeaders = [
    'Index',
    'Destination',
    'Amount',
    'Asset',
    'Memo',
    'Escrow Duration (s)',
    'Status',
    'Tx Hash',
    'Error',
    'Retry Count',
    'Submitted At',
    'Completed At',
  ];

  const entryRows = entries.map((e) => [
    String(e.index),
    e.destination,
    e.amount,
    e.asset,
    e.memo,
    String(e.escrow_duration),
    e.status,
    e.txHash,
    e.error,
    String(e.retryCount),
    e.submittedAt ? new Date(e.submittedAt).toISOString() : '',
    e.completedAt ? new Date(e.completedAt).toISOString() : '',
  ]);

  const allRows = [...summaryRows, entryHeaders, ...entryRows];
  const csvContent = stringify(allRows);
  fs.writeFileSync(outputPath, csvContent);
}

async function generatePDFReport(
  batch: ReturnType<BatchDatabase['getBatch']>,
  entries: ReturnType<BatchDatabase['getEntries']>,
  groups: ReturnType<BatchDatabase['getGroups']>,
  outputPath: string
): Promise<void> {
  if (!batch) return;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(outputPath);

    doc.pipe(stream);

    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('Stellar Payout', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Batch Compliance Audit Report', { align: 'center' });
    doc.moveDown();

    // Batch Summary
    doc.fontSize(16).font('Helvetica-Bold').text('Batch Summary');
    doc.moveDown(0.5);

    const summaryData = [
      ['Batch ID', batch.batchId],
      ['Network', batch.network],
      ['Source Account', batch.sourceAccount],
      ['Status', batch.status],
      ['Total Payments', String(batch.totalPayments)],
      ['Successful', String(batch.successfulPayments)],
      ['Failed', String(batch.failedPayments)],
      ['Skipped', String(batch.skippedPayments)],
      ['Started At', new Date(batch.startedAt).toISOString()],
      ['Completed At', batch.completedAt ? new Date(batch.completedAt).toISOString() : 'In Progress'],
      ['Dry Run', batch.dryRun ? 'Yes' : 'No'],
      ['Generated At', new Date().toISOString()],
    ];

    doc.fontSize(10).font('Helvetica');
    for (const [label, value] of summaryData) {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }

    doc.moveDown();

    // Statistics
    doc.fontSize(16).font('Helvetica-Bold').text('Statistics');
    doc.moveDown(0.5);

    const duration = batch.completedAt
      ? ((batch.completedAt - batch.startedAt) / 1000).toFixed(1)
      : 'N/A';
    const successRate = batch.totalPayments > 0
      ? ((batch.successfulPayments / batch.totalPayments) * 100).toFixed(1)
      : '0';

    doc.fontSize(10).font('Helvetica');
    doc.text(`Processing Duration: ${duration}s`);
    doc.text(`Success Rate: ${successRate}%`);
    doc.text(`Average Operations per Transaction: ${groups.length > 0 ? Math.ceil(entries.length / groups.length) : 0}`);
    doc.text(`Transaction Groups: ${groups.length}`);

    doc.moveDown();

    // Asset breakdown
    const assetBreakdown: Record<string, { count: number; totalAmount: number }> = {};
    entries.forEach((e) => {
      if (!assetBreakdown[e.asset]) {
        assetBreakdown[e.asset] = { count: 0, totalAmount: 0 };
      }
      assetBreakdown[e.asset].count++;
      assetBreakdown[e.asset].totalAmount += parseFloat(e.amount) || 0;
    });

    doc.fontSize(16).font('Helvetica-Bold').text('Asset Breakdown');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    for (const [asset, data] of Object.entries(assetBreakdown)) {
      doc.text(`${asset}: ${data.count} payments, total ${data.totalAmount.toFixed(2)}`);
    }

    doc.moveDown();

    // Payment Details (limited to first 100 for PDF readability)
    doc.fontSize(16).font('Helvetica-Bold').text('Payment Details');
    doc.moveDown(0.5);

    const displayEntries = entries.slice(0, 100);
    doc.fontSize(8).font('Helvetica');

    for (const entry of displayEntries) {
      const statusIcon = entry.status === BatchEntryStatus.Confirmed ? '[OK]'
        : entry.status === BatchEntryStatus.Failed ? '[FAIL]'
        : `[${entry.status.toUpperCase()}]`;

      doc.text(
        `#${entry.index} ${statusIcon} ${entry.destination.substring(0, 20)}... | ${entry.amount} ${entry.asset} | ${entry.txHash ? entry.txHash.substring(0, 16) + '...' : 'N/A'}`,
        { lineGap: 2 }
      );

      if (entry.error) {
        doc.fillColor('red').text(`  Error: ${entry.error.substring(0, 60)}`, { lineGap: 2 });
        doc.fillColor('black');
      }
    }

    if (entries.length > 100) {
      doc.moveDown();
      doc.text(`... and ${entries.length - 100} more entries (see CSV report for full details)`);
    }

    // Failed Entries Detail
    const failedEntries = entries.filter((e) => e.status === BatchEntryStatus.Failed);
    if (failedEntries.length > 0) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('Failed Entries Detail');
      doc.moveDown(0.5);
      doc.fontSize(9).font('Helvetica');

      for (const entry of failedEntries.slice(0, 50)) {
        doc.font('Helvetica-Bold').text(`Entry #${entry.index}:`);
        doc.font('Helvetica');
        doc.text(`  Destination: ${entry.destination}`);
        doc.text(`  Amount: ${entry.amount} ${entry.asset}`);
        doc.text(`  Error: ${entry.error}`);
        doc.text(`  Retry Count: ${entry.retryCount}`);
        doc.moveDown(0.3);
      }
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica').fillColor('gray');
    doc.text('This report was generated by stellar-payout CLI for compliance audit purposes.', { align: 'center' });
    doc.text(`Report generated at ${new Date().toISOString()}`, { align: 'center' });

    doc.end();

    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}
