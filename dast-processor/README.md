# dast-processor

AWS CDK stack that processes ZAP DAST scan reports uploaded to S3 and imports findings into AWS Security Hub.

## Architecture

```
GitHub Actions
     │
     │  upload report_json.json + rules.tsv
     ▼
S3 Bucket (dast-reports)
     │
     │  s3:ObjectCreated event
     ▼
Lambda (dast-processor)
     │
     ├── reads report_json.json  ──► parse ZAP alerts
     ├── reads rules.tsv         ──► apply suppression rules
     └── BatchImportFindings     ──► AWS Security Hub
```

## S3 Key Convention

GitHub Actions uploads scan artifacts under the following path structure:

```
dast-reports/<owner>/<repo>/<branch>/<scanType>/report_json.json
dast-reports/<owner>/<repo>/<branch>/<scanType>/rules.tsv
```

The Lambda is triggered by the `report_json.json` upload and derives the `rules.tsv` path from the same prefix.

**Supported scan types:** `website`, `rest-api`, `graphql`

## Security Hub Findings

Each ZAP alert becomes one Security Hub finding. Finding IDs are scoped by scan context:

```
dast/<owner>/<repo>/<branch>/<scanType>/<alertRef>
```

For example:
```
dast/myorg/myrepo/prod/zap_rest_api_report/10098
```

Findings use the **Amazon Finding Format (ASFF)** and are imported via `BatchImportFindings` as a custom product (`product/<accountId>/default`).

### Severity mapping

| ZAP riskcode | Security Hub severity |
|---|---|
| 0 | INFORMATIONAL |
| 1 | LOW |
| 2 | MEDIUM |
| 3 | HIGH |

### Finding lifecycle

| Condition | Workflow.Status |
|---|---|
| New or recurring alert | `NEW` |
| Alert suppressed via rules.tsv | `SUPPRESSED` |
| Alert absent from latest scan | `RESOLVED` + `RecordState: ARCHIVED` |

## Suppression Rules (rules.tsv)

Upload a `rules.tsv` file alongside the report to suppress or flag specific ZAP plugin IDs. The file is optional — if absent, all alerts are treated as active.

**Format:** tab-separated, one rule per line.

```tsv
# ruleId	action	description
10096	IGNORE	Timestamp disclosure is a false positive in this app
100000	IGNORE	HTTP 4xx client errors are expected behaviour
10049	WARN	Non-storable content — informational only
```

| Column | Values | Effect |
|---|---|---|
| ruleId | ZAP plugin ID (integer) | Matches `pluginid` in the report |
| action | `IGNORE` | Sets `Workflow.Status = SUPPRESSED` |
| action | `WARN` or `FAIL` | Treated as active (`NEW`) |

Lines starting with `#` and blank lines are ignored.

## CDK Context Parameters

Configure via `cdk.json` or `-c` flags at deploy time.

| Key | Default | Description |
|---|---|---|
| `bucketName` | `dast-reports` | Name of the S3 bucket to create |
| `securityHubRegion` | deploy region | Region where Security Hub findings are imported |
| `companyName` | `My Company` | Value set on the `CompanyName` field of each finding |

## Deployment

### Prerequisites

- AWS CDK v2 installed (`npm install -g aws-cdk`)
- AWS credentials configured
- Security Hub enabled in the target account/region
- Node.js 22.x

### Install dependencies

```bash
cd dast-processor
npm install

cd lambda
npm install
cd ..
```

### Deploy

```bash
cdk deploy
```

With custom context values:

```bash
cdk deploy \
  -c bucketName=my-dast-reports \
  -c companyName="My Org" \
  -c securityHubRegion=us-east-1
```

### Stack outputs

| Output | Description |
|---|---|
| `DastReportsBucketName` | S3 bucket name to configure in GitHub Actions |
| `DastReportsBucketArn` | S3 bucket ARN |
| `DastProcessorFunctionArn` | Lambda function ARN |

## Querying findings

**AWS Console:** Security Hub → Findings → filter by Generator ID prefix `dast/`

**AWS CLI:**

```bash
# All DAST findings
aws securityhub get-findings \
  --filters '{"GeneratorId":[{"Value":"dast/","Comparison":"PREFIX"}]}'

# Open findings for a specific repo and scan type
aws securityhub get-findings \
  --filters '{
    "GeneratorId":[{"Value":"dast/myorg/myrepo/prod/zap_rest_api_report","Comparison":"PREFIX"}],
    "WorkflowStatus":[{"Value":"NEW","Comparison":"EQUALS"}]
  }' \
  --query 'Findings[*].{Id:Id,Title:Title,Severity:Severity.Label}'
```

## S3 Bucket

- Versioning enabled
- All public access blocked
- Objects expire after 90 days
- Removal policy: `RETAIN` (bucket is not deleted on stack destroy)