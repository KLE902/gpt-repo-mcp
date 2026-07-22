import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BranchUpdateInput, BranchUpdateResult } from "../contracts/branch-update.contract.js";
import { RepoReaderError } from "../runtime/errors.js";
import { parseGitHubRemote } from "./remote-git-service.js";
import type { OperationsPolicy } from "./operations-policy.js";

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const MAX_CONFLICT_FILES = 50;

type GitResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
};

type GitRunner = (args: string[]) => Promise<GitResult>;

type BranchUpdateServiceOptions = {
  git_runner?: GitRunner;
};

export class BranchUpdateService {
  private readonly gitRunner: GitRunner;

  constructor(
    private readonly root: string,
    private readonly policy: OperationsPolicy,
    options: BranchUpdateServiceOptions = {}
  ) {
    this.gitRunner = options.git_runner ?? ((args) => runGit(this.root, args));
  }

  async update(input: BranchUpdateInput): Promise<BranchUpdateResult> {
    this.assertOrigin(input.remote);
    this.policy.assertSyncAllowed();
    this.assertSafeFeatureBranch(input.feature_branch);
    await this.validateBranch(input.feature_branch);
    await this.validateBranch(input.base);
    if (input.feature_branch === input.base) {
      throw new RepoReaderError("GIT_BRANCH_MISMATCH", "Feature branch and base branch must be different.");
    }

    const headBefore = await this.checkedText(["rev-parse", "HEAD"]);
    if (headBefore !== input.expected_head_sha) {
      throw new RepoReaderError("GIT_HEAD_MISMATCH", `Expected HEAD ${input.expected_head_sha}, found ${headBefore}.`);
    }
    const currentBranch = await this.currentBranch();
    if (currentBranch !== input.feature_branch) {
      throw new RepoReaderError("GIT_BRANCH_MISMATCH", `Expected current branch ${input.feature_branch}, found ${currentBranch}.`);
    }
    await this.assertNoMergeInProgress();
    await this.assertCleanWorktree();

    const remoteUrl = await this.checkedText(["remote", "get-url", input.remote]);
    parseGitHubRemote(remoteUrl);
    const baseSha = await this.remoteBranchSha(input.remote, input.base);
    if (baseSha !== input.expected_base_sha) {
      throw new RepoReaderError("GIT_REMOTE_HEAD_MISMATCH", `Expected ${input.remote}/${input.base} at ${input.expected_base_sha}, found ${baseSha}.`);
    }

    await this.checked(["fetch", "--no-tags", "--no-write-fetch-head", input.remote, baseSha]);
    await this.checked(["cat-file", "-e", `${baseSha}^{commit}`]);

    const mergeBaseResult = await this.gitRunner(["merge-base", headBefore, baseSha]);
    if (mergeBaseResult.exit_code !== 0) {
      throw new RepoReaderError("GIT_BRANCH_UPDATE_FAILED", "Feature branch and base branch do not have a common ancestor.");
    }
    const mergeBase = mergeBaseResult.stdout.trim();

    if (mergeBase === baseSha) {
      return this.result(input, headBefore, headBefore, baseSha, "up_to_date", true, false, [], false, []);
    }

    const action = mergeBase === headBefore ? "fast_forward" as const : "merge" as const;
    if (action === "merge") {
      const preflight = await this.gitRunner(["merge-tree", "--write-tree", "--name-only", headBefore, baseSha]);
      if (preflight.exit_code !== 0) {
        const parsed = parseConflictFiles(preflight.stdout, preflight.stderr);
        return this.result(
          input,
          headBefore,
          headBefore,
          baseSha,
          "conflicts",
          false,
          false,
          parsed.files,
          parsed.truncated,
          ["BRANCH_UPDATE_CONFLICTS"]
        );
      }
    }

    if (input.dry_run) {
      return this.result(input, headBefore, headBefore, baseSha, action, true, false, [], false, []);
    }

    const mergeArgs = action === "fast_forward"
      ? ["merge", "--ff-only", "--no-edit", "--no-verify", baseSha]
      : ["merge", "--no-ff", "--no-edit", "--no-verify", baseSha];
    const mergeResult = await this.gitRunner(mergeArgs);
    if (mergeResult.exit_code !== 0) {
      await this.abortAndVerify(headBefore);
      throw new RepoReaderError("GIT_BRANCH_UPDATE_FAILED", boundedGitMessage("Conflict-free branch update failed and was aborted.", mergeResult));
    }

    const headAfter = await this.checkedText(["rev-parse", "HEAD"]);
    const branchAfter = await this.currentBranch();
    if (branchAfter !== input.feature_branch) {
      throw new RepoReaderError("GIT_BRANCH_UPDATE_FAILED", `Branch changed unexpectedly from ${input.feature_branch} to ${branchAfter}.`);
    }
    await this.assertNoMergeInProgress();
    await this.assertCleanWorktree();
    if (headAfter === headBefore) {
      throw new RepoReaderError("GIT_BRANCH_UPDATE_FAILED", "Git reported success but the feature-branch HEAD did not change.");
    }

    return this.result(input, headBefore, headAfter, baseSha, action, true, true, [], false, []);
  }

  private result(
    input: BranchUpdateInput,
    headBefore: string,
    headAfter: string,
    baseSha: string,
    action: BranchUpdateResult["action"],
    canUpdate: boolean,
    updated: boolean,
    conflictFiles: string[],
    conflictsTruncated: boolean,
    warnings: string[]
  ): BranchUpdateResult {
    return {
      ok: true,
      dry_run: input.dry_run,
      remote: input.remote,
      feature_branch: input.feature_branch,
      base: input.base,
      head_sha_before: headBefore,
      head_sha_after: headAfter,
      base_sha: baseSha,
      action,
      can_update: canUpdate,
      updated,
      conflict_files: conflictFiles,
      conflicts_truncated: conflictsTruncated,
      warnings
    };
  }

  private async abortAndVerify(expectedHead: string): Promise<void> {
    const abort = await this.gitRunner(["merge", "--abort"]);
    const actualHead = await this.checkedText(["rev-parse", "HEAD"]);
    const mergeHead = await this.gitRunner(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    const status = await this.checkedText(["status", "--porcelain=v1", "--untracked-files=all"]);
    if (abort.exit_code !== 0 || actualHead !== expectedHead || mergeHead.exit_code === 0 || status.length > 0) {
      throw new RepoReaderError("GIT_BRANCH_UPDATE_RECOVERY_FAILED", "Git could not prove that the failed branch update was fully aborted.");
    }
  }

  private async assertNoMergeInProgress(): Promise<void> {
    const mergeHead = await this.gitRunner(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    if (mergeHead.exit_code === 0) {
      throw new RepoReaderError("GIT_BRANCH_UPDATE_IN_PROGRESS", "A Git merge is already in progress; branch update is blocked.");
    }
  }

  private async assertCleanWorktree(): Promise<void> {
    const status = await this.checkedText(["status", "--porcelain=v1", "--untracked-files=all"]);
    if (status.length > 0) {
      throw new RepoReaderError("GIT_WORKTREE_DIRTY", "Branch update requires a clean worktree and index.");
    }
  }

  private async currentBranch(): Promise<string> {
    const result = await this.gitRunner(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const branch = result.stdout.trim();
    if (result.exit_code !== 0 || !branch) {
      throw new RepoReaderError("GIT_DETACHED_HEAD", "Branch update requires a named current branch.");
    }
    return branch;
  }

  private async remoteBranchSha(remote: string, branch: string): Promise<string> {
    const output = await this.checkedText(["ls-remote", "--heads", remote, `refs/heads/${branch}`]);
    const sha = output.split(/\s+/u)[0] ?? "";
    if (!SHA_PATTERN.test(sha)) {
      throw new RepoReaderError("GIT_REMOTE_BRANCH_NOT_FOUND", `Remote branch ${remote}/${branch} was not found.`);
    }
    return sha.toLowerCase();
  }

  private async validateBranch(branch: string): Promise<void> {
    const result = await this.gitRunner(["check-ref-format", "--branch", branch]);
    if (result.exit_code !== 0 || result.stdout.trim() !== branch) {
      throw new RepoReaderError("GIT_BRANCH_INVALID", `Invalid Git branch name: ${branch}`);
    }
  }

  private assertSafeFeatureBranch(branch: string): void {
    if (["main", "master"].includes(branch.toLowerCase())) {
      throw new RepoReaderError("GIT_DIRECT_BASE_PUSH_BLOCKED", `Branch update refuses protected base branch ${branch}.`);
    }
  }

  private assertOrigin(remote: string): void {
    if (remote !== "origin") {
      throw new RepoReaderError("GIT_REMOTE_NOT_ALLOWED", "Only the configured origin remote is allowed.");
    }
  }

  private async checked(args: string[]): Promise<GitResult> {
    const result = await this.gitRunner(args);
    if (result.exit_code !== 0) {
      throw new RepoReaderError("GIT_ERROR", boundedGitMessage(`Git command failed: git ${args.join(" ")}`, result));
    }
    return result;
  }

  private async checkedText(args: string[]): Promise<string> {
    return (await this.checked(args)).stdout.trim();
  }
}

async function runGit(root: string, args: string[]): Promise<GitResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
        GIT_EDITOR: "true",
        GIT_MERGE_AUTOEDIT: "no"
      },
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
    return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), exit_code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number | string };
    const numericCode = typeof failure.code === "number" ? failure.code : 1;
    return {
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
      exit_code: numericCode
    };
  }
}

function parseConflictFiles(stdout: string, stderr: string): { files: string[]; truncated: boolean } {
  const candidates = `${stdout}\n${stderr}`
    .split(/[\0\r\n]+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !SHA_PATTERN.test(line))
    .filter((line) => !/^(Auto-merging|CONFLICT|hint:|fatal:|error:)/iu.test(line))
    .filter((line) => !line.includes("Merge conflict"));
  const files = [...new Set(candidates)].slice(0, MAX_CONFLICT_FILES);
  return { files, truncated: candidates.length > files.length };
}

function boundedGitMessage(prefix: string, result: GitResult): string {
  const detail = [result.stderr, result.stdout].map((value) => value.trim()).filter(Boolean).join("\n").slice(0, 2000);
  return detail ? `${prefix} ${detail}` : prefix;
}
