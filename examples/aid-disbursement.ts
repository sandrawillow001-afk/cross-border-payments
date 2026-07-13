/**
 * UNHCR-Style Rapid Response Aid Disbursement Example
 *
 * Demonstrates how humanitarian organizations can use the stellar-payout CLI
 * to rapidly distribute emergency funds to beneficiaries across multiple
 * countries and currencies.
 *
 * Features demonstrated:
 * - Batch processing of aid payments from a structured dataset
 * - Multi-currency disbursement (USDC, local currencies)
 * - Dry-run simulation before actual disbursement
 * - Compliance audit trail generation
 * - Emergency stop handling for operational safety
 *
 * Usage:
 *   npx ts-node examples/aid-disbursement.ts
 *
 * Or use the CLI directly:
 *   stellar-payout batch --input aid-payments.csv --dry-run --network testnet \
 *     --source-secret YOUR_SECRET_KEY
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Beneficiary {
  id: string;
  name: string;
  stellarAddress: string;
  country: string;
  currency: string;
  monthlyAllowance: number;
  category: 'refugee' | 'idp' | 'host_community' | 'emergency';
  registrationDate: string;
}

interface DisbursementPlan {
  programId: string;
  programName: string;
  fundingSource: string;
  totalBudget: number;
  currency: string;
  disbursementDate: string;
  beneficiaries: Beneficiary[];
}

interface DisbursementResult {
  batchId: string;
  totalBeneficiaries: number;
  totalAmount: number;
  currency: string;
  csvPath: string;
  reportPath: string;
}

// ---------------------------------------------------------------------------
// Sample data — UNHCR-style rapid response beneficiary registry
// ---------------------------------------------------------------------------

const SAMPLE_BENEFICIARIES: Beneficiary[] = [
  // Jordan — Syrian refugees
  { id: 'BEN-JO-001', name: 'Ahmad K.', stellarAddress: 'GBDEVU63Y6NTHJQQZIKVTC23NWLUJ24SF72O7YVEZ7Y33DOKFLXQMX5F', country: 'JO', currency: 'USDC', monthlyAllowance: 175, category: 'refugee', registrationDate: '2024-01-15' },
  { id: 'BEN-JO-002', name: 'Fatima S.', stellarAddress: 'GCFONE23AB7Y5TR4GLRD3WHP64AYHTZMAHASKYIWDOBNHSXKGEJM7AOD', country: 'JO', currency: 'USDC', monthlyAllowance: 225, category: 'refugee', registrationDate: '2024-02-10' },
  { id: 'BEN-JO-003', name: 'Omar M.', stellarAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEBD9AFZQ7TM4JRS9A', country: 'JO', currency: 'USDC', monthlyAllowance: 150, category: 'refugee', registrationDate: '2024-01-20' },

  // Kenya — Somali refugees
  { id: 'BEN-KE-001', name: 'Abdi H.', stellarAddress: 'GBHUSIZZ7QDBNSA2GJOOAGCXNFGL5MXQNZFBV6PWHRMXNU4GF2RFKXQB', country: 'KE', currency: 'KES', monthlyAllowance: 8500, category: 'refugee', registrationDate: '2024-03-01' },
  { id: 'BEN-KE-002', name: 'Halima O.', stellarAddress: 'GCZFMH32MF5EAWETZTKF3ZV5SEVJPI53UEMDNSW55WBR75GMZJU4U573', country: 'KE', currency: 'KES', monthlyAllowance: 12000, category: 'refugee', registrationDate: '2024-03-05' },
  { id: 'BEN-KE-003', name: 'Hassan A.', stellarAddress: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOBD3EPMMDN5RDCJ', country: 'KE', currency: 'KES', monthlyAllowance: 9500, category: 'host_community', registrationDate: '2024-03-10' },

  // Uganda — DRC refugees
  { id: 'BEN-UG-001', name: 'Jean-Pierre M.', stellarAddress: 'GCFXHS4GXL6BVUCXBX7BI67A7VI75MVUS7OFREPM6MGX4BP2VYJ3LEMP', country: 'UG', currency: 'USDC', monthlyAllowance: 120, category: 'refugee', registrationDate: '2024-04-01' },
  { id: 'BEN-UG-002', name: 'Marie C.', stellarAddress: 'GBSTRUSD7IRX73RQZBL3RQUH6KS3O4NYFY3QCALDLZD77XMZOPWAVTUK', country: 'UG', currency: 'USDC', monthlyAllowance: 180, category: 'refugee', registrationDate: '2024-04-05' },

  // Colombia — Venezuelan refugees
  { id: 'BEN-CO-001', name: 'Carlos R.', stellarAddress: 'GDNSSYSCSSJ76FER5CPXS3K7MAPHXPUGSYRM7XGJDBZFBHPP6RENXDXV', country: 'CO', currency: 'USDC', monthlyAllowance: 200, category: 'refugee', registrationDate: '2024-02-20' },
  { id: 'BEN-CO-002', name: 'Maria V.', stellarAddress: 'GBCXQUEPSEGIKXLYOIFOV4FXUCMDV5BPWMG5WOA4EFNRHDKFORSXI2JR', country: 'CO', currency: 'USDC', monthlyAllowance: 250, category: 'refugee', registrationDate: '2024-02-25' },

  // Bangladesh — Rohingya refugees
  { id: 'BEN-BD-001', name: 'Mohammed R.', stellarAddress: 'GDZST3XVCDTUJ76ZAV2HA72KYQODXXZ5PTBIATBKAV4GNCGIIXHGCQSP', country: 'BD', currency: 'USDC', monthlyAllowance: 100, category: 'refugee', registrationDate: '2024-05-01' },
  { id: 'BEN-BD-002', name: 'Rashida B.', stellarAddress: 'GCXKG6RN4ONIEPCMNFB732A436Z5PNDSRLGWK7GBLCMQLIQI4MLNXHAD', country: 'BD', currency: 'USDC', monthlyAllowance: 130, category: 'refugee', registrationDate: '2024-05-05' },

  // Emergency — rapid response
  { id: 'BEN-EM-001', name: 'Emergency Site Alpha', stellarAddress: 'GBHPVQK7WSHF35H6BRWXAVMRGLCZFVQ4DIOQN33MBCIZ4MDLQP5YHJUR', country: 'SD', currency: 'USDC', monthlyAllowance: 5000, category: 'emergency', registrationDate: '2024-06-01' },
  { id: 'BEN-EM-002', name: 'Emergency Site Beta', stellarAddress: 'GDEAOZWTVHQZGGJV6R4XO3BVHYZ7EIKRVRCWFBQN5DJYQRBPGCEJADND', country: 'SD', currency: 'USDC', monthlyAllowance: 7500, category: 'emergency', registrationDate: '2024-06-01' },
];

// ---------------------------------------------------------------------------
// Disbursement helpers
// ---------------------------------------------------------------------------

function createDisbursementPlan(): DisbursementPlan {
  const today = new Date().toISOString().split('T')[0];
  return {
    programId: `UNHCR-RPD-${today.replace(/-/g, '')}`,
    programName: 'Multi-Country Cash Assistance Program',
    fundingSource: 'CERF Rapid Response Fund',
    totalBudget: 500000,
    currency: 'USDC',
    disbursementDate: today,
    beneficiaries: SAMPLE_BENEFICIARIES,
  };
}

function generatePaymentCSV(plan: DisbursementPlan, outputDir: string): string {
  const csvPath = path.join(outputDir, `aid-disbursement-${plan.programId}.csv`);
  const headers = 'destination,amount,asset,memo,escrow_duration';
  const rows = plan.beneficiaries.map((b) => {
    const memo = `${plan.programId}-${b.id}`.substring(0, 28);
    // Emergency allocations are immediate (no escrow), others have 48h escrow
    const escrowDuration = b.category === 'emergency' ? 0 : 172800;
    return `${b.stellarAddress},${b.monthlyAllowance.toFixed(2)},${b.currency},${memo},${escrowDuration}`;
  });

  const content = [headers, ...rows].join('\n') + '\n';
  fs.writeFileSync(csvPath, content);
  return csvPath;
}

function printPlan(plan: DisbursementPlan): void {
  console.log('\n' + '='.repeat(70));
  console.log('  UNHCR Rapid Response — Disbursement Plan');
  console.log('='.repeat(70));
  console.log(`  Program ID:     ${plan.programId}`);
  console.log(`  Program Name:   ${plan.programName}`);
  console.log(`  Funding Source: ${plan.fundingSource}`);
  console.log(`  Date:           ${plan.disbursementDate}`);
  console.log(`  Total Budget:   ${plan.totalBudget.toLocaleString()} ${plan.currency}`);
  console.log(`  Beneficiaries:  ${plan.beneficiaries.length}`);
  console.log('='.repeat(70));

  // Country breakdown
  const byCountry: Record<string, { count: number; amount: number }> = {};
  for (const b of plan.beneficiaries) {
    if (!byCountry[b.country]) byCountry[b.country] = { count: 0, amount: 0 };
    byCountry[b.country].count++;
    byCountry[b.country].amount += b.monthlyAllowance;
  }

  console.log('\n  Country Breakdown:');
  console.log('  ' + '-'.repeat(50));
  for (const [country, data] of Object.entries(byCountry)) {
    console.log(`    ${country}: ${data.count} beneficiaries, ${data.amount.toLocaleString()} total`);
  }

  // Category breakdown
  const byCategory: Record<string, number> = {};
  for (const b of plan.beneficiaries) {
    byCategory[b.category] = (byCategory[b.category] || 0) + 1;
  }

  console.log('\n  Category Breakdown:');
  console.log('  ' + '-'.repeat(50));
  for (const [category, count] of Object.entries(byCategory)) {
    console.log(`    ${category}: ${count} beneficiaries`);
  }

  const totalDisbursement = plan.beneficiaries.reduce((sum, b) => sum + b.monthlyAllowance, 0);
  console.log(`\n  Total Disbursement: ${totalDisbursement.toLocaleString()}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Main disbursement flow
// ---------------------------------------------------------------------------

async function runAidDisbursement(): Promise<DisbursementResult | null> {
  console.log('\n  UNHCR-Style Rapid Response Aid Disbursement');
  console.log('  Using stellar-payout CLI for batch processing\n');

  // Step 1: Create the disbursement plan
  console.log('Step 1: Creating disbursement plan...');
  const plan = createDisbursementPlan();
  printPlan(plan);

  // Step 2: Generate payment CSV
  console.log('Step 2: Generating payment CSV...');
  const outputDir = path.dirname(__filename);
  const csvPath = generatePaymentCSV(plan, outputDir);
  console.log(`  CSV generated: ${csvPath}`);
  console.log(`  Records: ${plan.beneficiaries.length}\n`);

  // Step 3: Validate the batch (dry run)
  console.log('Step 3: Running dry-run validation...');
  console.log('  Command: stellar-payout batch --input <csv> --dry-run --network testnet\n');

  // In a real deployment, you would run:
  // execSync(`stellar-payout batch --input ${csvPath} --dry-run --network testnet --source-secret $SOURCE_SECRET`);

  console.log('  [Dry run would validate all addresses and simulate transactions]\n');

  // Step 4: Execute the batch (in production)
  console.log('Step 4: Execute batch disbursement...');
  console.log('  In production, run:');
  console.log(`    stellar-payout batch \\`);
  console.log(`      --input ${csvPath} \\`);
  console.log(`      --network testnet \\`);
  console.log(`      --source-secret $SOURCE_SECRET \\`);
  console.log(`      --max-ops 100 \\`);
  console.log(`      --concurrency 5 \\`);
  console.log(`      --fee-surge-threshold 100\n`);

  // Step 5: Monitor status
  console.log('Step 5: Monitor disbursement status...');
  console.log('  Command: stellar-payout status --batch-id <batch_id> --follow\n');

  // Step 6: Generate compliance report
  const batchId = crypto.randomBytes(8).toString('hex');
  console.log('Step 6: Generate compliance audit report...');
  console.log(`  Command: stellar-payout report --batch-id ${batchId} --format pdf\n`);

  // Step 7: Handle failures
  console.log('Step 7: Retry any failed payments...');
  console.log(`  Command: stellar-payout retry --batch-id ${batchId} --max-retries 3\n`);

  // Summary
  const totalAmount = plan.beneficiaries.reduce((sum, b) => sum + b.monthlyAllowance, 0);
  console.log('='.repeat(70));
  console.log('  Disbursement Flow Summary');
  console.log('='.repeat(70));
  console.log(`  Program:        ${plan.programName}`);
  console.log(`  Beneficiaries:  ${plan.beneficiaries.length}`);
  console.log(`  Total Amount:   ${totalAmount.toLocaleString()} (mixed currencies)`);
  console.log(`  Countries:      ${new Set(plan.beneficiaries.map(b => b.country)).size}`);
  console.log(`  Currencies:     ${new Set(plan.beneficiaries.map(b => b.currency)).size}`);
  console.log(`  Payment CSV:    ${csvPath}`);
  console.log('='.repeat(70));
  console.log('\n  For production use, ensure:');
  console.log('  1. Source account is funded with sufficient balance');
  console.log('  2. All beneficiary addresses have been KYC-verified');
  console.log('  3. Trustlines are established for non-native assets');
  console.log('  4. Compliance checks have been completed');
  console.log('  5. Emergency stop procedures are documented\n');

  return {
    batchId,
    totalBeneficiaries: plan.beneficiaries.length,
    totalAmount,
    currency: 'MIXED',
    csvPath,
    reportPath: `stellar-payout-report-${batchId}.pdf`,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  runAidDisbursement()
    .then((result) => {
      if (result) {
        console.log('  Aid disbursement example completed successfully.');
      }
    })
    .catch((err) => {
      console.error('  Aid disbursement failed:', err);
      process.exit(1);
    });
}

export { runAidDisbursement, createDisbursementPlan, generatePaymentCSV, DisbursementPlan, DisbursementResult };
