# Performance Expectations

## Rate Oracle Aggregation

| Sources | Expected throughput |
|---------|-------------------|
| 5       | > 500,000 ops/sec |
| 100     | > 50,000 ops/sec  |

Run: `npm run bench:oracle`

## Batch Submission (validation only, no network)

| Batch size | Expected throughput |
|------------|-------------------|
| 100        | > 100,000 rec/sec |
| 1,000      | > 80,000 rec/sec  |
| 10,000     | > 50,000 rec/sec  |

Run: `npm run bench:batch`

## Real-world network throughput
Horizon testnet typically processes 50–100 tx/sec sustained.
For large batches (> 500 payments), use the `--dry-run` flag first
to validate all records before submission.

## Re-running benchmarks
Benchmarks are deterministic (no network I/O) and should be
re-run after any changes to rate aggregation or batch validation logic.