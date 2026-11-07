import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERCEL_APP_URL_RE = /^https:\/\/([a-z0-9-]+)\.vercel\.app$/;
const GIT_SHA_RE = /^[0-9a-f]{40}$/;
const REQUIRED_GUARD_JOB_NAME = "deployment guard (all gates green)";

/**
 * @typedef {object} VercelDeploymentPayload
 * @property {string} [id]
 * @property {string} [uid]
 * @property {string} [url]
 * @property {string} [projectId]
 * @property {string | null} [target]
 * @property {string} [readyState]
 * @property {string} [state]
 * @property {string} [ownerId]
 * @property {{ id?: string }} [team]
 * @property {number} [createdAt]
 * @property {number} [created]
 * @property {{ sha?: string, ref?: string }} [gitSource]
 * @property {Record<string, string | undefined>} [meta]
 * @property {string[]} [aliases]
 */

/**
 * @typedef {object} GithubComparePayload
 * @property {string} [status]
 */

/**
 * @typedef {object} GithubWorkflowJob
 * @property {string} [name]
 * @property {string} [status]
 * @property {string | null} [conclusion]
 */

/**
 * @typedef {object} GithubWorkflowRunSummary
 * @property {number} id
 * @property {string} [name]
 * @property {string} [head_sha]
 * @property {string} [status]
 * @property {string | null} [conclusion]
 * @property {string} [html_url]
 * @property {GithubWorkflowJob[]} [jobs]
 */

/**
 * Parse and strictly validate a `https://<slug>.vercel.app` deployment URL.
 *
 * @param {string} rawUrl
 * @returns {{ url: string, hostname: string }}
 */
export function parseVercelDeploymentUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  const match = VERCEL_APP_URL_RE.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid Vercel deployment URL "${trimmed}": must match https://<deployment>.vercel.app with no path, query, or port.`,
    );
  }
  const parsed = new URL(trimmed);
  return {
    url: `https://${parsed.hostname}`,
    hostname: parsed.hostname,
  };
}

/**
 * Extract and cross-verify the 40-char Git commit SHA from a Vercel deployment object.
 * Rejects deployments with missing or conflicting SHA metadata.
 *
 * @param {VercelDeploymentPayload} deployment
 * @returns {string}
 */
export function extractVerifiedDeploymentCommitSha(deployment) {
  const candidates = [
    { source: "meta.releaseCommitSha", value: deployment?.meta?.releaseCommitSha },
    { source: "gitSource.sha", value: deployment?.gitSource?.sha },
    { source: "meta.githubCommitSha", value: deployment?.meta?.githubCommitSha },
  ]
    .filter((entry) => typeof entry.value === "string" && entry.value.trim().length > 0)
    .map((entry) => ({
      source: entry.source,
      sha: String(entry.value).trim().toLowerCase(),
    }));

  if (candidates.length === 0) {
    throw new Error(
      "Deployment metadata does not contain a verifiable Git commit SHA (meta.releaseCommitSha, gitSource.sha, or meta.githubCommitSha).",
    );
  }

  for (const entry of candidates) {
    if (!GIT_SHA_RE.test(entry.sha)) {
      throw new Error(
        `Deployment SHA in ${entry.source} ("${entry.sha}") is not a valid 40-character hexadecimal commit SHA.`,
      );
    }
  }

  const uniqueShas = Array.from(new Set(candidates.map((entry) => entry.sha)));
  if (uniqueShas.length > 1) {
    const detail = candidates.map((c) => `${c.source}=${c.sha}`).join(", ");
    throw new Error(`Conflicting commit SHAs in Vercel deployment metadata: ${detail}`);
  }

  return uniqueShas[0];
}

/**
 * Validate Vercel deployment ownership, target environment (`production`, NOT Preview),
 * readiness state, and optional expected commit SHA.
 *
 * @param {VercelDeploymentPayload} deployment
 * @param {{ expectedProjectId: string, expectedOrgId: string, expectedCommitSha?: string }} options
 * @returns {{ deploymentId: string, url: string, commitSha: string, target: string, readyState: string, createdAt: string | null }}
 */
export function validateVercelDeploymentMetadata(deployment, options) {
  if (!deployment || typeof deployment !== "object") {
    throw new Error("Vercel inspect response is empty or malformed.");
  }

  const expectedProjectId = String(options.expectedProjectId ?? "").trim();
  const expectedOrgId = String(options.expectedOrgId ?? "").trim();
  if (!expectedProjectId || !expectedOrgId) {
    throw new Error("expectedProjectId and expectedOrgId are required.");
  }

  if (deployment.projectId !== expectedProjectId) {
    throw new Error(
      `Deployment project mismatch: expected "${expectedProjectId}", received "${deployment.projectId ?? "unknown"}".`,
    );
  }

  const ownerId = deployment.team?.id || deployment.ownerId;
  if (ownerId && ownerId !== expectedOrgId) {
    throw new Error(
      `Deployment organization/owner mismatch: expected "${expectedOrgId}", received "${ownerId}".`,
    );
  }

  if (deployment.target !== "production") {
    throw new Error(
      `Refusing to promote non-production deployment (target="${deployment.target ?? "preview"}"). Preview deployments cannot be promoted to Production.`,
    );
  }

  const readyState = deployment.readyState || deployment.state || "UNKNOWN";
  if (readyState !== "READY") {
    throw new Error(
      `Deployment is not READY for promotion (readyState="${readyState}").`,
    );
  }

  const commitSha = extractVerifiedDeploymentCommitSha(deployment);
  const expectedSha = String(options.expectedCommitSha ?? "").trim().toLowerCase();
  if (expectedSha) {
    if (!GIT_SHA_RE.test(expectedSha)) {
      throw new Error(
        `expected_commit_sha "${options.expectedCommitSha}" must be a full 40-character hexadecimal Git SHA.`,
      );
    }
    if (commitSha !== expectedSha) {
      throw new Error(
        `Deployment commit SHA mismatch: expected "${expectedSha}", deployment is built from "${commitSha}".`,
      );
    }
  }

  const deploymentId = String(deployment.id || deployment.uid || "").trim();
  if (!deploymentId) {
    throw new Error("Deployment metadata is missing deployment id.");
  }

  const normalizedHost = String(deployment.url ?? "")
    .trim()
    .replace(/^https?:\/\//, "");
  const canonicalUrl = normalizedHost ? `https://${normalizedHost}` : "";
  const createdMs = deployment.createdAt ?? deployment.created;

  return {
    deploymentId,
    url: canonicalUrl,
    commitSha,
    target: "production",
    readyState,
    createdAt: typeof createdMs === "number" ? new Date(createdMs).toISOString() : null,
  };
}

/**
 * Verify that `commitSha` is part of `main` history (`identical` or `behind`)
 * and has at least one completed successful CI run whose `deployment guard (all gates green)` job passed.
 *
 * @param {{
 *   commitSha: string,
 *   comparePayload: GithubComparePayload,
 *   workflowRuns: GithubWorkflowRunSummary[]
 * }} input
 * @returns {{ ciRunId: number, ciRunUrl: string, branchStatus: string }}
 */
export function validateGithubCiEvidence(input) {
  const commitSha = String(input.commitSha ?? "").trim().toLowerCase();
  const branchStatus = String(input.comparePayload?.status ?? "").trim();

  if (branchStatus !== "identical" && branchStatus !== "behind") {
    throw new Error(
      `Commit ${commitSha} is not on branch main (compare status="${branchStatus || "unknown"}"). Only commits merged to main may be promoted.`,
    );
  }

  const matchingRuns = (input.workflowRuns ?? []).filter((run) => {
    if (String(run.head_sha ?? "").toLowerCase() !== commitSha) return false;
    if (run.status !== "completed" || run.conclusion !== "success") return false;
    const guardJob = (run.jobs ?? []).find((job) => job.name === REQUIRED_GUARD_JOB_NAME);
    return Boolean(guardJob && guardJob.status === "completed" && guardJob.conclusion === "success");
  });

  if (matchingRuns.length === 0) {
    throw new Error(
      `Commit ${commitSha} has no completed successful CI workflow run with passing "${REQUIRED_GUARD_JOB_NAME}".`,
    );
  }

  const bestRun = matchingRuns[0];
  return {
    ciRunId: bestRun.id,
    ciRunUrl: bestRun.html_url || "",
    branchStatus,
  };
}

/**
 * Build the structured release & rollback ledger, filtering candidate rollback targets
 * strictly to READY `target=production` deployments of the same project/org whose SHA
 * also has verified `main` + `deployment guard` evidence.
 *
 * @param {{
 *   mode: "record-candidate" | "verify-promote",
 *   projectId: string,
 *   orgId: string,
 *   targetDeployment: ReturnType<typeof validateVercelDeploymentMetadata> & { url: string },
 *   targetCi: { ciRunId: number, ciRunUrl: string, branchStatus: string },
 *   verifiedRollbackCandidates: Array<{
 *     deploymentId: string,
 *     url: string,
 *     commitSha: string,
 *     createdAt: string | null,
 *     ciRunId: number,
 *     ciRunUrl: string,
 *     isCurrentProductionAlias: boolean
 *   }>
 * }} params
 */
export function buildReleaseLedger(params) {
  const dedupedRollbacks = [];
  const seenUrls = new Set();

  for (const item of params.verifiedRollbackCandidates) {
    if (!item.url || seenUrls.has(item.url)) continue;
    if (item.url === params.targetDeployment.url) continue;
    seenUrls.add(item.url);
    dedupedRollbacks.push(item);
  }

  const previousActiveProduction =
    dedupedRollbacks.find((item) => item.isCurrentProductionAlias) || dedupedRollbacks[0] || null;

  return {
    schemaVersion: 1,
    mode: params.mode,
    recordedAt: new Date().toISOString(),
    projectId: params.projectId,
    orgId: params.orgId,
    verifiedTarget: {
      url: params.targetDeployment.url,
      deploymentId: params.targetDeployment.deploymentId,
      commitSha: params.targetDeployment.commitSha,
      target: params.targetDeployment.target,
      readyState: params.targetDeployment.readyState,
      createdAt: params.targetDeployment.createdAt,
      ciRunId: params.targetCi.ciRunId,
      ciRunUrl: params.targetCi.ciRunUrl,
      mainBranchStatus: params.targetCi.branchStatus,
    },
    previousActiveProduction,
    allowedRollbackDeployments: dedupedRollbacks,
  };
}

/**
 * Render a concise GitHub Step Summary markdown section including the rollback allowlist.
 *
 * @param {ReturnType<typeof buildReleaseLedger>} ledger
 */
export function formatReleaseLedgerMarkdown(ledger) {
  const heading =
    ledger.mode === "verify-promote"
      ? "### Verified Production Domain Promotion Receipt"
      : "### Verified Staged Production Candidate (`--skip-domain`)";

  const lines = [
    heading,
    `- **Deployment URL:** ${ledger.verifiedTarget.url}`,
    `- **Deployment ID:** \`${ledger.verifiedTarget.deploymentId}\``,
    `- **Commit SHA:** \`${ledger.verifiedTarget.commitSha}\` (\`main\` status: \`${ledger.verifiedTarget.mainBranchStatus}\`)`,
    `- **Target / State:** \`${ledger.verifiedTarget.target}\` / \`${ledger.verifiedTarget.readyState}\``,
    `- **Verified CI Run:** [#${ledger.verifiedTarget.ciRunId}](${ledger.verifiedTarget.ciRunUrl || "#"})`,
  ];

  if (ledger.previousActiveProduction) {
    lines.push(
      `- **Immediate Rollback Target:** ${ledger.previousActiveProduction.url} (\`${ledger.previousActiveProduction.commitSha}\`)`,
    );
  }

  lines.push("", "#### Allowed Rollback Deployments (Verified `production` + CI Guard)");
  if (ledger.allowedRollbackDeployments.length === 0) {
    lines.push("_No prior verified production deployments recorded yet._");
  } else {
    lines.push("| Deployment URL | Commit SHA | Created (UTC) | CI Run | Current Prod |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const candidate of ledger.allowedRollbackDeployments) {
      const ciCell = candidate.ciRunUrl
        ? `[#${candidate.ciRunId}](${candidate.ciRunUrl})`
        : `#${candidate.ciRunId}`;
      lines.push(
        `| ${candidate.url} | \`${candidate.commitSha.slice(0, 12)}\` | ${candidate.createdAt ?? "—"} | ${ciCell} | ${candidate.isCurrentProductionAlias ? "Yes" : "No"} |`,
      );
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * @param {string} url
 * @param {string} token
 */
async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "hrp-release-verifier",
    },
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} from ${url}: ${bodyText.slice(0, 300)}`);
  }
  return response.json();
}

/**
 * Fetch CI evidence for a given SHA from GitHub REST API.
 *
 * @param {{ repo: string, commitSha: string, githubToken: string, currentRunId?: number, allowCurrentRunInProgressGuard?: boolean }} params
 */
async function fetchGithubEvidenceForSha(params) {
  const compareUrl = `https://api.github.com/repos/${params.repo}/compare/main...${params.commitSha}`;
  const comparePayload = /** @type {GithubComparePayload} */ (
    await fetchJson(compareUrl, params.githubToken)
  );

  const runsUrl = `https://api.github.com/repos/${params.repo}/actions/workflows/ci.yml/runs?head_sha=${params.commitSha}&per_page=20`;
  const runsData = /** @type {{ workflow_runs?: GithubWorkflowRunSummary[] }} */ (
    await fetchJson(runsUrl, params.githubToken)
  );

  /** @type {GithubWorkflowRunSummary[]} */
  const hydratedRuns = [];
  for (const run of runsData.workflow_runs ?? []) {
    const isCompletedSuccess = run.status === "completed" && run.conclusion === "success";
    const isCurrentActiveDeployRun =
      params.allowCurrentRunInProgressGuard &&
      typeof params.currentRunId === "number" &&
      run.id === params.currentRunId;

    if (!isCompletedSuccess && !isCurrentActiveDeployRun) {
      continue;
    }

    const jobsUrl = `https://api.github.com/repos/${params.repo}/actions/runs/${run.id}/jobs?per_page=50`;
    const jobsData = /** @type {{ jobs?: GithubWorkflowJob[] }} */ (
      await fetchJson(jobsUrl, params.githubToken)
    );
    const jobs = jobsData.jobs ?? [];

    if (isCurrentActiveDeployRun && !isCompletedSuccess) {
      const guardJob = jobs.find((job) => job.name === REQUIRED_GUARD_JOB_NAME);
      if (guardJob && guardJob.status === "completed" && guardJob.conclusion === "success") {
        hydratedRuns.push({
          ...run,
          status: "completed",
          conclusion: "success",
          jobs,
        });
        continue;
      }
    }

    hydratedRuns.push({
      ...run,
      jobs,
    });
  }

  return { comparePayload, workflowRuns: hydratedRuns };
}

async function runCli() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  const mode =
    modeIndex >= 0 && args[modeIndex + 1] === "record-candidate"
      ? "record-candidate"
      : "verify-promote";

  const outIndex = args.indexOf("--output");
  const outputPath =
    outIndex >= 0 && args[outIndex + 1]
      ? args[outIndex + 1]
      : "test-results/release/production-release-ledger.json";

  const rawUrl = process.env.PROMOTE_URL || process.env.DEPLOY_URL || "";
  const vercelToken = process.env.VERCEL_TOKEN || "";
  const vercelOrgId = process.env.VERCEL_ORG_ID || "";
  const vercelProjectId = process.env.VERCEL_PROJECT_ID || "";
  const githubToken = process.env.GITHUB_TOKEN || "";
  const githubRepo = process.env.GITHUB_REPOSITORY || "";
  const expectedCommitSha = process.env.EXPECTED_COMMIT_SHA || "";
  const currentRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined;

  if (!vercelToken || !vercelOrgId || !vercelProjectId) {
    throw new Error("Missing VERCEL_TOKEN, VERCEL_ORG_ID, or VERCEL_PROJECT_ID.");
  }
  if (!githubToken || !githubRepo) {
    throw new Error("Missing GITHUB_TOKEN or GITHUB_REPOSITORY.");
  }

  const parsedTarget = parseVercelDeploymentUrl(rawUrl);
  const teamQuery = vercelOrgId.startsWith("team_")
    ? `teamId=${encodeURIComponent(vercelOrgId)}`
    : "";
  const appendTeam = (/** @type {string} */ base) =>
    teamQuery ? `${base}${base.includes("?") ? "&" : "?"}${teamQuery}` : base;

  const deploymentPayload = /** @type {VercelDeploymentPayload} */ (
    await fetchJson(
      appendTeam(`https://api.vercel.com/v13/deployments/${encodeURIComponent(parsedTarget.hostname)}`),
      vercelToken,
    )
  );

  const validatedTarget = validateVercelDeploymentMetadata(deploymentPayload, {
    expectedProjectId: vercelProjectId,
    expectedOrgId: vercelOrgId,
    expectedCommitSha,
  });

  const targetGithubEvidence = await fetchGithubEvidenceForSha({
    repo: githubRepo,
    commitSha: validatedTarget.commitSha,
    githubToken,
    currentRunId,
    allowCurrentRunInProgressGuard: mode === "record-candidate",
  });

  const validatedCi = validateGithubCiEvidence({
    commitSha: validatedTarget.commitSha,
    comparePayload: targetGithubEvidence.comparePayload,
    workflowRuns: targetGithubEvidence.workflowRuns,
  });

  // Fetch current live production deployment id (if available) + recent READY production deployments
  let currentProdDeploymentId = "";
  try {
    const projectPayload = /** @type {{ targets?: { production?: { id?: string } } }} */ (
      await fetchJson(
        appendTeam(`https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProjectId)}`),
        vercelToken,
      )
    );
    currentProdDeploymentId = String(projectPayload?.targets?.production?.id ?? "");
  } catch {
    // Non-fatal if token lacks project-target read detail; deployment list below still builds rollback candidates.
  }

  const listPayload = /** @type {{ deployments?: VercelDeploymentPayload[] }} */ (
    await fetchJson(
      appendTeam(
        `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(vercelProjectId)}&target=production&state=READY&limit=8`,
      ),
      vercelToken,
    )
  );

  /** @type {Map<string, Awaited<ReturnType<typeof fetchGithubEvidenceForSha>>>} */
  const shaEvidenceCache = new Map();
  shaEvidenceCache.set(validatedTarget.commitSha, targetGithubEvidence);

  const verifiedRollbackCandidates = [];
  for (const candidateRaw of listPayload.deployments ?? []) {
    try {
      const candidateMeta = validateVercelDeploymentMetadata(candidateRaw, {
        expectedProjectId: vercelProjectId,
        expectedOrgId: vercelOrgId,
      });
      if (!candidateMeta.url || candidateMeta.url === parsedTarget.url) continue;

      let evidence = shaEvidenceCache.get(candidateMeta.commitSha);
      if (!evidence) {
        evidence = await fetchGithubEvidenceForSha({
          repo: githubRepo,
          commitSha: candidateMeta.commitSha,
          githubToken,
        });
        shaEvidenceCache.set(candidateMeta.commitSha, evidence);
      }

      const candidateCi = validateGithubCiEvidence({
        commitSha: candidateMeta.commitSha,
        comparePayload: evidence.comparePayload,
        workflowRuns: evidence.workflowRuns,
      });

      verifiedRollbackCandidates.push({
        deploymentId: candidateMeta.deploymentId,
        url: candidateMeta.url,
        commitSha: candidateMeta.commitSha,
        createdAt: candidateMeta.createdAt,
        ciRunId: candidateCi.ciRunId,
        ciRunUrl: candidateCi.ciRunUrl,
        isCurrentProductionAlias:
          Boolean(currentProdDeploymentId) && candidateMeta.deploymentId === currentProdDeploymentId,
      });
    } catch {
      // Unverified or legacy deployments without passing CI guard are excluded from the rollback allowlist!
    }
  }

  const ledger = buildReleaseLedger({
    mode,
    projectId: vercelProjectId,
    orgId: vercelOrgId,
    targetDeployment: {
      ...validatedTarget,
      url: parsedTarget.url,
    },
    targetCi: validatedCi,
    verifiedRollbackCandidates,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");

  const summaryMarkdown = formatReleaseLedgerMarkdown(ledger);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown, "utf8");
  }
  console.log(
    `Verified ${mode} target ${parsedTarget.url} (project=${vercelProjectId}, target=production, sha=${validatedTarget.commitSha}, ciRun=${validatedCi.ciRunId}, rollbackCandidates=${ledger.allowedRollbackDeployments.length}).`,
  );
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  runCli().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
