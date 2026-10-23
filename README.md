# Usage Metering and Quota Service

Usage Metering Service is a TypeScript/Express backend that lets another application
record integer usage units and enforce account-wide and per-user quotas. An **account**
represents the calling application or company. Users belong to an account, and each
account and user is assigned a plan.

Every accepted action consumes the same resource type (integer usage units) from both
the account's shared monthly allowance and the requesting user's independent monthly
allowance. The service uses UTC calendar months for quota accounting. It records both
accepted requests and quota/max-request-limit rejections in PostgreSQL, while only
accepted requests contribute to usage totals. Validation, authentication, missing
resource, and inactive-account/user failures are returned without a usage row.

The project uses TypeScript, Node.js, Express, PostgreSQL, Drizzle ORM, Vitest, and
Docker Compose. It does not implement billing, payment processing, refunds,
end-user authentication, role-based permission management, multiple resource types,
or distributed infrastructure.

## Contents

- [Architecture and data model](#architecture-and-data-model)
- [Plans and quota rules](#plans-and-quota-rules)
- [Quick start with Docker Compose](#quick-start-with-docker-compose)
- [Local development](#local-development)
- [Authentication and account isolation](#authentication-and-account-isolation)
- [API reference](#api-reference)
- [Idempotency and errors](#idempotency-and-errors)
- [Usage summaries and history](#usage-summaries-and-history)
- [Demo client](#demo-client)
- [Automated tests](#automated-tests)
- [Performance results](#performance-results)
- [Design decisions and trade-offs](#design-decisions-and-trade-offs)
- [Assumptions and limitations](#assumptions-and-limitations)

## Architecture and data model

The API is an Express application backed by PostgreSQL through Drizzle ORM. SQL
migrations are in `src/db/migrations/`; `src/db/seed.ts` creates the two predefined
plan categories and their system subplans. The usage service performs quota checks
inside a database transaction and locks the account and user rows while deciding
whether a request can be accepted.

The database contains:

| Entity | Purpose and relationships |
| --- | --- |
| `plans` | Plan categories such as `Account Plans` and `User Plans`. `name` is unique. |
| `subplans` | The actual plan definitions. Each belongs to a `plan` through `plan_id`; `(plan_id, name)` is unique. It stores `description`, decimal `price`, `monthly_limit`, `max_request_limit`, `is_active`, `is_system_plan`, and optional `created_by_account_id`. |
| `accounts` | Calling applications or companies. Each has a unique `name`, a SHA-256 `hashed_api_key`, an account `subplan_id`, `is_active`, and `subscription_started_at`. |
| `users` | Users registered under an account. `email` is globally unique; each user has `account_id`, `subplan_id`, `is_active`, `is_admin`, and `subscription_started_at`. `is_admin` is stored but is not used for authorization. |
| `usages` | One row per request ID within an account. It stores `request_id`, `amount`, `account_id`, `user_id`, `is_success`, `rejected_by`, and `rejected_reason`. |

Foreign keys connect accounts and users to their subplans, users to accounts, and
usages to both users and accounts. These relationships use cascading deletes.
`usages` has a unique `(request_id, account_id)` constraint, plus indexes on
`(account_id, created_at)` and `(user_id, created_at)` for account/user history
queries. UUIDs are used for entity and request identifiers.

## Plans and quota rules

The seed data defines these example system plans:

| Plan category | Plan | Monthly allowance | Maximum units per request |
| --- | --- | ---: | ---: |
| Account | Starter | 100 | 10 |
| Account | Pro | 1,000 | 100 |
| User | Basic | 100 | 10 |
| User | Premium | 10,000 | 1,000 |

The database stores the plan description and price as well (`Starter` 19.99,
`Pro` 49.99, `Basic` 9.99, and `Premium` 99.99). A stored price is plan metadata;
it does not mean billing or payments are implemented.

Two rules are checked for every request:

1. **Monthly allowance** is the total accepted units available during a UTC
   calendar month.
2. **Maximum units per request** is the largest amount accepted in one request.

A request must satisfy both the account plan and the user's plan. The account
allowance is shared by all users of that account; each user's allowance is
independent. If either rule fails, the request is rejected and stored in history
with `rejectedBy` set to `account` or `user`. Rejected units do not increase
accepted usage totals.

Plan changes apply to requests made after the update succeeds and do not reset
usage already accumulated in the current month. If a new monthly allowance is
below existing accepted usage, remaining allowance is zero and further requests
are rejected at the quota level that has been exceeded. Multiple users may use the
same plan definition without sharing their usage totals.

The seeded system plans are read-only through the custom-subplan update endpoint.
Custom subplans are owned by the account that created them and only that account
can update them.

## Quick start with Docker Compose

From the repository root:

```bash
docker compose up --build
```

The default Compose stack contains:

- `db`: PostgreSQL 17, exposed on host port `5433`, with persistent volume
  `postgres_data`.
- `api`: the service on `http://localhost:8080`. It waits for the database
  health check, runs `npm run migrate`, runs `npm run seed`, then starts the
  compiled API.
- `demo`: a one-shot command-line client that waits for the API health check and
  runs `npm run demo:prod`. It may exit after its scenario completes; that is
  normal and does not mean the API stopped.

The API health endpoint is:

```bash
curl http://localhost:8080/health
```

It returns `{"status":"ok","database":"connected"}` when the database query
succeeds. Observe the demo output with:

```bash
docker compose logs -f demo
```

Stop the services while preserving the database volume with:

```bash
docker compose down
```

To remove the database data as well, **this permanently deletes the Compose
database volume**:

```bash
docker compose down -v
```

The Compose defaults can be overridden with `POSTGRES_DB`, `POSTGRES_USER`, and
`POSTGRES_PASSWORD` in the shell environment or a root `.env` file. The API
container uses `db:5432` internally, regardless of the host mapping.

## Local development

### Prerequisites

Install Node.js 24 (matches the Dockerfile). The simplest local database is:

```bash
docker compose up -d db
```

This matches `.env.example`: `localhost:5433`, user `postgres`, password
`password`, and database `usage-metering-service-example`.

### Development setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with the local PostgreSQL connection details. The checked-in example
uses database `usage-metering-service-example`, user `postgres`, password
`password`, host port `5433`, `PORT=8080`, and `PLATFORM=dev`. Do not use the
example password in production. `DB_URL` must be a PostgreSQL connection URL,
for example:

```dotenv
POSTGRES_DB="usage-metering-service-example"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="replace-this-locally"
DB_URL="postgresql://postgres:replace-this-locally@localhost:5433/usage-metering-service-example?sslmode=disable"
PORT=8080
PLATFORM="dev"
```

Apply the schema, seed the system plans, and start the API:

```bash
npm run migrate
npm run seed
npm run dev
```

`npm run dev` type-checks/builds through `tsc` and starts `dist/index.js`.
The API listens on `http://localhost:8080` when `PLATFORM=dev`.

In a second terminal, run the local demo:

```bash
npm run demo
```

The demo uses `PLATFORM=dev` and calls `http://localhost:8080`.

### Configuration

`src/config.ts` loads `.env` normally and `.env.test` when `NODE_ENV=test`.
The API requires `PORT`, `PLATFORM`, and `DB_URL`; the PostgreSQL component
variables are used by PostgreSQL/Compose and documented in the example files.

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB` | PostgreSQL database name. |
| `POSTGRES_USER` | PostgreSQL user. |
| `POSTGRES_PASSWORD` | PostgreSQL password. Treat it as a secret outside local examples. |
| `DB_URL` | PostgreSQL connection URL consumed by Drizzle/Postgres. |
| `PORT` | HTTP port used by the API. |
| `PLATFORM` | Client target selector: `dev` makes the demo use `localhost`; `production` makes it use the Compose service hostname `api`. |
| `NODE_ENV` | When set to `test`, configuration and scripts use `.env.test`. |

The test example uses database `usage-metering-service-example-test`, host port
`5434`, `PORT=8080`, and `PLATFORM=dev`. Keep that database separate from
development data.

## Authentication and account isolation

`POST /accounts` is the bootstrap endpoint and does **not** require an API key.
It creates the account, generates a random API key, and returns the plaintext
key once. The database stores only its SHA-256 hash.

Every other account/user, plan, usage, and reporting endpoint requires the
`x-api-key` header. The key identifies exactly one account. Missing or invalid
keys return `401 Unauthorized`; inactive accounts return `403`. User IDs are
looked up together with the authenticated account, so a key cannot access
another account's users or usage.

```bash
curl -H "x-api-key: <API_KEY>" http://localhost:8080/accounts/me
```

Treat `<API_KEY>` as a secret. Never commit a generated key or a production
database password.

## API reference

All responses are JSON. Unless noted otherwise, the endpoint requires
`x-api-key`.

### Accounts and users

#### `POST /accounts` — create an account

Authentication: none. Body:

```json
{ "name": "Example application", "planName": "Starter" }
```

Returns `201` with `accountId`, `accountName`, `planName`, and the plaintext
`apiKey`. `name` and `planName` are required non-empty strings. It returns `400`
for missing fields or an unavailable account system subplan, and `500` if the
account cannot be created.

#### `GET /accounts/me` — inspect the authenticated account

Returns `200` with `{ "accountId", "accountName", "isActive" }`.

#### `POST /users` — register a user

Body:

```json
{ "email": "user@example.com", "planName": "Basic" }
```

Returns `201` with `{ "userId", "email", "planName" }`. The plan must be an
active system user plan or an active custom user subplan owned by this account.
Missing fields and unavailable plans return `400`; creation failures return
`500`.

### Usage consumption and reporting

#### `POST /usage/consume` — consume units

Body fields are `userId: string`, `requestId: string`, and `units: number`.
Both IDs must be UUIDs and `units` must be a positive integer. A successful
request returns `200`:

```json
{ "success": true, "unitsConsumed": 2 }
```

A quota rejection returns `403`:

```json
{
  "success": false,
  "rejectedBy": "user",
  "error": "User max request limit exceeded"
}
```

`rejectedBy` is `account` or `user`, identifying the first applicable account-
or user-level rule. Validation errors return `400`; a user outside the
authenticated account is reported as `404`; idempotency conflicts return `409`;
unexpected failures return `500`.

#### `GET /usage/history`

Optional query parameters are `userId` (UUID), `page` (positive integer, default
`1`), and `limit` (positive integer, default `10`). Without `userId`, returns
the authenticated account's usage rows. With `userId`, returns that user's rows.
Rows are returned as a newest-first JSON array containing the database fields
including `request_id`, `amount`, `is_success`, `rejected_by`, and
`rejected_reason`; both successful and rejected outcomes are included.

Invalid pagination or user IDs return `400`; a user not in the account returns
`404`.

#### `GET /usage/summary`

`userId` is required. An optional `monthAndYear` query parameter must be
`YYYY-MM`, must name a month from the past or current UTC month, and cannot be
in the future. The current-month response is:

```json
{
  "account": { "monthlyLimit": 100, "used": 2, "remaining": 98 },
  "user": { "monthlyLimit": 100, "used": 2, "remaining": 98 }
}
```

The historical form reports `monthlyLimit` and `used` for both account and user
but deliberately does **not** return `remaining`. Its limits come from the
currently assigned plans, not a reconstructed historical plan:

```json
{
  "account": { "monthlyLimit": 100, "used": 0 },
  "user": { "monthlyLimit": 100, "used": 0 }
}
```

Invalid IDs/months return `400`; an inaccessible user returns `404`.

#### `GET /usage/summary/account`

Returns `200` with the current shared account summary:

```json
{ "account": { "monthlyLimit": 100, "used": 2, "remaining": 98 } }
```

#### `GET /usage/summary/accountusers`

Returns `200` with an array of summaries, one per account user. Each item
contains `userId`, `email`, and the current `account` and `user` summary
objects.

### Plan assignment and inspection

#### `PATCH /accounts/me/plan`

Body: `{ "planName": "Pro" }`. Assigns an active account system plan or an
active custom account subplan owned by this account. Returns `200` with
`accountId`, `accountName`, and `planName`. Missing fields, unknown plans, and
assigning the current plan return `400`; an update failure returns `500`.

#### `PATCH /users/:userId/plan`

The path `userId` must be a UUID. Body: `{ "planName": "Premium" }`. Assigns
an active system user plan or this account's active custom user subplan.
Returns `200` with `userId`, `email`, and `planName`. Invalid input returns
`400`, a user not found within the authenticated account returns `404`, and an
update failure returns `500`.

#### `GET /account/me/plan`

Returns the current account subplan's `planName`, `description`, `price`,
`monthly_limit`, and `max_request_limit`. A missing plan or current subplan
returns `404`.

#### `GET /account/me/userplans`

Returns an array containing each account user's `userId`, `email`, `planName`,
`description`, `price`, `monthly_limit`, and `max_request_limit`.

#### `GET /users/:userId/plan`

Returns the assigned user subplan object, including its database fields.
Invalid UUIDs return `400`; a user not belonging to the authenticated account
returns `404`.

### Custom and predefined plans

#### `GET /plans`

Returns `200`:

```json
{
  "accountPlans": [],
  "userPlans": []
}
```

The arrays contain system subplans and custom subplans owned by the
authenticated account; inactive visible subplans are not filtered out by this
endpoint. Each subplan includes its `id` and `plan_id`. Use the appropriate
returned `plan_id` when creating a custom account or user subplan:
the `Account Plans` ID creates account plans, and the `User Plans` ID creates
user plans. This endpoint returns `500` if the seeded plan categories cannot be
retrieved.

#### `GET /plans/:planId/subplans`

Returns the subplans visible to the authenticated account for the UUID
`planId`, as a JSON array. Visibility includes all system subplans and
account-owned custom subplans, whether active or inactive. An invalid ID
returns `400`; a missing plan returns `404`.

#### `POST /plans/:planId/subplans`

Creates an account-owned custom subplan under the UUID `planId`. Body:

```json
{
  "name": "Team",
  "description": "Custom user plan",
  "price": "29.99",
  "monthly_limit": 1000,
  "max_request_limit": 20
}
```

`name` and `description` are non-empty strings; `price` is a decimal string
with up to eight digits and two decimal places; both limits are non-negative
integers. Returns `201` with the complete subplan row. Invalid input returns
`400`, an unavailable plan returns `404`, and persistence failures return `500`.

#### `PATCH /plans/:planId/subplans/:subplanId`

Updates an account-owned custom subplan. The body may contain one or more of
`name`, `description`, `price`, `monthly_limit`, `max_request_limit`, and
`is_active`; at least one field is required. Types follow the creation rules,
except `is_active` is boolean. Returns `200` with the updated row.

Invalid IDs/fields return `400`; missing plans/subplans return `404`; a
subplan belonging to another plan returns `400`; system plans or custom plans
owned by another account return `403`; persistence failures return `500`.

#### `GET /health`

Authentication: none. Runs a database query. Returns `200` with
`{ "status": "ok", "database": "connected" }`, or `503` with
`{ "status": "error", "database": "disconnected" }`.

### End-to-end curl examples

The following sequence uses values returned by earlier calls:

```bash
# 1. Create an account. Set API_KEY to its returned apiKey before step 2.
curl -X POST http://localhost:8080/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Example application","planName":"Starter"}'
API_KEY="<API_KEY>"

# 2. Register a user. Set USER_ID to its returned userId before step 3.
curl -X POST http://localhost:8080/users \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"email":"user@example.com","planName":"Basic"}'
USER_ID="<USER_ID>"
REQUEST_UUID="<REQUEST_UUID>"

# 3. Inspect available system and account-owned subplans.
curl http://localhost:8080/plans -H "x-api-key: $API_KEY"
PLAN_ID="<PLAN_ID>"

# 4. Consume two units. Use the returned user ID and a new UUID request ID.
curl -X POST http://localhost:8080/usage/consume \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d "{\"userId\":\"$USER_ID\",\"requestId\":\"$REQUEST_UUID\",\"units\":2}"

# 5. Read the current account/user summary.
curl "http://localhost:8080/usage/summary?userId=$USER_ID" \
  -H "x-api-key: $API_KEY"

# 6. Read account-wide history, or history for one user.
curl "http://localhost:8080/usage/history?page=1&limit=10" \
  -H "x-api-key: $API_KEY"
curl "http://localhost:8080/usage/history?userId=$USER_ID&page=1&limit=10" \
  -H "x-api-key: $API_KEY"

# 7. Switch the account and user plans.
curl -X PATCH http://localhost:8080/accounts/me/plan \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"planName":"Pro"}'
curl -X PATCH "http://localhost:8080/users/$USER_ID/plan" \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"planName":"Premium"}'

# 8. Create a custom user subplan using the User Plans plan_id from step 3.
curl -X POST "http://localhost:8080/plans/$PLAN_ID/subplans" \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"name":"Team","description":"Custom user plan","price":"29.99","monthly_limit":1000,"max_request_limit":20}'
SUBPLAN_ID="<SUBPLAN_ID>"

# Update it using its returned subplan ID.
curl -X PATCH "http://localhost:8080/plans/$PLAN_ID/subplans/$SUBPLAN_ID" \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"max_request_limit":25}'
```

## Idempotency and errors

`requestId` must be a UUID and is unique within an account. A repeated request
with the same account, user, request ID, and amount returns the original result
without consuming units twice. This applies to successful and rejected requests:
a repeated rejection returns its recorded `rejectedBy` and reason without
creating another row or evaluating a new quota state.

Reusing a request ID with a different amount returns `409 Conflict`. Reusing it
for a different user is also a conflict; the database uniqueness constraint is
per account, so the same UUID may be used by a different account. Concurrent
identical submissions are serialized by the transaction/constraint logic and
produce one usage record.

Common status codes are:

| Status | Meaning |
| ---: | --- |
| `200` | Successful read/update/accepted consumption. |
| `201` | Account, user, or custom subplan created. |
| `400` | Missing/invalid fields, UUIDs, pagination, or month. |
| `401` | Missing or invalid `x-api-key`. |
| `403` | Inactive account/user, quota rejection, or forbidden custom-plan update. |
| `404` | User/plan/subplan not found or outside the authenticated account. |
| `409` | Existing request ID was submitted with a different amount or user. |
| `500` | Unexpected persistence or retrieval failure. |
| `503` | Database health check failed. |

## Usage summaries and history

Current summaries calculate accepted units in the current UTC calendar month.
`/usage/summary` reports both the shared account total and the selected user's
total; `/usage/summary/account` reports only the shared account total; and
`/usage/summary/accountusers` reports a current summary for every user.
Remaining units are `max(monthlyLimit - used, 0)`.

Use `monthAndYear=YYYY-MM` with `/usage/summary` to inspect a prior month.
Historical usage is queried from stored accepted rows in that UTC month, but the
historical response's `monthlyLimit` comes from the currently assigned plans and
has no `remaining` field. It is not a reconstruction of the plan limits that
were in effect during that historical month.

`/usage/history` is newest-first, defaults to page `1` and limit `10`, and
accepts positive integer `page` and `limit`. Omitting `userId` returns
account-wide history; including it returns one user's history after account
validation. The history endpoint is not limited to the current month: it returns
all months, newest first, so previous months' request outcomes are available
there. Each row includes both successful and rejected outcomes. PostgreSQL
stores these records, so they survive service restarts as long as the database
data/volume is preserved. Use `/usage/summary?monthAndYear=YYYY-MM` to retrieve
previous months' accepted usage totals.

## Demo client

The demo in `client/demo.ts` simulates a client calling the API; it is not a
document-processing product. Run it locally with:

```bash
npm run demo
```

With Compose it runs automatically after the API is healthy, using:

```bash
npm run demo:prod
```

The client creates an account and obtains its API key, verifies the key, creates
Basic and Premium users, and demonstrates:

- an accepted request;
- an individual-user quota rejection;
- a shared account quota rejection after an account downgrade;
- a plan upgrade/downgrade changing behavior for subsequent requests;
- creating a custom user plan, assigning it, updating its request limit, and
  showing the changed result; and
- current usage summaries with consumed and remaining allowances.

It prints IDs, plan changes, accepted/rejected requests, and summaries as it
progresses. The Docker demo may exit when this one-shot scenario completes.

## Automated tests

The test scripts use `.env.test`, `NODE_ENV=test`, and the separate test
database. From a fresh clone, run:

```bash
cp .env.test.example .env.test
docker compose -f compose.test.yaml --env-file .env.test up -d db
docker compose -f compose.test.yaml ps
npm run migrate:test
npm run seed:test
npm test
npm run test:performance
```

The `--env-file .env.test` option makes the container create the
`usage-metering-service-example-test` database from `.env.test` and expose it
on host port `5434`. Without it, the container creates
`usage-metering-service-example`, while the test scripts connect to the
`.env.test` database and the tests cannot connect. The `ps` command is used to
wait until the database reports healthy.

To reset the test database and remove its volume:

```bash
docker compose -f compose.test.yaml --env-file .env.test down -v
```

Other repository commands are:

```bash
npm run test:performance
npm run typecheck
npm run build
```

The tests cover missing and invalid API keys, account isolation, usage
consumption, maximum-request and monthly quota enforcement, current and
historical summaries, plan changes, custom-plan creation/update and system-plan
protection, repeated request IDs and conflicts, usage-history retrieval and
account scoping, PostgreSQL persistence, UTC month boundaries, concurrent
idempotent requests, and the three concurrent performance scenarios. The
history query helpers are exercised with page/limit arguments; the integration
suite specifically verifies account isolation for history. Keep test data
separate from development data. The test setup cleans up its created accounts,
users, and usage rows; the integration suite's custom subplans are not
explicitly deleted.

## Performance results

The source of truth for the benchmark methodology and individual runs is
`performance-results.md`; the scenarios are implemented in
`src/services/performance.test.ts`. Reproduce them with:

```bash
npm run test:performance
```

Each test launches concurrent `POST /usage/consume` calls. **Total duration**
is the elapsed batch time, **average response time** is the arithmetic mean of
individual request times, **RPS** is `request count / (total duration / 1000)`,
and **P95** is the sorted response time at index
`ceil(0.95 * request count) - 1`.

Recorded means:

| Scenario | Mean total duration | Mean average response time | Mean RPS | Mean P95 |
| --- | ---: | ---: | ---: | ---: |
| 10 concurrent requests near the rate limit | 91.10 ms | 65.81 ms | 110.17 | 89.82 ms |
| 100 concurrent requests for one account and user | 658.24 ms | 406.61 ms | 152.22 | 627.52 ms |
| 100 concurrent requests across five accounts | 284.48 ms | 187.38 ms | 351.60 | 271.47 ms |

The recorded before/after indexing comparison is:

| Scenario | Before indexing | After indexing |
| --- | ---: | ---: |
| Scenario 2: one account | 148.64 RPS | 154.91 RPS |
| Scenario 3: five accounts | 349.65 RPS | 353.07 RPS |

In these measurements, five accounts achieved approximately 2.3 times the
throughput of one account. Row-level locking with `FOR UPDATE` may serialize
requests targeting the same account, while requests targeting different
accounts can potentially proceed concurrently. The indexing differences are
small and do not establish a significant improvement.

The load generator and Express server run in the same process/environment, and
the benchmark environment's hardware/software specifications were not recorded.
These are environment-dependent observations, not production capacity
guarantees: they do not establish maximum capacity, sustained-load behavior, or
production readiness. Rerunning the tests produces new measurements and may not
reproduce the recorded values.

## Design decisions and trade-offs

- **Correctness over throughput:** each consumption transaction locks the
  account row and the user row with `SELECT ... FOR UPDATE`. Concurrent requests
  for one account are therefore serialized, while requests for different
  accounts can run in parallel.
- **Auditable totals:** usage totals are `SUM` values over accepted rows in the
  `usages` table for the UTC month. Counters could be faster, but add consistency
  risk.
- **Complete history:** every quota decision, whether accepted or rejected by a
  quota rule, is stored as a usage row. Only accepted rows count toward totals.
- **Retries:** `(account, request_id)` is unique. A repeated request ID replays
  the stored result, including a stored rejection, so a client must use a new
  request ID after a plan change to be re-evaluated.
- **Plan lookup and ownership:** plans are looked up by name within a plan
  category. System plans are read-only, while custom plans belong to one account.
- **API key handling:** API keys are random, shown once when an account is
  created, and stored as SHA-256 hashes.
- **Historical summaries:** previous-month summaries use the currently assigned
  plan limits and omit `remaining`, because plan history is not stored.

## Assumptions and limitations

- Accounting uses UTC calendar-month boundaries.
- There is one resource type and usage is represented by positive integer units.
- Account usage is shared across its users; user usage is independent.
- Accepted usage counts toward quotas. Rejected attempts remain queryable in
  history but do not count toward accepted totals.
- Request IDs provide account-scoped idempotency; same-input retries replay the
  recorded result, while mismatched amount/user submissions conflict.
- System plans are read-only through the custom-plan update route.
- Custom subplans are owned by their creating account.
- Plan changes preserve usage already accumulated in the current month.
- Historical records remain queryable, but historical summaries use current plan
  limits and omit `remaining`; they do not reconstruct old plan assignments.
- Duplicate account names, user emails (unique across all accounts), or plan
  names violate unique constraints and currently return `500`, not `409`.
- Plan names are unique per plan category across the whole system, so two
  accounts cannot create custom plans with the same name, and a custom plan
  cannot reuse a system plan's name.
- Setting `is_active=false` on an assigned subplan makes consumption for affected
  accounts or users fail with a `500` response instead of a clean rejection.
- Per-account row locking caps throughput for one hot account; see the
  performance results.
- Timestamps are `timestamp` columns without time zone; the service assumes the
  PostgreSQL session time zone is UTC, which is the Docker default.
- Foreign keys use `ON DELETE CASCADE`. No delete endpoint exists, but deleting
  rows directly in the database also deletes dependent usage history.
- Account and user deactivation is enforced on consumption, but there is no API
  endpoint to activate or deactivate them.
- The service does not provide payments, billing, refunds, multiple resource
  types, end-user login, role-based permission management, or distributed
  infrastructure.
