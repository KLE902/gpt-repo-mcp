import { describe, expect, test } from "vitest";
import { OperationsPolicy } from "../src/services/operations-policy.js";
import { RemoteGitService } from "../src/services/remote-git-service.js";

const HEAD = "1".repeat(40);
const BRANCH = "2".repeat(40);
const BASE = "3".repeat(40);

function lifecyclePolicy(): OperationsPolicy {
  return new OperationsPolicy({
    enabled: true,
    git_branch_manage_enabled: true,
    git_push_enabled: true
  });
}

describe("branch lifecycle", () => {
  test("audits a fully merged standalone branch as safe to retire", async () => {
    const service = createService();

    const result = await service.auditBranch({
      repo_id: "fixture",
      remote: "origin",
      branch: "feature/old",
      base: "main"
    });

    expect(result).toMatchObject({
      ok: true,
      branch: "feature/old",
      base: "main",
      current_branch: "main",
      head_sha: HEAD,
      clean: true,
      local_branch_sha: BRANCH,
      remote_branch_sha: BRANCH,
      branch_sha: BRANCH,
      base_sha: BASE,
      merge_base_sha: BRANCH,
      ahead: 0,
      behind: 3,
      merged_into_base: true,
      patch_equivalent_to_base: false,
      unique_patch_commits: [],
      merged_pull_requests: [],
      retirement_evidence: "ancestry",
      open_pull_requests: [],
      safe_to_retire: true,
      warnings: []
    });
  });

  test("reports divergent local and remote refs as unsafe", async () => {
    const remoteBranch = "4".repeat(40);
    const service = createService({ remoteBranch });

    const result = await service.auditBranch({
      repo_id: "fixture",
      remote: "origin",
      branch: "feature/old",
      base: "main"
    });

    expect(result.safe_to_retire).toBe(false);
    expect(result.warnings).toContain("BRANCH_REF_DIVERGED");
    expect(result.local_branch_sha).toBe(BRANCH);
    expect(result.remote_branch_sha).toBe(remoteBranch);
  });

  test("accepts branch-only commits when every patch is already present in the base", async () => {
    const first = "5".repeat(40);
    const second = "6".repeat(40);
    const service = createService({ merged: false, ahead: 2, cherry: `- ${first}\n- ${second}\n` });

    const result = await service.auditBranch({ repo_id: "fixture", remote: "origin", branch: "feature/old", base: "main" });

    expect(result).toMatchObject({
      merged_into_base: false,
      patch_equivalent_to_base: true,
      unique_patch_commits: [],
      merged_pull_requests: [],
      retirement_evidence: "patch_equivalent",
      safe_to_retire: true
    });
    expect(result.warnings).toContain("BRANCH_PATCH_EQUIVALENT_TO_BASE");
  });

  test("accepts a squash-merged branch only when a merged PR targets the base with the exact head SHA", async () => {
    const unique = "7".repeat(40);
    const service = createService({ merged: false, ahead: 2, cherry: `+ ${unique}\n`, mergedPull: true });

    const result = await service.auditBranch({ repo_id: "fixture", remote: "origin", branch: "feature/old", base: "main" });

    expect(result).toMatchObject({
      merged_into_base: false,
      patch_equivalent_to_base: false,
      unique_patch_commits: [unique],
      retirement_evidence: "merged_pull_request",
      safe_to_retire: true,
      merged_pull_requests: [{ number: 4, head_sha: BRANCH, base_ref: "main", merged: true }]
    });
    expect(result.warnings).toContain("BRANCH_HEAD_MERGED_BY_PULL_REQUEST");
  });

  test("deletes only exact verified local and origin refs after all guards pass", async () => {
    let localExists = true;
    let remoteExists = true;
    const calls: string[][] = [];
    const service = createService({
      calls,
      localExists: () => localExists,
      remoteExists: () => remoteExists,
      deleteLocal: () => { localExists = false; },
      deleteRemote: () => { remoteExists = false; }
    });

    const result = await service.retireBranch({
      repo_id: "fixture",
      remote: "origin",
      branch: "feature/old",
      expected_head_sha: HEAD,
      expected_branch_sha: BRANCH,
      base: "main",
      expected_base_sha: BASE,
      owner_approved: true,
      delete_local_branch: true,
      delete_remote_branch: true,
      dry_run: false
    });

    expect(result).toMatchObject({
      ok: true,
      dry_run: false,
      branch: "feature/old",
      branch_sha: BRANCH,
      base_sha: BASE,
      ahead: 0,
      behind: 3,
      local_branch_deleted: true,
      retirement_evidence: "ancestry",
      remote_branch_deleted: true,
      warnings: []
    });
    expect(calls).toContainEqual(["branch", "-D", "feature/old"]);
    expect(calls).toContainEqual(["push", "--porcelain", "origin", ":refs/heads/feature/old"]);
  });

  test("blocks retirement when the branch has commits not contained in the base", async () => {
    const service = createService({ merged: false, ahead: 1, behind: 3, cherry: `+ ${"8".repeat(40)}\n` });

    await expect(service.retireBranch({
      repo_id: "fixture",
      remote: "origin",
      branch: "feature/old",
      expected_head_sha: HEAD,
      expected_branch_sha: BRANCH,
      base: "main",
      expected_base_sha: BASE,
      owner_approved: true,
      delete_local_branch: true,
      delete_remote_branch: false,
      dry_run: true
    })).rejects.toMatchObject({ code: "GIT_BRANCH_NOT_MERGED" });
  });
});

type ServiceOptions = {
  remoteBranch?: string;
  merged?: boolean;
  ahead?: number;
  behind?: number;
  cherry?: string;
  mergedPull?: boolean;
  calls?: string[][];
  localExists?: () => boolean;
  remoteExists?: () => boolean;
  deleteLocal?: () => void;
  deleteRemote?: () => void;
};

function createService(options: ServiceOptions = {}): RemoteGitService {
  const remoteBranch = options.remoteBranch ?? BRANCH;
  const merged = options.merged ?? true;
  const ahead = options.ahead ?? 0;
  const behind = options.behind ?? 3;
  const localExists = options.localExists ?? (() => true);
  const remoteExists = options.remoteExists ?? (() => true);
  return new RemoteGitService("/repo", lifecyclePolicy(), {
    git_runner: async (args) => {
      options.calls?.push(args);
      const command = args.join(" ");
      if (command === "rev-parse HEAD") return HEAD;
      if (command === "symbolic-ref --quiet --short HEAD") return "main";
      if (command === "status --porcelain=v1 --untracked-files=all") return "";
      if (command === "check-ref-format --branch feature/old") return "feature/old";
      if (command === "check-ref-format --branch main") return "main";
      if (command === "remote get-url origin") return "https://github.com/acme/demo.git";
      if (command === "rev-parse refs/heads/feature/old") {
        if (!localExists()) throw new Error("missing local ref");
        return BRANCH;
      }
      if (command === "ls-remote --heads origin refs/heads/feature/old") {
        return remoteExists() ? `${remoteBranch}\trefs/heads/feature/old` : "";
      }
      if (command === "ls-remote --heads origin refs/heads/main") return `${BASE}\trefs/heads/main`;
      if (command === `cat-file -e ${BRANCH}^{commit}` || command === `cat-file -e ${BASE}^{commit}`) return "";
      if (command === `merge-base ${BRANCH} ${BASE}`) return BRANCH;
      if (command === `rev-list --left-right --count ${BASE}...${BRANCH}`) return `${behind}\t${ahead}`;
      if (command === `merge-base --is-ancestor ${BRANCH} ${BASE}`) {
        if (!merged) throw new Error("not ancestor");
        return "";
      }
      if (command === `cherry ${BASE} ${BRANCH}`) return options.cherry ?? "";
      if (command === "branch -D feature/old") {
        options.deleteLocal?.();
        return "Deleted branch feature/old";
      }
      if (command === "push --porcelain origin :refs/heads/feature/old") {
        options.deleteRemote?.();
        return "ok";
      }
      throw new Error(`Unexpected git call: ${command}`);
    },
    gh_runner: async (args) => {
      if (args.includes("pr") && args.includes("list") && args.includes("open")) return "[]";
      if (args.includes("pr") && args.includes("list") && args.includes("closed")) {
        if (!options.mergedPull) return "[]";
        return JSON.stringify([{
          number: 4,
          title: "Squash merged branch",
          state: "MERGED",
          isDraft: false,
          url: "https://github.com/acme/demo/pull/4",
          headRefName: "feature/old-original",
          headRefOid: BRANCH,
          baseRefName: "main",
          baseRefOid: BASE,
          mergeable: "UNKNOWN",
          mergeStateStatus: "UNKNOWN",
          mergedAt: "2026-07-22T10:00:00Z",
          body: null
        }]);
      }
      throw new Error(`Unexpected gh call: ${args.join(" ")}`);
    }
  });
}
