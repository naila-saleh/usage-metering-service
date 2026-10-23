# Performance Test Results

## Overview

This report documents the three performance scenarios implemented in `src/services/performance.test.ts`. Each scenario sends concurrent `POST /usage/consume` requests through the Express application and records batch duration, average response time, throughput, and P95 response time.

The results below are the measurements supplied from successful executions of the test. The test environment's hardware and software specifications were not recorded, so these values should be interpreted as environment-dependent observations rather than universal performance guarantees.

## Test command and methodology

Run the performance tests with:

```text
npm run test:performance
```

The command runs Vitest in non-watch mode against `src/services/performance.test.ts`, with the test environment loaded from `.env.test`.

For each scenario, the test records the elapsed time for each request and the elapsed time for the complete concurrent batch:

- **Total duration:** time from launching the concurrent requests until all responses are received.
- **Average response time:** arithmetic mean of the individual request times.
- **Requests per second (RPS):** `request count / (total duration in milliseconds / 1000)`.
- **P95:** the sorted response time at index `ceil(0.95 × request count) - 1`.

All displayed test runs passed all three test assertions. The repository does not store individual logs for these historical measurements, so rerunning the command will produce new measurements that may differ.

## Scenario 1: 10 concurrent requests near the rate limit

Before the concurrent batch, the test consumes 99 units using nine sequential requests of 10 units and one sequential request of 9 units. It then sends 10 concurrent requests of one unit each for the same account and user. The expected result is one HTTP 200 response and nine HTTP 403 responses. The test also verifies that the account and user usage totals are both 100 units.

### Measurements

| Run | Total duration (ms) | Average response time (ms) | RPS | P95 (ms) |
|---:|---:|---:|---:|---:|
| 1 | 88.97 | 64.02 | 112.39 | 87.73 |
| 2 | 86.20 | 61.86 | 116.01 | 84.94 |
| 3 | 89.92 | 65.48 | 111.21 | 88.52 |
| 4 | 88.54 | 61.96 | 112.95 | 87.39 |
| 5 | 89.44 | 65.19 | 111.81 | 88.63 |
| 6 | 89.74 | 64.46 | 111.43 | 88.35 |
| 7 | 104.87 | 77.67 | 95.36 | 103.18 |

## Scenario 2: 100 concurrent successful requests for one account and user

The test sends 100 concurrent requests of one unit using one account and one user. It expects all 100 requests to return HTTP 200 and none to return HTTP 403. It then verifies that both the account and user usage totals are 100 units.

### Measurements

The supplied results contain seven runs for this scenario; all seven are included.

| Run | Total duration (ms) | Average response time (ms) | RPS | P95 (ms) |
|---:|---:|---:|---:|---:|
| 1 | 723.62 | 463.49 | 138.19 | 691.41 |
| 2 | 636.16 | 391.07 | 157.19 | 607.22 |
| 3 | 664.23 | 421.37 | 150.55 | 634.12 |
| 4 | 667.19 | 404.28 | 149.88 | 636.49 |
| 5 | 635.95 | 382.25 | 157.25 | 605.30 |
| 6 | 627.60 | 381.89 | 159.34 | 594.90 |
| 7 | 652.96 | 401.91 | 153.15 | 623.21 |

## Scenario 3: 100 concurrent successful requests across five accounts

The test creates five accounts and one premium user for each account, then distributes 100 concurrent one-unit requests across the five account-user and API-key pairs. It expects all 100 requests to return HTTP 200 and none to return HTTP 403. This scenario measures concurrent successful usage across multiple accounts; it does not perform the account and user summary checks used by Scenario 2.

### Measurements

The supplied results contain seven runs for this scenario; all seven are included.

| Run | Total duration (ms) | Average response time (ms) | RPS | P95 (ms) |
|---:|---:|---:|---:|---:|
| 1 | 292.18 | 192.76 | 342.25 | 275.85 |
| 2 | 282.96 | 185.51 | 353.40 | 270.23 |
| 3 | 283.04 | 189.62 | 353.31 | 271.60 |
| 4 | 279.85 | 181.99 | 357.34 | 266.80 |
| 5 | 280.56 | 187.56 | 356.43 | 268.79 |
| 6 | 282.91 | 184.88 | 353.46 | 270.38 |
| 7 | 289.83 | 189.34 | 345.03 | 276.65 |

## Summary of means

The means below use all seven supplied measurements for each scenario.

| Scenario | Mean total duration (ms) | Mean average response time (ms) | Mean RPS | Mean P95 (ms) |
|---|---:|---:|---:|---:|
| 1: 10 concurrent requests near the rate limit | 91.10 | 65.81 | 110.17 | 89.82 |
| 2: 100 concurrent requests for one account and user | 658.24 | 406.61 | 152.22 | 627.52 |
| 3: 100 concurrent requests across five accounts | 284.48 | 187.38 | 351.60 | 271.47 |

## Before and After Indexing

Runs 1–3 were recorded before adding the database index, and runs 4–7 were recorded after adding it. This split is based on the order of the executions relative to the index migration (`0006`). The comparison below uses only the recorded RPS values for Scenarios 2 and 3; the periods are kept separate.

| Scenario | Before indexing (runs 1–3 average RPS) | After indexing (runs 4–7 average RPS) |
|---|---:|---:|
| 2: 100 concurrent requests for one account and user | 148.64 | 154.91 |
| 3: 100 concurrent requests across five accounts | 349.65 | 353.07 |

The differences are small and may fall within normal measurement variability. These results do not demonstrate a significant performance improvement from indexing.

## What I Learned

In these measurements, the five-account scenario achieved approximately 352 RPS, compared with approximately 152 RPS for the single-account scenario, making it about 2.3 times faster. A major factor may be row-level locking with `FOR UPDATE`: concurrent transactions targeting the same account row must serialize, while requests targeting different account rows may execute concurrently.

The index had no noticeable impact at the current data size based on this comparison. Indexing may become more important as the table grows, but these measurements do not establish that it improves performance here.

The load generator and server run within the same process and environment, and no documented test environment is available to support generalizing these results to production.

## Conclusions and scope

The measurements show the observed timing and throughput for seven runs of each scenario. The tests verified the scenario-specific status and usage assertions described above, and all supplied executions passed all three tests.

These results represent batches of 10 or 100 concurrent requests under the unrecorded test environment. They do not establish production capacity, maximum system capacity, sustained-load performance, behavior under larger loads, or guaranteed quota correctness for every possible concurrency pattern or workload. The commands `npm run generate` and `npm run migrate:test` run between some supplied executions were not treated as performance runs because their output contained no performance measurements.
