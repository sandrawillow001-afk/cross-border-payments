/**
 * Benchmark: Rate oracle aggregation throughput
 * Run with: npx ts-node benchmarks/rate-oracle.bench.ts
 */
import { performance } from 'perf_hooks';

// Replace with your actual rate aggregation import
// import { aggregateRates } from '../sdk/src/rateOracle';

function mockAggregateRates(sources: number[]): number {
  // Simulate median aggregation
  const sorted = [...sources].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

interface BenchResult {
  label:      string;
  iterations: number;
  totalMs:    number;
  avgMs:      number;
  opsPerSec:  number;
}

function bench(label: string, fn: () => void, iterations = 10_000): BenchResult {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs   = performance.now() - start;
  const avgMs     = totalMs / iterations;
  const opsPerSec = Math.round(1000 / avgMs);
  return { label, iterations, totalMs: +totalMs.toFixed(2), avgMs: +avgMs.toFixed(4), opsPerSec };
}

function printResult(r: BenchResult) {
  console.log(`\n📊 ${r.label}`);
  console.log(`   Iterations : ${r.iterations.toLocaleString()}`);
  console.log(`   Total time : ${r.totalMs}ms`);
  console.log(`   Avg/op     : ${r.avgMs}ms`);
  console.log(`   Ops/sec    : ${r.opsPerSec.toLocaleString()}`);
}

console.log('=== Rate Oracle Benchmarks ===\n');

const RATE_SOURCES_SMALL  = [0.112, 0.113, 0.111, 0.114, 0.112];
const RATE_SOURCES_LARGE  = Array.from({ length: 100 }, (_, i) => 0.100 + i * 0.001);

printResult(bench('Aggregate 5 rate sources',  () => mockAggregateRates(RATE_SOURCES_SMALL)));
printResult(bench('Aggregate 100 rate sources', () => mockAggregateRates(RATE_SOURCES_LARGE), 1_000));

console.log('\n✅ Done');