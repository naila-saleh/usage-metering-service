# Performance Test Results

## Overview

This report documents the performance test for the Usage Metering Service. The test is implemented in `src/services/performance.test.ts` and exercises the `POST /usage/consume` endpoint through the running Express application.

The primary scenario sends 100 concurrent requests. Each request consumes one usage unit for the same test user and account. The test verifies that all 100 requests succeed and that both the account and user usage totals equal 100.

## Test environment and execution

The performance test is run with the project's `test:performance` script:

```text
npm run test:performance
```

That script:

- sets `NODE_ENV=test`;
- loads environment variables from `.env.test` using `dotenv-cli`;
- runs Vitest in non-watch mode with `--run`;
- excludes files under `dist`; and
- targets `src/services/performance.test.ts`.

The test starts the Express application on `127.0.0.1` using an operating-system-assigned port. It creates temporary test accounts and users using the configured test database, obtains their API keys, and removes the test data and closes the server after the tests complete. The database must therefore be available with the test configuration. Before the test runs, the plans and subplans looked up by `beforeAll` must exist: Account Plans with Starter and Pro subplans, and User Plans with Basic and Premium subplans. The performance test does not create these records. The repository's `seed` and `seed:test` scripts can create them when missing, but `npm run test:performance` does not run seeding or migrations automatically.

No hardware or software specifications beyond the repository configuration are assumed in this report. Timing results can vary with the local machine, database, operating-system scheduling, network stack, and current system load.

## Methodology and metrics

For each of the 100 requests, the test records the elapsed time from immediately before `fetch` to immediately after the response is received. It also records the elapsed time for the complete batch, from launching the concurrent requests until all responses have been received.

The metrics are calculated as follows:

- **Total duration:** elapsed time for the complete batch of 100 concurrent requests, in milliseconds.
- **Average latency:** arithmetic mean of the 100 individual request times, in milliseconds.
- **Throughput (RPS):** `100 / (total duration in milliseconds / 1000)`, or equivalently `100,000 / total duration in milliseconds`.
- **p95 response time:** the response time at the index `ceil(0.95 × 100) - 1` after the 100 individual response times are sorted in ascending order. This is the 95th-percentile value used by the test.

The test also counts HTTP 200 responses and HTTP 403 responses. It requires 100 successful responses and zero rejected responses. It then requests the usage summary and requires `summary.account.used` and `summary.user.used` to both equal 100.

## Results

The table below contains measurements recorded during five executions of the main performance test. The repository does not contain individual output logs or stored measurement files for those executions. Running `npm run test:performance` again will execute the test and print new measurements, but will not necessarily reproduce these historical values.

| Run | Total Duration (ms) | Average Latency (ms) | RPS | p95 (ms) |
|---:|---:|---:|---:|---:|
| 1 | 631.55 | 383.08 | 158.34 | 600.30 |
| 2 | 634.77 | 380.34 | 157.54 | 604.41 |
| 3 | 619.37 | 372.95 | 161.45 | 590.19 |
| 4 | 666.06 | 396.38 | 150.14 | 636.44 |
| 5 | 596.24 | 352.65 | 167.72 | 567.03 |
| **Average** | **629.60** | **377.08** | **159.04** | **599.67** |

All five runs passed the test assertions for the main scenario:

- 100 of 100 requests returned HTTP 200.
- 0 requests returned HTTP 403.
- The account usage total was 100 units.
- The user usage total was 100 units.

## Additional quota-limit test

The same test file contains a separate scenario for behavior near a quota limit. It first sends nine sequential requests consuming 10 units each and one sequential request consuming 9 units, bringing the usage to 99 units. It then sends 10 concurrent requests consuming one unit each.

That scenario expects exactly one HTTP 200 response and nine HTTP 403 responses, and verifies that the account and user usage totals are both 100. It also logs the same duration, average latency, RPS, and p95-style measurements for that group of 10 requests, but the five-run results reported above are for the separate 100-request successful scenario.

## Conclusions

The observed averages across the five recorded runs were 629.60 ms for total batch duration, 377.08 ms for average per-request latency, 159.04 requests per second for throughput, and 599.67 ms for p95 response time. For those executions, the test assertions also passed consistently: each main scenario returned 100 HTTP 200 responses and zero HTTP 403 responses, and the reported account and user usage totals were both 100 units.

These observations describe a batch of exactly 100 concurrent requests in the environment where the measurements were recorded. They are not a benchmark proving the service's maximum capacity or sustained-load performance, and they do not guarantee quota correctness under every possible concurrency pattern or workload. Different environments and workloads may produce different results.