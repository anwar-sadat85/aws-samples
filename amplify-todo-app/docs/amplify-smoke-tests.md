# Amplify Smoke Tests

This document covers the k6 smoke test phase added to `amplify.yml`. It runs after the
frontend build on every branch deployment and validates that both the AppSync GraphQL and
API Gateway REST endpoints are reachable and responding correctly.

---

## How it fits into the build

```
Backend build (npm install + ampx pipeline-deploy)
        │
        ▼
Frontend build (npm install + npm run build)
        │
        ▼
Test phase — preTest
  • Install k6 v0.45.1 → $HOME/bin/k6
  • Install jq v1.6   → $HOME/bin/jq
  • Create reports/ directory
  • Debug: print working directory and locate amplify_outputs.json
        │
        ▼
Test phase — test
  • Extract endpoints from amplify_outputs.json
  • If COGNITO_TEST_USER or COGNITO_TEST_PASSWORD not set → skip (exit 0)
  • Run graphql.test.js and rest.test.js in parallel
  • Fail the build if either test exits non-zero
        │
        ▼
Artifact collection — reports/
  • reports/graphql-smoke.json  (k6 --summary-export)
  • reports/rest-smoke.json     (k6 --summary-export)
  • reports/skipped.json        (written only when credentials are absent)
```

---

## Credentials — environment variables, not secrets

> **Important:** `COGNITO_TEST_USER` and `COGNITO_TEST_PASSWORD` **must** be set as
> Amplify **environment variables**, not as Amplify secrets.

Amplify secrets (configured under **Hosting → Secret management**) are only injected
into the backend build phase. They are not available in the test phase. If you store
these values in Secret management the environment variables will be empty when the test
phase runs, the credential check will fire, and the smoke tests will be silently skipped.

**Where to configure them:**

1. Open the Amplify console and select your app.
2. Go to **App settings → Environment variables**.
3. Add the following variables. Use the **Branch** column to restrict them to specific
   branches, or leave it as `All branches` to apply globally.

| Variable | Value |
|----------|-------|
| `COGNITO_TEST_USER` | Email of the dedicated smoke-test Cognito account |
| `COGNITO_TEST_PASSWORD` | Password of the dedicated smoke-test Cognito account |

The same dedicated account used for GitHub Actions load tests can be reused here.
See [k6.md § Dedicated load test account](k6.md#2--dedicated-load-test-account) for
instructions on creating the account.

---

## Endpoints

All endpoint values are extracted at runtime from `amplify_outputs.json`, which
`npx ampx pipeline-deploy` writes to the `amplify-todo-app/` working directory during
the backend build phase. No URLs are hardcoded.

| Variable | jq path | Notes |
|----------|---------|-------|
| `APPSYNC_ENDPOINT` | `.data.url` | Full GraphQL endpoint URL |
| `APIGW_BASE_URL` | `.custom.tasksApiUrl` | Trailing `/` stripped with `sed` |
| `COGNITO_CLIENT_ID` | `.auth.user_pool_client_id` | Passed to k6 for Cognito auth |
| `AWS_REGION` | `.auth.aws_region` | Passed to k6 for Cognito auth |

---

## k6 version and installation

k6 is pinned to **v0.45.1** and installed from the GitHub release tarball:

```bash
curl -sL https://github.com/grafana/k6/releases/download/v0.45.1/k6-v0.45.1-linux-amd64.tar.gz \
  | tar -xz --strip-components=1 -C $HOME/bin k6-v0.45.1-linux-amd64/k6
```

**Why v0.45.1 and not the apt repository?**
The apt repository installs the latest k6 version, which has a known issue with
`--summary-export` threshold output — the JSON file is written but the threshold
pass/fail fields are missing or malformed. v0.45.1 produces reliable output.

**Why `$HOME/bin` and not `/usr/local/bin`?**
The Amplify test runner does not grant write access to `/usr/local/bin`. Installing to
`$HOME/bin` avoids a permission error. Both k6 and jq are installed there and invoked
via the full path (`$HOME/bin/k6`, `$HOME/bin/jq`) throughout the test phase.

jq is also installed here because the Amplify test runner environment does not include
it by default.

---

## Graceful skip behaviour

If either `COGNITO_TEST_USER` or `COGNITO_TEST_PASSWORD` is absent the test command
exits `0` immediately after printing a message. The build is not failed and artifact
collection still runs (picking up `reports/skipped.json`).

```
Smoke tests skipped — COGNITO_TEST_USER or COGNITO_TEST_PASSWORD not configured in Amplify environment variables
```

This allows branches where credentials are intentionally absent (e.g. feature branches
in forks, or before the variables have been configured) to deploy without blocking.

---

## Parallel execution

Both tests are started as background processes and their PIDs captured. The build waits
for both to complete before checking the results:

```bash
$HOME/bin/k6 run ... tests/load/graphql.test.js &
GRAPHQL_PID=$!

$HOME/bin/k6 run ... tests/load/rest.test.js &
REST_PID=$!

GRAPHQL_EXIT=0; REST_EXIT=0
wait $GRAPHQL_PID || GRAPHQL_EXIT=$?
wait $REST_PID    || REST_EXIT=$?

if [ $GRAPHQL_EXIT -ne 0 ] || [ $REST_EXIT -ne 0 ]; then
  echo "Smoke tests failed — graphql exit=${GRAPHQL_EXIT}, rest exit=${REST_EXIT}"
  exit 1
fi
```

Both tests run concurrently. If either fails the build phase exits non-zero and
Amplify marks the deployment as failed.

---

## Coverage

Both tests run with `PROFILE=smoke` (1 VU, ~1 minute).

| Test file | Target | Operations |
|-----------|--------|------------|
| `tests/load/graphql.test.js` | AppSync GraphQL | `listTodos`, `createTodo`, `updateTodo`, `deleteTodo` |
| `tests/load/rest.test.js` | API Gateway REST | `GET /tasks`, `POST /tasks`, `GET /tasks/{taskId}`, `DELETE /tasks/{taskId}` |

> **`getTodo` is skipped** — this operation requires a `TEST_TODO_ID` environment
> variable pointing to a pre-seeded Todo record. Because Amplify deployments create
> a fresh environment there is no guaranteed pre-seeded record, so this variable is
> intentionally not set. The guard at line 97 of `graphql.test.js` handles the skip
> cleanly with no error. The remaining four GraphQL operations still run and validate
> the p95 threshold.

See [k6.md](k6.md) for full details on profiles, thresholds, the shared library, and
the GitHub Actions workflow that runs the load and stress profiles after UAT deploys.

---

## Reports

k6 writes a JSON summary for each test run. These are collected as a build artifact.

| File | Contents |
|------|----------|
| `reports/graphql-smoke.json` | k6 `--summary-export` for the GraphQL test |
| `reports/rest-smoke.json` | k6 `--summary-export` for the REST test |
| `reports/skipped.json` | Written only when credentials are absent |

Reports can be downloaded from **Amplify console → your app → the deployment → Artifacts**.
