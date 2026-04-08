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
