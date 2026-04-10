import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  BatchImportFindingsCommand,
  GetFindingsCommand,
  SecurityHubClient,
  type AwsSecurityFinding,
} from "@aws-sdk/client-securityhub";
import type { S3Event } from "aws-lambda";

// ── Types ─────────────────────────────────────────────────────────────────────

type RuleAction = "IGNORE" | "WARN" | "FAIL";

interface ZapAlert {
  pluginid: string;
  alertRef: string;
  alert: string;
  name: string;
  riskcode: string;
  confidence: string;
  riskdesc: string;
  desc: string;
  instances: unknown[];
  count: string;
  solution: string;
  reference: string;
  cweid: string;
  wascid: string;
  sourceid: string;
}

interface ZapSite {
  "@name": string;
  alerts: ZapAlert[];
}

interface ZapReport {
  site: ZapSite[];
}

// ── AWS SDK clients (re-used across warm invocations) ─────────────────────────

const s3 = new S3Client({});

const securityHubRegion = process.env.SECURITY_HUB_REGION ?? process.env.AWS_REGION_NAME ?? process.env.AWS_REGION;
const securityHub = new SecurityHubClient({ region: securityHubRegion });

const accountId = process.env.AWS_ACCOUNT_ID ?? "";
const region = process.env.AWS_REGION_NAME ?? process.env.AWS_REGION ?? "";

const companyName = process.env.COMPANY_NAME ?? "My Company";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function s3GetString(bucket: string, key: string): Promise<string> {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  return response.Body!.transformToString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstUrl(reference: string): string {
  // Stop at '<' to avoid capturing trailing HTML tags like </p>
  const match = reference.match(/https?:\/\/[^<\s]+/);
  return match ? match[0] : "";
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + "…";
}

function mapSeverity(
  riskcode: string
): "INFORMATIONAL" | "LOW" | "MEDIUM" | "HIGH" {
  switch (riskcode) {
    case "0":
      return "INFORMATIONAL";
    case "1":
      return "LOW";
    case "2":
      return "MEDIUM";
    case "3":
      return "HIGH";
    default:
      return "MEDIUM";
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── STEP 2: Parse rules.tsv ────────────────────────────────────────────────────

async function loadRules(
  bucket: string,
  rulesKey: string
): Promise<Map<number, RuleAction>> {
  const rules = new Map<number, RuleAction>();

  try {
    const tsv = await s3GetString(bucket, rulesKey);
    for (const line of tsv.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split("\t");
      if (parts.length < 2) continue;
      const ruleId = parseInt(parts[0]!, 10);
      const action = parts[1]!.trim().toUpperCase() as RuleAction;
      if (!isNaN(ruleId) && ["IGNORE", "WARN", "FAIL"].includes(action)) {
        rules.set(ruleId, action);
      }
    }
  } catch (err: unknown) {
    const code = (err as { name?: string; Code?: string }).name ?? (err as { Code?: string }).Code;
    if (code === "NoSuchKey") {
      console.log(`[dast-processor] rules.tsv not found at ${rulesKey} — continuing without suppression rules`);
    } else {
      throw err;
    }
  }

  return rules;
}

// ── STEP 5: Query existing open findings ──────────────────────────────────────

async function getExistingFindingIds(generatorId: string): Promise<Set<string>> {
  const existingIds = new Set<string>();

  let nextToken: string | undefined;
  do {
    const response = await securityHub.send(
      new GetFindingsCommand({
        Filters: {
          GeneratorId: [{ Value: generatorId, Comparison: "PREFIX" }],
          WorkflowStatus: [
            { Value: "NEW", Comparison: "EQUALS" },
            { Value: "NOTIFIED", Comparison: "EQUALS" },
            { Value: "IN_PROGRESS", Comparison: "EQUALS" },
          ],
        },
        NextToken: nextToken,
        MaxResults: 100,
      })
    );

    for (const finding of response.Findings ?? []) {
      if (finding.Id) existingIds.add(finding.Id);
    }
    nextToken = response.NextToken;
  } while (nextToken);

  return existingIds;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    console.log(`[dast-processor] Processing s3://${bucket}/${key}`);

    // Parse metadata from S3 key:
    // dast-reports/<repoOwner>/<repoName>/<branch>/<scanType>/report_json.json
    const parts = key.split("/");
    if (parts.length < 6) {
      console.error(`[dast-processor] Unexpected key format: ${key}`);
      continue;
    }

    const repoOwner = parts[1]!;
    const repoName = parts[2]!;
    const branch = parts[3]!;
    const scanType = parts[4]!;
    const repo = `${repoOwner}/${repoName}`;
    const generatorId = `dast/${repo}/${branch}/${scanType}`;

    const now = new Date().toISOString();

    // STEP 1 — Read report_json.json
    const reportJson = await s3GetString(bucket, key);
    const report: ZapReport = JSON.parse(reportJson) as ZapReport;

    // STEP 2 — Read rules.tsv
    const rulesKey = key.replace("report_json.json", "rules.tsv");
    const rules = await loadRules(bucket, rulesKey);

    // STEP 3 — Extract all alerts across all sites
    const allAlerts: ZapAlert[] = [];
    for (const site of report.site ?? []) {
      allAlerts.push(...(site.alerts ?? []));
    }

    // STEP 4 — Apply rules.tsv suppression and build finding IDs
    const productArn = `arn:aws:securityhub:${region}:${accountId}:product/${accountId}/default`;

    const activeFindings: AwsSecurityFinding[] = [];
    const currentAlertIds = new Set<string>();

    for (const alert of allAlerts) {
      const pluginId = alert.pluginid;
      // Use alertRef (e.g. "90004-2") as the unique ID so that multiple alert
      // variants sharing the same pluginid (e.g. COEP/COOP/CORP all use 90004)
      // produce distinct Security Hub findings rather than colliding on the same Id.
      const alertRef = alert.alertRef;
      const findingId = `dast/${repo}/${branch}/${scanType}/${alertRef}`;
      currentAlertIds.add(findingId);

      // Rules are keyed by pluginid — suppression applies to all variants.
      const ruleAction = rules.get(parseInt(pluginId, 10));
      const isSuppressed = ruleAction === "IGNORE";
      // Security Hub BatchImportFindings only accepts: NEW, NOTIFIED, RESOLVED, SUPPRESSED.
      // "ACTIVE" is a RecordState value, not a valid Workflow.Status.
      const workflowStatus = isSuppressed ? "SUPPRESSED" : "NEW";

      const finding: AwsSecurityFinding = {
        SchemaVersion: "2018-10-08",
        Id: findingId,
        ProductArn: productArn,
        GeneratorId: generatorId,
        AwsAccountId: accountId,
        Types: ["Software and Configuration Checks/Vulnerabilities/CVE"],
        FirstObservedAt: now,
        LastObservedAt: now,
        CreatedAt: now,
        UpdatedAt: now,
        Severity: { Label: mapSeverity(alert.riskcode) },
        CompanyName: companyName,
        ProductName: "DAST",
        Title: alert.name,
        Description: stripHtml(alert.desc) || "No description provided",
        Remediation: {
          Recommendation: {
            // Security Hub hard limit: 512 characters
            Text: truncate(stripHtml(alert.solution) || "No remediation available", 512),
          },
        },
        ...(firstUrl(alert.reference) && { SourceUrl: firstUrl(alert.reference) }),
        Resources: [
          {
            Type: "Other",
            Id: `${repo}/${branch}`,
            Details: {
              Other: {
                Repository: repo,
                Branch: branch,
                ScanType: scanType,
                PluginId: pluginId,
                AlertRef: alertRef,
                CweId: alert.cweid,
                WascId: alert.wascid,
                InstanceCount: alert.count,
              },
            },
          },
        ],
        Workflow: { Status: workflowStatus },
        RecordState: "ACTIVE",
        UserDefinedFields: {
          Repository: repo,
          Branch: branch,
          ScanType: scanType,
          ZapPluginId: pluginId,
          ZapAlertRef: alertRef,
        },
      };

      activeFindings.push(finding);
    }

    // STEP 5 — Query existing open Security Hub findings
    const existingIds = await getExistingFindingIds(generatorId);

    // STEP 7 — Build resolved findings for alerts no longer present
    const resolvedFindings: AwsSecurityFinding[] = [];
    for (const existingId of existingIds) {
      if (!currentAlertIds.has(existingId)) {
        resolvedFindings.push({
          SchemaVersion: "2018-10-08",
          Id: existingId,
          ProductArn: productArn,
          GeneratorId: generatorId,
          AwsAccountId: accountId,
          Types: ["Software and Configuration Checks/Vulnerabilities/CVE"],
          CreatedAt: now,
          UpdatedAt: now,
          LastObservedAt: now,
          FirstObservedAt: now,
          Severity: { Label: "INFORMATIONAL" },
          CompanyName: companyName,
          ProductName: "DAST",
          Title: "Resolved finding",
          Description: "This finding is no longer present in the latest DAST scan.",
          Resources: [{ Type: "Other", Id: `${repo}/${branch}` }],
          Workflow: { Status: "RESOLVED" },
          RecordState: "ARCHIVED",
        });
      }
    }

    // STEP 8 — Batch import to Security Hub (max 100 per call)
    const allFindings = [...activeFindings, ...resolvedFindings];
    const suppressed = activeFindings.filter((f) => f.Workflow?.Status === "SUPPRESSED").length;
    const active = activeFindings.length - suppressed;

    console.log(
      `[dast-processor] Importing ${active} active, ${suppressed} suppressed, ${resolvedFindings.length} resolved findings`
    );

    for (const batch of chunk(allFindings, 100)) {
      const response = await securityHub.send(
        new BatchImportFindingsCommand({ Findings: batch })
      );

      if (response.FailedCount && response.FailedCount > 0) {
        console.error(
          `[dast-processor] ${response.FailedCount} findings failed to import:`,
          JSON.stringify(response.FailedFindings)
        );
      }
    }

    console.log(`[dast-processor] Done processing ${key}`);
  }
};