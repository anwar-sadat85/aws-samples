# Amplify Gen2 – Todo & Tasks App

A full-stack React app built with **AWS Amplify Gen2** featuring:

| Capability | Service |
|---|---|
| Authentication | Cognito User Pool (email/password) |
| Todos CRUD (real-time) | AppSync GraphQL API + DynamoDB (managed by Amplify) |
| Ad-hoc Tasks CRUD | API Gateway REST API (Cognito-protected) + DynamoDB |
| Frontend | React + Vite + Amplify UI |

---

## Architecture

```
Browser (React)
 ├─ Authenticator (Cognito User Pool)
 ├─ TodoList  ──────► AppSync GraphQL API ──► DynamoDB (auto by Amplify)
 └─ TaskList  ──────► API Gateway REST API ──► Lambda ──► DynamoDB (Tasks table)
                            │
                    Cognito Authorizer
```

---

## Prerequisites

- Node.js 20+
- AWS CLI configured (`aws configure`)
- Amplify CLI Gen2: `npm i -g @aws-amplify/backend-cli`

---

## Setup & Deploy

```bash
# 1. Install dependencies
cd amplify-todo-app
npm install

# 2. Deploy the backend (sandbox for dev, or CI/CD for prod)
npx ampx sandbox          # deploys to your personal dev sandbox
# — or for production —
npx ampx pipeline-deploy --branch main --app-id <amplify-app-id>

# 3. Start the frontend dev server
npm run dev
```

`npx ampx sandbox` will automatically generate `amplify_outputs.json` with all
real endpoint URLs (AppSync, Cognito, API Gateway custom output).

---

## Project Structure

```
amplify-todo-app/
├── amplify/
│   ├── auth/resource.ts          # Cognito User Pool definition
│   ├── data/resource.ts          # AppSync schema (Todo model)
│   ├── functions/tasks-api/
│   │   └── handler.ts            # Lambda for ad-hoc Tasks CRUD
│   └── backend.ts                # Backend entry-point + custom CDK
│                                  # (API Gateway, Tasks DynamoDB table)
└── src/
    ├── App.tsx                   # Root – wraps everything in <Authenticator>
    ├── components/
    │   ├── TodoList.tsx          # AppSync-backed todo list (real-time)
    │   ├── TodoForm.tsx          # Reusable form for todos
    │   ├── TaskList.tsx          # API Gateway-backed task list
    │   └── TaskForm.tsx          # Form for ad-hoc tasks
    └── utils/tasksApi.ts         # Typed fetch wrapper for API Gateway
```

---

## Testing

### Playwright E2E tests

The `e2e/` directory contains Playwright tests covering the Todo module, Tasks
module, and authentication boundaries.  Tests run against a locally-served
production build (`http://localhost:3000`) and hit the real AWS backend — no
services are mocked.

#### Prerequisites

| Variable | Where to get it |
|---|---|
| `COGNITO_TEST_USER` | The email address of the pre-existing Cognito test account |
| `COGNITO_TEST_PASSWORD` | That account's password |

> These are the same credentials used by the k6 smoke tests.  Configure them
> once in **Amplify Console → App settings → Environment variables** and they
> will be available to both the k6 and Playwright test phases in CI.

#### Running locally

```bash
# 1. Build the app
npm run build

# 2. Serve the build on port 3000 (matches playwright.config.ts baseURL)
npx serve -s dist -l 3000 &

# 3. Export credentials
export COGNITO_TEST_USER="testuser@example.com"
export COGNITO_TEST_PASSWORD="Secr3t!"

# 4. Install the Chromium browser (first run only)
npx playwright install chromium

# 5. Run all E2E tests
npx playwright test

# Open the HTML report after a run
npx playwright show-report
```

#### Test structure

| File | Coverage |
|---|---|
| `e2e/todo.spec.ts` | Create, toggle-complete, edit, delete a Todo; empty state |
| `e2e/tasks.spec.ts` | Create, delete a Task; direct REST API backend assertion; user scoping |
| `e2e/auth.spec.ts` | Unauthenticated visitors to `/todos` and `/tasks` see the sign-in form |

#### How authentication works in tests

`global-setup.ts` runs once before the full suite.  It calls `signIn()` from
`aws-amplify/auth` using `COGNITO_TEST_USER` / `COGNITO_TEST_PASSWORD`, extracts
the Cognito JWT tokens, injects them into a headless browser's `localStorage`
using the key format Amplify v6 writes in a real browser session, and saves the
resulting `storageState` to `playwright/.auth/user.json`.  Every test worker
picks up that file automatically — no re-authentication per test.

`playwright/.auth/user.json` is git-ignored and regenerated on each run.

---

## How it works

### Todos (AppSync)
- Uses the Amplify-generated `generateClient<Schema>()` typed client.
- `observeQuery()` provides a real-time subscription so all open tabs stay in sync.
- Owner-based authorization: each user sees only their own todos.

### Ad-hoc Tasks (API Gateway)
- Protected by a **Cognito User Pools authorizer** – the frontend attaches the
  Cognito ID token as the `Authorization` header.
- Lambda reads `requestContext.authorizer.claims.sub` to scope data per user.
- DynamoDB uses `userId` (partition key) + `taskId` (sort key).
- Supports: **list**, **create**, **delete** (no edit by design – tasks are ephemeral).
