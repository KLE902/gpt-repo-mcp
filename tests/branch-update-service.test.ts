import { describe, expect, test } from "vitest";
import { OperationsPolicy } from "../src/services/operations-policy.js";
import { BranchUpdateService } from "../src/services/branch-update-service.js";

const HEAD = "1".repeat(40);
const BASE = "2".repeat(40);
const MERGED = "3".repeat(40);

type Result = { stdout: string; stderr: string; exit_code: number };

const ok = (stdout = ""): Result => ({ stdout, stderr: "", exit_code: 0 });
const fail = (stdout = "", stderr = "failed"): Result => ({ stdout, stderr, exit_code: 1 });

function policy() {
  return new OperationsPolicy({ enabled: true, git_sync_enabled: true });
}

function baseCalls(command: string): Result | undefined {
  if (command === "check-ref-format --branch feature/demo") return ok("feature/demo\n");
  if (command === "check-ref-format --branch main") return ok("main\n");
  if (command === "rev-parse HEAD") return ok(`${HEAD}\n`);
  if (command === "symbolic-ref --quiet --short HEAD") return ok("feature/demo\n");
  if (command === "rev-parse -q --verify MERGE_HEAD") return fail();
  if (command === "status --porcelain=v1 --untracked-files=all") return ok();
  if (command === "remote get-url origin") return ok("https://github.com/acme/demo.git\n");
  if (command === "ls-remote --heads origin refs/heads/main") return ok(`${BASE}\trefs/heads/main\n`);
  if (command === `fetch --no-tags --no-write-fetch-head origin ${BASE}`) return ok();
  if (command === `cat-file -e ${BASE}^{commit}`) return ok();
  return undefined;
}

describe("BranchUpdateService", () => {
  test("dry-runs a clean diverged update through merge-tree without changing the branch", async () => {
    const calls: string[][] = [];
    const service = new BranchUpdateService("/repo", policy(), {
      git_runner: async (args) => {
        calls.push(args);
        const command = args.join(" ");
        const common = baseCalls(command);
        if (common) return common;
        if (command === `merge-base ${HEAD} ${BASE}`) return ok("0".repeat(40));
        if (command === `merge-tree --write-tree --name-only ${HEAD} ${BASE}`) return ok(`${MERGED}\n`);
        throw new Error(`Unexpected git call: ${command}`);
      }
    });

    const result = await service.update({
      repo_id: "fixture",
      remote: "origin",
      feature_branch: "feature/demo",
      expected_head_sha: HEAD,
      base: "main",
      expected_base_sha: BASE,
      dry_run: true
    });

    expect(result).toMatchObject({ action: "merge", can_update: true, updated: false, head_sha_after: HEAD });
    expect(calls.some((args) => args[0] === "merge")).toBe(false);
  });

  test("returns bounded conflict files without entering merge state", async () => {
    const calls: string[][] = [];
    const service = new BranchUpdateService("/repo", policy(), {
      git_runner: async (args) => {
        calls.push(args);
        const command = args.join(" ");
        const common = baseCalls(command);
        if (common) return common;
        if (command === `merge-base ${HEAD} ${BASE}`) return ok("0".repeat(40));
        if (command === `merge-tree --write-tree --name-only ${HEAD} ${BASE}`) {
          return fail(`${MERGED}\nsrc/a.ts\nsrc/b.ts\n\nCONFLICT (content): Merge conflict in src/a.ts\n`, "");
        }
        throw new Error(`Unexpected git call: ${command}`);
      }
    });

    const result = await service.update({
      repo_id: "fixture",
      remote: "origin",
      feature_branch: "feature/demo",
      expected_head_sha: HEAD,
      base: "main",
      expected_base_sha: BASE,
      dry_run: false
    });

    expect(result).toMatchObject({
      action: "conflicts",
      can_update: false,
      updated: false,
      conflict_files: ["src/a.ts", "src/b.ts"],
      warnings: ["BRANCH_UPDATE_CONFLICTS"]
    });
    expect(calls.some((args) => args[0] === "merge")).toBe(false);
  });

  test("fast-forwards only with fixed arguments and verifies the resulting clean state", async () => {
    const calls: string[][] = [];
    let head = HEAD;
    const service = new BranchUpdateService("/repo", policy(), {
      git_runner: async (args) => {
        calls.push(args);
        const command = args.join(" ");
        if (command === "rev-parse HEAD") return ok(`${head}\n`);
        const common = baseCalls(command);
        if (common) return common;
        if (command === `merge-base ${HEAD} ${BASE}`) return ok(`${HEAD}\n`);
        if (command === `merge --ff-only --no-edit --no-verify ${BASE}`) { head = BASE; return ok(); }
        throw new Error(`Unexpected git call: ${command}`);
      }
    });

    const result = await service.update({
      repo_id: "fixture",
      remote: "origin",
      feature_branch: "feature/demo",
      expected_head_sha: HEAD,
      base: "main",
      expected_base_sha: BASE,
      dry_run: false
    });

    expect(result).toMatchObject({ action: "fast_forward", updated: true, head_sha_after: BASE });
    expect(calls).toContainEqual(["merge", "--ff-only", "--no-edit", "--no-verify", BASE]);
  });

  test("aborts an unexpected merge failure and proves the original clean state", async () => {
    let abortCalled = false;
    const service = new BranchUpdateService("/repo", policy(), {
      git_runner: async (args) => {
        const command = args.join(" ");
        const common = baseCalls(command);
        if (common) return common;
        if (command === `merge-base ${HEAD} ${BASE}`) return ok("0".repeat(40));
        if (command === `merge-tree --write-tree --name-only ${HEAD} ${BASE}`) return ok(`${MERGED}\n`);
        if (command === `merge --no-ff --no-edit --no-verify ${BASE}`) return fail("", "hook failed");
        if (command === "merge --abort") { abortCalled = true; return ok(); }
        throw new Error(`Unexpected git call: ${command}`);
      }
    });

    await expect(service.update({
      repo_id: "fixture",
      remote: "origin",
      feature_branch: "feature/demo",
      expected_head_sha: HEAD,
      base: "main",
      expected_base_sha: BASE,
      dry_run: false
    })).rejects.toMatchObject({ code: "GIT_BRANCH_UPDATE_FAILED" });
    expect(abortCalled).toBe(true);
  });

  test("rejects protected branches, dirty worktrees, and stale remote base SHAs", async () => {
    const protectedService = new BranchUpdateService("/repo", policy(), { git_runner: async () => ok() });
    await expect(protectedService.update({
      repo_id: "fixture", remote: "origin", feature_branch: "main", expected_head_sha: HEAD,
      base: "develop", expected_base_sha: BASE, dry_run: true
    })).rejects.toMatchObject({ code: "GIT_DIRECT_BASE_PUSH_BLOCKED" });

    const dirtyService = new BranchUpdateService("/repo", policy(), {
      git_runner: async (args) => {
        const command = args.join(" ");
        if (command === "status --porcelain=v1 --untracked-files=all") return ok(" M src/app.ts\n");
        const common = baseCalls(command);
        return common ?? fail();
      }
    });
    await expect(dirtyService.update({
      repo_id: "fixture", remote: "origin", feature_branch: "feature/demo", expected_head_sha: HEAD,
      base: "main", expected_base_sha: BASE, dry_run: true
    })).rejects.toMatchObject({ code: "GIT_WORKTREE_DIRTY" });

    const staleService = new BranchUpdateService("/repo", policy(), {
      git_runner: async (args) => {
        const common = baseCalls(args.join(" "));
        return common ?? fail();
      }
    });
    await expect(staleService.update({
      repo_id: "fixture", remote: "origin", feature_branch: "feature/demo", expected_head_sha: HEAD,
      base: "main", expected_base_sha: "4".repeat(40), dry_run: true
    })).rejects.toMatchObject({ code: "GIT_REMOTE_HEAD_MISMATCH" });
  });
});
