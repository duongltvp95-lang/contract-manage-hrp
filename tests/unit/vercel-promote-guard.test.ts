import { describe, expect, it } from "vitest";
import {
  buildReleaseLedger,
  extractVerifiedDeploymentCommitSha,
  formatReleaseLedgerMarkdown,
  parseVercelDeploymentUrl,
  validateGithubCiEvidence,
  validateVercelDeploymentMetadata,
} from "../../scripts/verify-vercel-promote-target.mjs";

const SHA_CANDIDATE = "a".repeat(40);
const SHA_ROLLBACK = "b".repeat(40);

describe("verify-vercel-promote-target guard", () => {
  it("accepts only bare https://<slug>.vercel.app URLs", () => {
    expect(parseVercelDeploymentUrl("https://contract-manage-hrp-abc123.vercel.app")).toEqual({
      url: "https://contract-manage-hrp-abc123.vercel.app",
      hostname: "contract-manage-hrp-abc123.vercel.app",
    });

    expect(() => parseVercelDeploymentUrl("http://contract-manage-hrp-abc123.vercel.app")).toThrow();
    expect(() =>
      parseVercelDeploymentUrl("https://contract-manage-hrp-abc123.vercel.app/api"),
    ).toThrow();
    expect(() => parseVercelDeploymentUrl("https://evil.example.com")).toThrow();
  });

  it("rejects Preview deployments, foreign projects/orgs, non-READY builds, and SHA mismatches", () => {
    const validProdDeployment = {
      id: "dpl_prod_123",
      url: "contract-manage-hrp-abc123.vercel.app",
      projectId: "prj_hrp",
      team: { id: "team_hrp" },
      target: "production",
      readyState: "READY",
      createdAt: 1762490000000,
      gitSource: { sha: SHA_CANDIDATE },
      meta: {
        releaseCommitSha: SHA_CANDIDATE,
        githubCommitSha: SHA_CANDIDATE,
      },
    };

    const verified = validateVercelDeploymentMetadata(validProdDeployment, {
      expectedProjectId: "prj_hrp",
      expectedOrgId: "team_hrp",
      expectedCommitSha: SHA_CANDIDATE,
    });
    expect(verified).toMatchObject({
      deploymentId: "dpl_prod_123",
      url: "https://contract-manage-hrp-abc123.vercel.app",
      commitSha: SHA_CANDIDATE,
      target: "production",
      readyState: "READY",
    });

    // Preview deployment (target = null) MUST be rejected even if projectId matches
    expect(() =>
      validateVercelDeploymentMetadata(
        { ...validProdDeployment, target: null },
        { expectedProjectId: "prj_hrp", expectedOrgId: "team_hrp" },
      ),
    ).toThrow(/Preview deployments cannot be promoted/i);

    // Foreign Vercel project MUST be rejected
    expect(() =>
      validateVercelDeploymentMetadata(
        { ...validProdDeployment, projectId: "prj_other" },
        { expectedProjectId: "prj_hrp", expectedOrgId: "team_hrp" },
      ),
    ).toThrow(/project mismatch/i);

    // Foreign Vercel team/owner MUST be rejected
    expect(() =>
      validateVercelDeploymentMetadata(
        { ...validProdDeployment, team: { id: "team_other" } },
        { expectedProjectId: "prj_hrp", expectedOrgId: "team_hrp" },
      ),
    ).toThrow(/organization\/owner mismatch/i);

    // Non-READY deployment MUST be rejected
    expect(() =>
      validateVercelDeploymentMetadata(
        { ...validProdDeployment, readyState: "ERROR" },
        { expectedProjectId: "prj_hrp", expectedOrgId: "team_hrp" },
      ),
    ).toThrow(/not READY/i);

    // Operator expected_commit_sha mismatch MUST be rejected
    expect(() =>
      validateVercelDeploymentMetadata(validProdDeployment, {
        expectedProjectId: "prj_hrp",
        expectedOrgId: "team_hrp",
        expectedCommitSha: SHA_ROLLBACK,
      }),
    ).toThrow(/commit SHA mismatch/i);

    // Conflicting gitSource.sha vs meta.releaseCommitSha MUST be rejected
    expect(() =>
      extractVerifiedDeploymentCommitSha({
        gitSource: { sha: SHA_CANDIDATE },
        meta: { releaseCommitSha: SHA_ROLLBACK },
      }),
    ).toThrow(/Conflicting commit SHAs/i);
  });

  it("requires commit ancestry on main and a green deployment guard job in GitHub Actions", () => {
    const passingRun = {
      id: 42332524499,
      head_sha: SHA_CANDIDATE,
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/duongltvp95-lang/contract-manage-hrp/actions/runs/42332524499",
      jobs: [
        {
          name: "deployment guard (all gates green)",
          status: "completed",
          conclusion: "success",
        },
      ],
    };

    expect(
      validateGithubCiEvidence({
        commitSha: SHA_CANDIDATE,
        comparePayload: { status: "identical" },
        workflowRuns: [passingRun],
      }),
    ).toEqual({
      ciRunId: 42332524499,
      ciRunUrl: passingRun.html_url,
      branchStatus: "identical",
    });

    // Historical commit on `main` (`behind`) is valid for verified rollback
    expect(
      validateGithubCiEvidence({
        commitSha: SHA_CANDIDATE,
        comparePayload: { status: "behind" },
        workflowRuns: [passingRun],
      }).branchStatus,
    ).toBe("behind");

    // Unmerged PR / feature branch commit (`ahead` or `diverged`) MUST be rejected
    expect(() =>
      validateGithubCiEvidence({
        commitSha: SHA_CANDIDATE,
        comparePayload: { status: "ahead" },
        workflowRuns: [passingRun],
      }),
    ).toThrow(/not on branch main/i);

    // Missing or failed deployment guard job MUST be rejected
    expect(() =>
      validateGithubCiEvidence({
        commitSha: SHA_CANDIDATE,
        comparePayload: { status: "identical" },
        workflowRuns: [
          {
            ...passingRun,
            jobs: [
              {
                name: "deployment guard (all gates green)",
                status: "completed",
                conclusion: "failure",
              },
            ],
          },
        ],
      }),
    ).toThrow(/deployment guard/i);
  });

  it("builds a deduplicated rollback allowlist ledger and markdown receipt", () => {
    const ledger = buildReleaseLedger({
      mode: "verify-promote",
      projectId: "prj_hrp",
      orgId: "team_hrp",
      targetDeployment: {
        deploymentId: "dpl_new",
        url: "https://hrp-new.vercel.app",
        commitSha: SHA_CANDIDATE,
        target: "production",
        readyState: "READY",
        createdAt: "2026-11-07T03:00:00.000Z",
      },
      targetCi: {
        ciRunId: 200,
        ciRunUrl: "https://github.com/org/repo/actions/runs/200",
        branchStatus: "identical",
      },
      verifiedRollbackCandidates: [
        {
          deploymentId: "dpl_new",
          url: "https://hrp-new.vercel.app",
          commitSha: SHA_CANDIDATE,
          createdAt: "2026-11-07T03:00:00.000Z",
          ciRunId: 200,
          ciRunUrl: "https://github.com/org/repo/actions/runs/200",
          isCurrentProductionAlias: false,
        },
        {
          deploymentId: "dpl_prev",
          url: "https://hrp-prev.vercel.app",
          commitSha: SHA_ROLLBACK,
          createdAt: "2026-11-06T03:00:00.000Z",
          ciRunId: 100,
          ciRunUrl: "https://github.com/org/repo/actions/runs/100",
          isCurrentProductionAlias: true,
        },
      ],
    });

    expect(ledger.allowedRollbackDeployments).toHaveLength(1);
    expect(ledger.previousActiveProduction?.url).toBe("https://hrp-prev.vercel.app");

    const md = formatReleaseLedgerMarkdown(ledger);
    expect(md).toContain("https://hrp-new.vercel.app");
    expect(md).toContain("https://hrp-prev.vercel.app");
    expect(md).toContain("Allowed Rollback Deployments");
  });
});
