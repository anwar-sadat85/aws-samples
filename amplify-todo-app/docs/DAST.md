# Dynamic Application Security Testing (DAST)

This document covers the end-to-end DAST setup for the Todo & Tasks app — from the
Amplify build event that fires it, through to the three ZAP scans that run against
the live environment.

---

## How it is triggered

```
Amplify Build (success)
        │
        ▼
  Amazon EventBridge
  (rule: BUILD_SUCCESS on your Amplify app)
        │
        ▼
  Lambda — dast-trigger
  (calls GitHub Actions workflow_dispatch API)
        │
        ▼
  GitHub Actions — DAST Security Scan
  (.github/workflows/dast.yml)
        │
        ├─► Job 1: DAST — Website (SPA)
        ├─► Job 2: DAST — REST API (APIGW + OpenAPI)
        └─► Job 3: DAST — GraphQL (AppSync)
```

The workflow trigger is `workflow_dispatch` — it can also be run manually from the
GitHub Actions UI at any time.

---

## What gets scanned

| Job | Target | ZAP action | Auth header |
|---|---|---|---|
| `dast-website` | React SPA (`DAST_WEBSITE_URL`) | `action-baseline` + AJAX spider | Raw ID token |
| `dast-rest-api` | API Gateway (`REST_API_ENDPOINT`) | `action-api-scan` (OpenAPI) | `Bearer <id_token>` |
| `dast-graphql` | AppSync endpoint (`APPSYNC_ENDPOINT`) | `action-api-scan` (GraphQL) | Raw ID token |

> **Why different auth header formats?**
> API Gateway's Cognito authorizer requires the standard `Authorization: Bearer <token>` format.
> AppSync's Cognito authorizer expects the raw token directly — no `Bearer` prefix.

The REST API scan fetches the live OpenAPI spec from `GET /swagger.json` (public, no auth)
before running, so ZAP always scans against the current API shape.

---

## Architecture — Lambda trigger

### EventBridge rule

Amplify publishes build state-change events to the default EventBridge event bus.
Create a rule that matches successful builds on your specific Amplify app:

```json
{
  "source": ["aws.amplify"],
  "detail-type": ["Amplify Deployment Status Change"],
  "detail": {
    "appId": ["<YOUR_AMPLIFY_APP_ID>"],
    "jobStatus": ["SUCCEED"]
  }
}
```

Set the target to the `dast-trigger` Lambda function.

### Lambda function — `dast-trigger`

The Lambda receives the EventBridge event and calls the GitHub REST API to dispatch
the workflow. The GitHub token is stored in AWS Secrets Manager.

```javascript
// amplify/functions/dast-trigger/handler.mjs
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});

export const handler = async (event) => {
  console.log('Amplify build event:', JSON.stringify(event));

  const { appId, branchName, jobStatus } = event.detail;

  // Only trigger DAST on the main/production branch
  const TARGET_BRANCH = process.env.TARGET_BRANCH ?? 'main';
  if (branchName !== TARGET_BRANCH) {
    console.log(`Branch ${branchName} is not ${TARGET_BRANCH} — skipping DAST`);
    return;
  }

  // Fetch GitHub token from Secrets Manager
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: process.env.GITHUB_TOKEN_SECRET_ARN })
  );
  const githubToken = JSON.parse(secret.SecretString).token;

  // Dispatch the workflow
  const { GITHUB_OWNER, GITHUB_REPO, WORKFLOW_FILE } = process.env;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub dispatch failed (${res.status}): ${text}`);
  }

  console.log(`DAST workflow dispatched for app=${appId} branch=${branchName} status=${jobStatus}`);
};
```

**Lambda environment variables**

| Variable | Value |
|---|---|
| `TARGET_BRANCH` | Branch that should trigger DAST (e.g. `main`) |
| `GITHUB_OWNER` | GitHub org or username |
| `GITHUB_REPO` | Repository name |
| `WORKFLOW_FILE` | `dast.yml` |
| `GITHUB_TOKEN_SECRET_ARN` | ARN of the Secrets Manager secret holding the GitHub token |

**Lambda IAM policy** — the execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "<GITHUB_TOKEN_SECRET_ARN>"
    }
  ]
}
```

No other AWS permissions are required — the Lambda only reads one secret and makes
an outbound HTTPS call to GitHub.

---

## Prerequisites

### 1 — GitHub secrets and variables

Configure these in **Settings → Secrets and variables → Actions** in your repository.

#### Secrets (`secrets.*`)

| Name | Description |
|---|---|
| `COGNITO_CLIENT_ID` | The Amplify-managed user pool **client ID** from `amplify_outputs.json → auth.user_pool_client_id` |
| `DAST_USERNAME` | Email address of the dedicated DAST test account (see below) |
| `DAST_PASSWORD` | Password of the dedicated DAST test account |

#### Variables (`vars.*`)

| Name | Description | Example |
|---|---|---|
| `AWS_ROLE_ARN` | IAM role assumed by the workflow via OIDC | `arn:aws:iam::123456789012:role/GitHubActionsDASTRole` |
| `AWS_REGION` | AWS region of your deployment | `ap-southeast-2` |
| `DAST_WEBSITE_URL` | Public URL of the deployed React SPA | `https://main.abc123.amplifyapp.com` |
| `REST_API_ENDPOINT` | Base URL of the API Gateway stage | `https://mc78q3njaj.execute-api.ap-southeast-2.amazonaws.com/prod` |
| `APPSYNC_ENDPOINT` | AppSync GraphQL URL from `amplify_outputs.json → data.url` | `https://37tklqx52raezhh2y6wcrmlodi.appsync-api.ap-southeast-2.amazonaws.com/graphql` |

### 2 — Dedicated DAST test account

Create a permanent Cognito user used only by the DAST workflow. Never use a real
user's credentials. The workflow authenticates with `USER_PASSWORD_AUTH` (plain
username + password, no SRP challenge) — this is intentional for programmatic
access and is enabled on the user pool client.

```bash
# Create the test user
aws cognito-idp admin-create-user \
  --user-pool-id ap-southeast-2_TNpA4ekC6 \
  --username dast-test@example.com \
  --temporary-password "TempP@ss1" \
  --message-action SUPPRESS \
  --region ap-southeast-2

# Set a permanent password (skips the FORCE_CHANGE_PASSWORD state)
aws cognito-idp admin-set-user-password \
  --user-pool-id ap-southeast-2_TNpA4ekC6 \
  --username dast-test@example.com \
  --password "Perm@nentP@ss1!" \
  --permanent \
  --region ap-southeast-2
```

Store `dast-test@example.com` as `DAST_USERNAME` and the permanent password as
`DAST_PASSWORD` in GitHub Secrets.

### 3 — GitHub Actions IAM role (OIDC)

The workflow uses OIDC to assume an IAM role — no long-lived AWS keys are stored
in GitHub. The role only needs to call `cognito-idp:InitiateAuth` (the user pool
is public; client authentication is handled by the client ID alone).

**Trust policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_OWNER>/<GITHUB_REPO>:*"
        }
      }
    }
  ]
}
```

**Permission policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "cognito-idp:InitiateAuth",
      "Resource": "arn:aws:cognito-idp:ap-southeast-2:<ACCOUNT_ID>:userpool/ap-southeast-2_TNpA4ekC6"
    }
  ]
}
```

### 4 — GitHub token in Secrets Manager (for the Lambda)

Create a **fine-grained personal access token** (or GitHub App installation token)
with the single permission `actions: write` scoped to this repository.

```bash
aws secretsmanager create-secret \
  --name dast-trigger/github-token \
  --secret-string '{"token":"github_pat_XXXX..."}' \
  --region ap-southeast-2
```

Store the returned ARN in the Lambda's `GITHUB_TOKEN_SECRET_ARN` environment variable.

### 5 — ZAP rules file

The workflow references `.zap/rules.tsv` to suppress expected findings. Create the
file if it doesn't exist:

```bash
mkdir -p .zap && touch .zap/rules.tsv
```

Format for suppressing a rule by ID:

```
10035	IGNORE	(Strict-Transport-Security Header Not Set)
```

---

## User pool client — `USER_PASSWORD_AUTH`

The workflow calls `initiate-auth` with `AuthFlow: USER_PASSWORD_AUTH`. This auth
flow is **not enabled by default** on Amplify Gen2 user pool clients (which only
allow SRP by default). It is explicitly enabled in `amplify/backend.ts` via the
CDK escape hatch:

```typescript
const { cfnUserPoolClient } = backend.auth.resources.cfnResources;
cfnUserPoolClient.explicitAuthFlows = [
  'ALLOW_USER_SRP_AUTH',        // Amplify frontend
  'ALLOW_USER_PASSWORD_AUTH',   // DAST workflow
  'ALLOW_REFRESH_TOKEN_AUTH',   // Token refresh
];
```

Without this, every `initiate-auth` call in the workflow would fail with
`NotAuthorizedException: User is not authorized to do this operation`.

---

## Concurrency

The workflow sets `concurrency.group: dast` with `cancel-in-progress: false`.
If a second build succeeds while a scan is already running, the new dispatch is
queued rather than cancelling the in-progress scan. This prevents incomplete
security reports from being uploaded as artifacts.

---

## Artifacts

Each job uploads a ZAP report as a GitHub Actions artifact:

| Artifact | Job |
|---|---|
| `zap_website_report` | Website baseline scan |
| `zap_rest_api_report` | REST API (OpenAPI) scan |
| `zap_graphql_report` | GraphQL (AppSync) scan |

Artifacts are retained for 90 days. Download them from the workflow run summary page
in the **Actions** tab.

---

## Running manually

1. Go to **Actions → DAST Security Scan** in the GitHub repository.
2. Click **Run workflow** → select branch `main` → **Run workflow**.

This is useful for scanning after infrastructure changes that don't trigger an
Amplify build (e.g. updating IAM policies or API Gateway authorizer settings).
