# load-test-trigger

An AWS CDK stack (TypeScript) that automatically triggers a GitHub Actions
load-test workflow whenever the Amplify **uat** branch deployment succeeds.

The stack follows the same pattern as **dast-trigger**: an EventBridge rule
fires on every Amplify success event and invokes a Lambda that reads its
targeting config from SSM, so repos and branches can be updated without
redeploying infrastructure.

---

## What it does

1. Creates an EventBridge rule on the **default event bus** that matches
   all Amplify `SUCCEED` deployment events (`jobStatus: SUCCEED`).

2. Invokes a Lambda function that:
   - Calls `amplify:GetApp` to resolve the GitHub repository URL for the app
     that just deployed.
   - Reads targeting config from an SSM parameter (`/load-test/config` by
     default) to find a matching `repository` + `branch` entry.
   - If a match is found, reads the GitHub PAT from a SecureString SSM
     parameter and dispatches the configured GitHub Actions workflow via the
     [`workflow_dispatch`](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
     API.
   - If no match is found the invocation exits cleanly — no error.

3. Grants the Lambda the minimum IAM permissions it needs:
   - `amplify:GetApp` (resource `*` — Amplify does not support resource-level
     permissions for this action)
   - `ssm:GetParameter` on the two specific SSM paths

---

## SSM config parameter

The stack creates the config parameter at deployment time with a placeholder
value. **Update it with your real config before or after the first deploy —
no redeployment of the stack is needed.**

Path (default): `/load-test/config`

Shape:

```json
{
  "repos": [
    {
      "repository": "owner/repo",
      "branches": ["uat"],
      "workflow": "load-test.yml",
      "ref": "main"
    }
  ]
}
```

| Field        | Description                                                         |
|--------------|---------------------------------------------------------------------|
| `repository` | `owner/repo` as it appears in the GitHub URL                        |
| `branches`   | Amplify branch names that should trigger the workflow               |
| `workflow`   | Filename of the GitHub Actions workflow (e.g. `load-test.yml`)      |
| `ref`        | Branch or tag to dispatch the workflow on (usually `main`)          |

---

## Required: GitHub PAT (SecureString)

The Lambda reads a GitHub Personal Access Token from SSM. This parameter is
**not created by the stack** — create it out-of-band with the AWS CLI or
console before deploying:

```bash
aws ssm put-parameter \
  --name "/load-test/github-pat" \
  --value "ghp_xxxxxxxxxxxxxxxxxxxx" \
  --type SecureString
```

The PAT needs the `workflow` scope (to dispatch `workflow_dispatch` events).

---

## CDK context values (optional overrides)

Both values have sensible defaults and are optional.

| Context key      | Default                  | Description                              |
|------------------|--------------------------|------------------------------------------|
| `ssmConfigPath`  | `/load-test/config`      | SSM path for the load-test config JSON   |
| `ssmPatPath`     | `/load-test/github-pat`  | SSM path for the GitHub PAT SecureString |

---

## Deploy

### Prerequisites

```bash
npm install
```

Ensure your AWS credentials and default region are configured:

```bash
export CDK_DEFAULT_ACCOUNT=123456789012
export CDK_DEFAULT_REGION=us-east-1
```

### Default deploy (uses `/load-test/config` and `/load-test/github-pat`)

```bash
npx cdk deploy
```

### Deploy with custom SSM paths

```bash
npx cdk deploy \
  --context ssmConfigPath=/my/load-test/config \
  --context ssmPatPath=/my/load-test/github-pat
```

### Synthesise (dry run)

```bash
npx cdk synth
```

---

## How this fits into the overall load test pipeline

```
Amplify deployment (any app, any branch)
        │
        │  EventBridge — source: aws.amplify
        │  detail-type: Amplify Deployment Status Change
        │  detail.jobStatus: SUCCEED
        ▼
┌────────────────────────────┐
│  LoadTestTriggerStack      │  ← this stack
│  EventBridge rule          │
└─────────────┬──────────────┘
              │  Lambda invoke
              ▼
┌────────────────────────────┐
│  LoadTestTriggerFn         │  reads SSM config
│  lambda/index.ts           │  calls amplify:GetApp
└─────────────┬──────────────┘  matches repo + branch
              │
              │  No match → exit cleanly
              │  Match →
              │  POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches
              ▼
┌────────────────────────────┐
│  GitHub Actions            │
│  load-test.yml             │
└─────────────┬──────────────┘
              │
              ▼
       k6 load tests
       (amplify-todo-app/tests/load/)
```

**Related stacks**

- **dast-trigger** — identical EventBridge → SSM → Lambda → GitHub Actions
  pattern used for DAST security scans on Amplify deployments.
