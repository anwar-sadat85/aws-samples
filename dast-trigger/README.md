# dast-trigger

CDK app that deploys a Lambda function to automatically trigger GitHub Actions DAST workflows when an AWS Amplify deployment succeeds.

## How it works

```
Amplify build succeeds
        │
        ▼
EventBridge rule
(source: aws.amplify, jobStatus: SUCCEED)
        │
        ▼
Lambda function
  1. Calls amplify:GetApp to resolve the GitHub repo URL
  2. Reads /dast/config from SSM to find a matching repo + branch entry
  3. Silently skips if no match
  4. Reads the GitHub PAT from /dast/github-pat (SecureString)
  5. POSTs to the GitHub Actions workflow dispatch API
        │
        ▼
GitHub Actions DAST workflow triggered
```

## Project structure

```
dast-trigger/
├── bin/
│   └── dast-trigger.ts          CDK app entry point
├── lib/
│   └── dast-trigger-stack.ts    Stack definition (Lambda, EventBridge, SSM, IAM)
├── lambda/
│   └── index.ts                 Lambda handler (TypeScript, bundled by esbuild)
├── cdk.json                     CDK config and context defaults
├── package.json
└── tsconfig.json
```

## Prerequisites

- Node.js 22+
- AWS CDK v2 (`npm install -g aws-cdk`)
- AWS credentials configured with permissions to deploy CDK stacks
- A GitHub Personal Access Token (PAT) with `actions:write` scope

## Setup

### 1. Install dependencies

```bash
cd dast-trigger
npm install
```

### 2. Create the GitHub PAT in SSM

The PAT is a `SecureString` that must be created out-of-band before deployment. The stack references it but does not create it.

```bash
aws ssm put-parameter \
  --name /dast/github-pat \
  --value "ghp_yourTokenHere" \
  --type SecureString
```

### 3. Deploy

```bash
cdk deploy
```

The stack creates `/dast/config` with a placeholder value. Update it after deployment (see [Configuration](#configuration)).

### 4. Update the DAST config

```bash
aws ssm put-parameter \
  --name /dast/config \
  --type String \
  --overwrite \
  --value '{
    "repos": [
      {
        "repository": "org/repo-name",
        "branches": ["uat"],
        "workflow": "dast.yml",
        "ref": "dev"
      }
    ]
  }'
```

## Configuration

### SSM Parameter: `/dast/config`

A JSON string defining which Amplify repos and branches should trigger a DAST run.

| Field        | Type       | Description                                              |
|--------------|------------|----------------------------------------------------------|
| `repository` | `string`   | GitHub repo in `owner/repo` format                       |
| `branches`   | `string[]` | Amplify branch names that should trigger a DAST run      |
| `workflow`   | `string`   | Workflow filename or ID (e.g. `dast.yml`)                |
| `ref`        | `string`   | Git ref to dispatch the workflow on (branch, tag, SHA)   |

Example:

```json
{
  "repos": [
    {
      "repository": "my-org/frontend",
      "branches": ["uat", "staging"],
      "workflow": "dast.yml",
      "ref": "dev"
    },
    {
      "repository": "my-org/api",
      "branches": ["uat"],
      "workflow": "security-scan.yml",
      "ref": "main"
    }
  ]
}
```

### SSM Parameter: `/dast/github-pat`

A `SecureString` containing a GitHub PAT with `actions:write` scope. Created manually — never managed by CDK.

### CDK context overrides

The default SSM parameter paths can be overridden at deploy time using CDK context:

```bash
cdk deploy \
  --context ssmConfigPath=/custom/dast/config \
  --context ssmPatPath=/custom/dast/github-pat
```

Defaults are set in `cdk.json`:

| Context key     | Default           |
|-----------------|-------------------|
| `ssmConfigPath` | `/dast/config`    |
| `ssmPatPath`    | `/dast/github-pat`|

## Stack outputs

| Output                    | Description                              |
|---------------------------|------------------------------------------|
| `DastTriggerFunctionArn`  | ARN of the Lambda function               |
| `AmplifySuccessRuleArn`   | ARN of the EventBridge rule              |

## IAM permissions granted to the Lambda

| Permission          | Resource                          | Reason                                      |
|---------------------|-----------------------------------|---------------------------------------------|
| `amplify:GetApp`    | `*`                               | Amplify does not support resource-level ARNs for this action |
| `ssm:GetParameter`  | `/dast/config`                    | Read DAST config                            |
| `ssm:GetParameter` + `kms:Decrypt` | `/dast/github-pat` | Read encrypted GitHub PAT              |

## Updating the config without redeploying

The Lambda reads `/dast/config` on every invocation. To add or remove repos/branches, update the SSM parameter — no redeployment needed.

```bash
aws ssm put-parameter \
  --name /dast/config \
  --type String \
  --overwrite \
  --value "$(cat dast-config.json)"
```

## Useful CDK commands

```bash
npm run build       # Compile TypeScript
cdk synth           # Synthesise CloudFormation template
cdk diff            # Show pending changes
cdk deploy          # Deploy the stack
cdk destroy         # Tear down the stack
```
