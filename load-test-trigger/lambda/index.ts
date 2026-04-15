import { AmplifyClient, GetAppCommand } from "@aws-sdk/client-amplify";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AmplifyDeploymentEvent {
  source: string;
  "detail-type": string;
  detail: {
    appId: string;
    branchName: string;
    jobId: string;
    jobStatus: string;
    jobType: string;
  };
}

interface RepoConfig {
  repository: string; // "owner/repo"
  branches: string[];
  workflow: string;   // e.g. "load-test.yml"
  ref: string;        // branch/tag to dispatch the workflow on
}

interface LoadTestConfig {
  repos: RepoConfig[];
}

// ── AWS SDK clients (re-used across warm invocations) ─────────────────────────

const amplify = new AmplifyClient({});
const ssm = new SSMClient({});

// ── Helper: fetch a plain or SecureString SSM parameter ───────────────────────

async function getParameter(name: string, withDecryption = false): Promise<string> {
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: name, WithDecryption: withDecryption })
  );
  const value = Parameter?.Value;
  if (!value) throw new Error(`SSM parameter not found or empty: ${name}`);
  return value;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event: AmplifyDeploymentEvent): Promise<void> => {
  const { appId, branchName } = event.detail;

  const ssmConfigPath = process.env.SSM_CONFIG_PATH ?? "/load-test/config";
  const ssmPatPath = process.env.SSM_PAT_PATH ?? "/load-test/github-pat";

  // 1. Resolve the GitHub repository URL from Amplify
  const { app } = await amplify.send(new GetAppCommand({ appId }));
  const repositoryUrl = app?.repository;

  if (!repositoryUrl) {
    console.log(`[load-test-trigger] appId=${appId} has no repository configured — skipping`);
    return;
  }

  // 2. Parse "owner/repo" from https://github.com/owner/repo
  const repoMatch = repositoryUrl.match(/https:\/\/github\.com\/([^/]+\/[^/\s]+)/);
  if (!repoMatch) {
    console.log(`[load-test-trigger] Could not parse GitHub URL "${repositoryUrl}" — skipping`);
    return;
  }
  const repoPath = repoMatch[1].replace(/\.git$/, "");

  // 3. Load config from SSM — branch/repo filtering lives here so the rule
  //    never needs redeployment when targets change.
  const configJson = await getParameter(ssmConfigPath);
  const config: LoadTestConfig = JSON.parse(configJson);

  // 4. Find a matching entry for this repo + branch
  const match = config.repos?.find(
    (r) => r.repository === repoPath && r.branches.includes(branchName)
  );

  if (!match) {
    console.log(
      `[load-test-trigger] No config match for ${repoPath}@${branchName} — skipping`
    );
    return;
  }

  // 5. Read the GitHub PAT (SecureString — requires decryption)
  const token = await getParameter(ssmPatPath, true);

  // 6. Dispatch the GitHub Actions load-test workflow
  const dispatchUrl = `https://api.github.com/repos/${repoPath}/actions/workflows/${match.workflow}/dispatches`;

  const response = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: match.ref, inputs: { profile: "load" } }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `[load-test-trigger] GitHub API error for ${repoPath}@${branchName}: HTTP ${response.status} — ${body}`
    );
  }

  console.log(
    `[load-test-trigger] Successfully dispatched workflow "${match.workflow}" ` +
      `for ${repoPath}@${branchName} (ref: ${match.ref})`
  );
};
