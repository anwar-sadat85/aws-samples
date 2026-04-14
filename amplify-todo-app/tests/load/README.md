# Load Tests — Amplify Todo App

k6 load tests for the two backend APIs:

| Test file | Target | Auth |
|-----------|--------|------|
| `graphql.test.js` | AppSync GraphQL (`/graphql`) | Cognito ID token (no Bearer prefix) |
| `rest.test.js` | API Gateway REST (`/tasks`) | Cognito ID token (`Bearer` prefix) |

---

## Prerequisites

Install k6 from the [official repository](https://grafana.com/docs/k6/latest/set-up/install-k6/):

```bash
# macOS
brew install k6

# Ubuntu / Debian
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] \
  https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows (Chocolatey)
choco install k6
```

---

## Environment variables

All variables are required unless marked optional.

| Variable | Description |
|----------|-------------|
| `COGNITO_CLIENT_ID` | Cognito app client ID |
| `COGNITO_TEST_USER` | Test user email / username |
| `COGNITO_TEST_PASSWORD` | Test user password |
| `AWS_REGION` | AWS region (default: `ap-southeast-2`) |
| `APPSYNC_ENDPOINT` | Full AppSync GraphQL URL (GraphQL test only) |
| `APIGW_BASE_URL` | API Gateway base URL, no trailing slash (REST test only) |
| `TEST_TODO_ID` | ID of a pre-seeded Todo for the `getTodo` query — optional but recommended |
| `PROFILE` | `smoke` \| `load` \| `stress` \| `soak` (default: `smoke`) |

---

## Profiles

| Profile | VUs | Duration | Purpose |
|---------|-----|----------|---------|
| `smoke` | 1 | 1 min | Verify the script and endpoints work end-to-end. Run this before every real test. |
| `load` | 0 → 20 → 0 | 7 min | Typical expected production traffic. Validates steady-state performance. |
| `stress` | 0 → 150 → 0 | 8 min | Find the breaking point by ramping VUs well beyond expected load. |
| `soak` | 10 (sustained) | 30 min | Detect memory leaks, connection pool exhaustion, and slow degradation under sustained load. |

### Thresholds

| Metric | GraphQL | REST |
|--------|---------|------|
| p95 latency | < 2 000 ms | < 1 500 ms |
| Error rate (smoke) | < 5% | < 5% |
| Error rate (load/soak) | < 1% | < 1% |
| Error rate (stress) | < 10% | < 10% |

k6 exits with a non-zero code and prints `FAILED` when a threshold is breached.

---

## Running locally

### Smoke (quick sanity check)

```bash
k6 run \
  --env PROFILE=smoke \
  --env COGNITO_CLIENT_ID=<client-id> \
  --env COGNITO_TEST_USER=user@example.com \
  --env COGNITO_TEST_PASSWORD=<password> \
  --env APPSYNC_ENDPOINT=https://<id>.appsync-api.ap-southeast-2.amazonaws.com/graphql \
  --env TEST_TODO_ID=<uuid> \
  tests/load/graphql.test.js
```

```bash
k6 run \
  --env PROFILE=smoke \
  --env COGNITO_CLIENT_ID=<client-id> \
  --env COGNITO_TEST_USER=user@example.com \
  --env COGNITO_TEST_PASSWORD=<password> \
  --env APIGW_BASE_URL=https://<id>.execute-api.ap-southeast-2.amazonaws.com/prod \
  tests/load/rest.test.js
```

### Load

Replace `PROFILE=smoke` with `PROFILE=load` in the commands above.

### With JSON report export

```bash
mkdir -p reports
k6 run \
  --env PROFILE=load \
  --env COGNITO_CLIENT_ID=<client-id> \
  --env COGNITO_TEST_USER=user@example.com \
  --env COGNITO_TEST_PASSWORD=<password> \
  --env APPSYNC_ENDPOINT=https://... \
  --summary-export=reports/graphql-load.json \
  tests/load/graphql.test.js
```

### Run both in parallel (same terminal)

```bash
k6 run --env PROFILE=load ... tests/load/graphql.test.js \
  --summary-export=reports/graphql-load.json &

k6 run --env PROFILE=load ... tests/load/rest.test.js \
  --summary-export=reports/rest-load.json &

wait
```

---

## File structure

```
tests/load/
├── graphql.test.js       AppSync GraphQL load test
├── rest.test.js          API Gateway REST load test
├── lib/
│   ├── auth.js           Cognito USER_PASSWORD_AUTH token helper (per-VU cache)
│   ├── checks.js         Reusable check helpers + custom Rate/Trend metrics
│   └── profiles.js       Stage definitions and thresholds for all profiles
└── README.md             This file
```

---

## Operations covered

### GraphQL (`graphql.test.js`)

Each iteration executes, in order:

1. `listTodos` — list all todos (query)
2. `getTodo` — get a single todo by `TEST_TODO_ID` (query, skipped if var unset)
3. `createTodo` — create a new todo with `title`, `description`, `completed: false`
4. `updateTodo` — update the just-created todo (`completed: true`, new title)
5. `deleteTodo` — delete the just-created todo (cleanup)

### REST (`rest.test.js`)

Each iteration executes, in order:

1. `GET /tasks` — list all tasks (expects 200)
2. `POST /tasks` — create a task with `title` and `description` (expects 201)
3. `GET /tasks/{taskId}` — fetch the just-created task (expects 200)
4. `DELETE /tasks/{taskId}` — delete the just-created task (expects 200)

> **Note:** `PUT` / `PATCH` routes are not implemented in this API. The Lambda
> handler only exposes GET collection, POST, GET by ID, and DELETE. No update
> route was found in `amplify/functions/tasks-api/handler.ts`.

---

## GitHub Actions

The workflow `.github/workflows/load-test.yml` is triggered by a
`repository_dispatch` event of type `amplify-uat-deployed`. It runs:

1. **smoke-test** job — GraphQL + REST smoke profiles in parallel
2. **load-test** job — GraphQL + REST load profiles in parallel (only if smoke passes)
   - Writes a markdown summary to the Actions job summary page
   - Uploads `reports/*.json` as artifact `k6-results-{run_id}`
   - Copies the two load-profile JSON files to S3 under
     `load-tests/todo-app/uat/{YYYY-MM-DD}/{run_id}/`

### Required GitHub secrets

| Secret | Description |
|--------|-------------|
| `COGNITO_CLIENT_ID` | Cognito app client ID |
| `COGNITO_TEST_USER` | Test user email |
| `COGNITO_TEST_PASSWORD` | Test user password |
| `COGNITO_USER_POOL_ID` | Cognito user pool ID |
| `APPSYNC_ENDPOINT` | AppSync GraphQL endpoint URL |
| `APIGW_BASE_URL` | API Gateway base URL |
| `TEST_TODO_ID` | Pre-seeded Todo ID for `getTodo` |
| `RESULTS_S3_BUCKET` | S3 bucket name for test results |
| `AWS_ROLE_ARN` | IAM role ARN for GitHub OIDC |
| `AWS_REGION` | AWS region (e.g. `ap-southeast-2`) |
