import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CheckSummary,
  CreateBranchInput,
  MergePullRequestInput,
  PullRequest,
  PullRequestInput,
  PushInput,
  RemoteStatusInput,
  SyncBaseInput
} from "../contracts/remote-git.contract.js";
import type {
  BranchListInput,
  FinalizePullRequestInput,
  PullRequestStateInput,
  SwitchBranchInput,
  WorkflowDispatchInput
} from "../contracts/autonomous-operations.contract.js";
import { RepoReaderError, toRepoReaderError } from "../runtime/errors.js";
import { GitHubClient, type GitHubCheckRun, type GitHubCombinedStatus, type GitHubPull } from "./github-client.js";
import { OperationsPolicy } from "./operations-policy.js";

const execFileAsync = promisify(execFile);
type GitRunner = (args: string[]) => Promise<string>;

type RemoteGitServiceOptions = {
  git_runner?: GitRunner;
  fetch_impl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

type GitHubRepository = { owner: string; name: string; html_url: string };

export class RemoteGitService {
  private readonly gitRunner: GitRunner;
  private readonly github: GitHubClient;

  constructor(
    private readonly root: string,
    private readonly policy: OperationsPolicy,
    options: RemoteGitServiceOptions = {}
  ) {
    this.gitRunner = options.git_runner ?? (async (args) => {
      try {
        const result = await execFileAsync("git", args, {
          cwd: this.root,
          env: gitTransportEnv(),
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          timeout: 30_000
        });
        return String(result.stdout);
      } catch (error) {
        throw gitError(error);
      }
    });
    this.github = new GitHubClient({ fetch_impl: options.fetch_impl, env: options.env });
  }

  async createBranch(input: CreateBranchInput) {
    this.policy.assertBranchAllowed();
    const state = await this.localState(input.expected_head_sha, input.expected_source_branch);
    await this.validateBranch(input.branch);
    if (input.branch === "main" || input.branch === "master") {
      throw new RepoReaderError("GIT_BRANCH_INVALID", "The new feature branch cannot be named main or master.");
    }
    if (input.branch === state.branch || await this.tryGit(["show-ref", "--verify", "--hash", `refs/heads/${input.branch}`])) {
      throw new RepoReaderError("GIT_BRANCH_EXISTS", `Local branch ${input.branch} already exists; this tool only creates a new branch.`);
    }
    const warnings = state.clean ? [] : ["WORKTREE_CHANGES_CARRIED_TO_NEW_BRANCH"];
    if (input.dry_run) {
      return {
        ok: true as const,
        dry_run: true,
        source_branch: state.branch,
        branch: input.branch,
        head_sha: state.head,
        created: false,
        worktree_clean: state.clean,
        warnings
      };
    }
    await this.runGit(["switch", "-c", input.branch]);
    const after = await this.localState();
    if (after.branch !== input.branch || after.head !== state.head) {
      throw new RepoReaderError("GIT_BRANCH_CREATE_FAILED", "Git did not leave the repository on the expected new branch and unchanged HEAD.", {
        diagnostics: {
          expected_branch: input.branch,
          actual_branch: after.branch,
          expected_head_sha: state.head,
          actual_head_sha: after.head
        }
      });
    }
    return {
      ok: true as const,
      dry_run: false,
      source_branch: state.branch,
      branch: after.branch,
      head_sha: after.head,
      created: true,
      worktree_clean: state.clean,
      warnings
    };
  }

  async branches(input: BranchListInput) {
    this.assertOrigin(input.remote);
    const state = await this.localState();
    const localOutput = await this.runGit(["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads"]);
    const remoteOutput = await this.runGit(["ls-remote", "--heads", input.remote]);
    return {
      ok: true as const,
      remote: input.remote,
      current_branch: state.branch,
      head_sha: state.head,
      clean: state.clean,
      local_branches: parseBranchLines(localOutput, state.branch, false),
      remote_branches: parseBranchLines(remoteOutput, state.branch, true),
      warnings: [] as string[]
    };
  }

  async switchBranch(input: SwitchBranchInput) {
    this.policy.assertBranchManageAllowed();
    const state = await this.localState(input.expected_head_sha, input.expected_current_branch);
    this.assertClean(state.clean);
    await this.validateBranch(input.branch);
    const target = await this.tryGit(["rev-parse", `refs/heads/${input.branch}`]);
    if (!target) throw new RepoReaderError("GIT_BRANCH_NOT_FOUND", `Local branch ${input.branch} does not exist.`);
    if (input.dry_run || input.branch === state.branch) {
      return {
        ok: true as const,
        dry_run: input.dry_run,
        previous_branch: state.branch,
        branch: input.branch,
        head_sha: input.branch === state.branch ? state.head : target,
        switched: false,
        warnings: input.branch === state.branch ? ["BRANCH_ALREADY_CHECKED_OUT"] : []
      };
    }
    await this.runGit(["switch", input.branch]);
    const after = await this.localState();
    if (after.branch !== input.branch || after.head !== target) {
      throw new RepoReaderError("GIT_BRANCH_SWITCH_FAILED", "Git did not leave the repository on the expected existing branch and HEAD.");
    }
    return {
      ok: true as const,
      dry_run: false,
      previous_branch: state.branch,
      branch: after.branch,
      head_sha: after.head,
      switched: true,
      warnings: [] as string[]
    };
  }

  async status(input: RemoteStatusInput) {
    this.assertOrigin(input.remote);
    const state = await this.localState();
    const repository = await this.repositoryFor(input.remote);
    const warnings: string[] = [];
    const upstream = await this.tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
    let ahead: number | undefined;
    let behind: number | undefined;
    if (upstream) {
      const counts = (await this.runGit(["rev-list", "--left-right", "--count", `HEAD...${upstream}`])).split(/\s+/).map(Number);
      ahead = counts[0];
      behind = counts[1];
    }
    const remoteHeadSha = await this.readRemoteHead(input.remote, state.branch);
    let pullRequest: PullRequest | undefined;
    let checks: CheckSummary | undefined;
    try {
      const pull = input.pull_number
        ? await this.github.getPull(repository.owner, repository.name, input.pull_number)
        : (await this.github.listOpenPulls(repository.owner, repository.name, state.branch))[0];
      if (pull) {
        pullRequest = mapPull(pull);
        const collected = await this.collectChecks(repository, pull.head.sha);
        checks = collected.summary;
        warnings.push(...collected.warnings);
      }
    } catch (error) {
      warnings.push(toRepoReaderError(error).code);
    }
    return {
      ok: true as const,
      remote: input.remote,
      repository,
      branch: state.branch,
      head_sha: state.head,
      clean: state.clean,
      ...(upstream ? { upstream } : {}),
      ...(ahead === undefined ? {} : { ahead }),
      ...(behind === undefined ? {} : { behind }),
      ...(remoteHeadSha ? { remote_head_sha: remoteHeadSha } : {}),
      pushed: remoteHeadSha === state.head,
      ...(pullRequest ? { pull_request: pullRequest } : {}),
      ...(checks ? { checks } : {}),
      warnings: unique(warnings)
    };
  }

  async push(input: PushInput) {
    this.assertOrigin(input.remote);
    this.policy.assertPushAllowed();
    const state = await this.localState(input.expected_head_sha, input.expected_branch);
    if (state.branch === "main" || state.branch === "master") {
      throw new RepoReaderError("GIT_DIRECT_BASE_PUSH_BLOCKED", "Direct push to main or master is blocked; use a feature branch and pull request.");
    }
    this.assertClean(state.clean);
    await this.validateBranch(input.expected_branch);
    const repository = await this.repositoryFor(input.remote);
    const before = await this.readRemoteHead(input.remote, state.branch);
    if (input.dry_run) {
      return {
        ok: true as const,
        dry_run: true,
        remote: input.remote,
        repository,
        branch: state.branch,
        head_sha: state.head,
        ...(before ? { remote_head_sha: before } : {}),
        pushed: false,
        ...(input.set_upstream ? { upstream: `${input.remote}/${state.branch}` } : {}),
        warnings: before && before !== state.head ? ["REMOTE_BRANCH_WILL_ADVANCE"] : []
      };
    }
    const args = ["push", "--porcelain"];
    if (input.set_upstream) args.push("--set-upstream");
    args.push(input.remote, `refs/heads/${state.branch}:refs/heads/${state.branch}`);
    await this.runGit(args);
    const remoteHeadSha = await this.readRemoteHead(input.remote, state.branch);
    if (remoteHeadSha !== state.head) {
      throw new RepoReaderError("GIT_REMOTE_HEAD_MISMATCH", "Remote branch did not resolve to the expected local HEAD after push.", {
        diagnostics: { expected_head_sha: state.head, remote_head_sha: remoteHeadSha }
      });
    }
    return {
      ok: true as const,
      dry_run: false,
      remote: input.remote,
      repository,
      branch: state.branch,
      head_sha: state.head,
      remote_head_sha: remoteHeadSha,
      pushed: true,
      ...(input.set_upstream ? { upstream: `${input.remote}/${state.branch}` } : {}),
      warnings: []
    };
  }

  async pullRequestState(input: PullRequestStateInput) {
    this.assertOrigin(input.remote);
    this.policy.assertPullRequestStateAllowed();
    const repository = await this.repositoryFor(input.remote);
    const pull = await this.github.getPull(repository.owner, repository.name, input.pull_number);
    if (pull.head.sha !== input.expected_pull_head_sha) {
      throw new RepoReaderError("GITHUB_PR_HEAD_MISMATCH", "Pull request head changed before its state could be updated.");
    }
    if (pull.merged) throw new RepoReaderError("GITHUB_PR_STATE_INVALID", "Merged pull requests cannot be changed by this state tool.");
    if (input.action === "ready") {
      if (pull.state !== "open") throw new RepoReaderError("GITHUB_PR_NOT_OPEN", "Only an open draft pull request can be marked ready.");
      if (input.dry_run || !pull.draft) {
        return { ok: true as const, dry_run: input.dry_run, action: input.action, changed: false, pull_request: mapPull(pull), warnings: pull.draft ? [] : ["PULL_REQUEST_ALREADY_READY"] };
      }
      const updated = await this.github.markPullReady(repository.owner, repository.name, pull.number);
      return { ok: true as const, dry_run: false, action: input.action, changed: true, pull_request: mapPull(updated), warnings: [] as string[] };
    }
    if (input.dry_run || pull.state === "closed") {
      return { ok: true as const, dry_run: input.dry_run, action: input.action, changed: false, pull_request: mapPull(pull), warnings: pull.state === "closed" ? ["PULL_REQUEST_ALREADY_CLOSED"] : [] };
    }
    const updated = await this.github.closePull(repository.owner, repository.name, pull.number);
    return { ok: true as const, dry_run: false, action: input.action, changed: true, pull_request: mapPull(updated), warnings: [] as string[] };
  }

  async finalizePullRequest(input: FinalizePullRequestInput) {
    this.assertOrigin(input.remote);
    this.policy.assertBranchManageAllowed();
    this.policy.assertSyncAllowed();
    if (input.delete_remote_branch) this.policy.assertPushAllowed();
    const state = await this.localState(input.expected_head_sha);
    this.assertClean(state.clean);
    const repository = await this.repositoryFor(input.remote);
    const pull = await this.github.getPull(repository.owner, repository.name, input.pull_number);
    if (!pull.merged) throw new RepoReaderError("GITHUB_PR_NOT_MERGED", "Post-merge finalization requires a confirmed merged pull request.");
    if (pull.head.sha !== input.expected_pull_head_sha) throw new RepoReaderError("GITHUB_PR_HEAD_MISMATCH", "Merged pull request head does not match the approved cleanup SHA.");
    await this.validateBranch(pull.base.ref);
    await this.validateBranch(pull.head.ref);
    const remoteBaseSha = await this.readRemoteHead(input.remote, pull.base.ref);
    if (!remoteBaseSha) throw new RepoReaderError("GIT_REMOTE_BRANCH_NOT_FOUND", `Remote base branch ${pull.base.ref} was not found.`);
    const localFeatureSha = await this.tryGit(["rev-parse", `refs/heads/${pull.head.ref}`]);
    if (localFeatureSha && localFeatureSha !== input.expected_pull_head_sha) {
      throw new RepoReaderError("GIT_HEAD_MISMATCH", "Local feature branch no longer points to the merged pull-request head.");
    }
    const remoteFeatureSha = await this.readRemoteHead(input.remote, pull.head.ref);
    if (remoteFeatureSha && remoteFeatureSha !== input.expected_pull_head_sha) {
      throw new RepoReaderError("GIT_REMOTE_HEAD_MISMATCH", "Remote feature branch no longer points to the merged pull-request head.");
    }
    if (input.dry_run) {
      return {
        ok: true as const, dry_run: true, pull_request: mapPull(pull), base: pull.base.ref, base_sha: remoteBaseSha,
        switched_to_base: false, local_branch_deleted: false, remote_branch_deleted: false,
        warnings: [
          ...(localFeatureSha ? [] : ["LOCAL_BRANCH_ALREADY_ABSENT"]),
          ...(input.delete_remote_branch && !remoteFeatureSha ? ["REMOTE_BRANCH_ALREADY_ABSENT"] : [])
        ]
      };
    }
    await this.performSync(input.remote, pull.base.ref, state, false);
    let switched = false;
    if (state.branch !== pull.base.ref) {
      await this.runGit(["switch", pull.base.ref]);
      switched = true;
    }
    const baseState = await this.localState();
    if (baseState.branch !== pull.base.ref || baseState.head !== remoteBaseSha) {
      throw new RepoReaderError("GIT_BRANCH_SWITCH_FAILED", "Local base did not match the synchronized remote base after switching.");
    }
    let localDeleted = false;
    if (localFeatureSha && pull.head.ref !== pull.base.ref) {
      await this.runGit(["branch", "-D", pull.head.ref]);
      if (await this.tryGit(["rev-parse", `refs/heads/${pull.head.ref}`])) throw new RepoReaderError("GIT_BRANCH_DELETE_FAILED", "Local feature branch still exists after deletion.");
      localDeleted = true;
    }
    let remoteDeleted = false;
    if (input.delete_remote_branch && remoteFeatureSha && pull.head.ref !== pull.base.ref) {
      await this.runGit(["push", "--porcelain", input.remote, `:refs/heads/${pull.head.ref}`]);
      if (await this.readRemoteHead(input.remote, pull.head.ref)) throw new RepoReaderError("GIT_BRANCH_DELETE_FAILED", "Remote feature branch still exists after deletion.");
      remoteDeleted = true;
    }
    return {
      ok: true as const, dry_run: false, pull_request: mapPull(pull), base: pull.base.ref, base_sha: remoteBaseSha,
      switched_to_base: switched, local_branch_deleted: localDeleted, remote_branch_deleted: remoteDeleted,
      warnings: [
        ...(localFeatureSha ? [] : ["LOCAL_BRANCH_ALREADY_ABSENT"]),
        ...(input.delete_remote_branch && !remoteFeatureSha ? ["REMOTE_BRANCH_ALREADY_ABSENT"] : [])
      ]
    };
  }

  async dispatchWorkflow(input: WorkflowDispatchInput) {
    this.assertOrigin(input.remote);
    this.policy.assertWorkflowAllowed(input.workflow_id);
    await this.validateBranch(input.ref);
    const remoteRefSha = await this.readRemoteHead(input.remote, input.ref);
    if (!remoteRefSha) throw new RepoReaderError("GIT_REMOTE_BRANCH_NOT_FOUND", `Remote workflow ref ${input.ref} was not found.`);
    if (remoteRefSha !== input.expected_ref_sha) {
      throw new RepoReaderError("GIT_REMOTE_HEAD_MISMATCH", "Remote workflow ref changed before dispatch.", {
        diagnostics: { expected_head_sha: input.expected_ref_sha, actual_head_sha: remoteRefSha }
      });
    }
    const repository = await this.repositoryFor(input.remote);
    const inputNames = Object.keys(input.inputs).sort();
    if (!input.dry_run) await this.github.dispatchWorkflow(repository.owner, repository.name, input.workflow_id, input.ref, input.inputs);
    return { ok: true as const, dry_run: input.dry_run, workflow_id: input.workflow_id, ref: input.ref, dispatched: !input.dry_run, input_names: inputNames, warnings: [] as string[] };
  }

  async pullRequest(input: PullRequestInput) {
    this.assertOrigin(input.remote);
    this.policy.assertPullRequestAllowed();
    const state = await this.localState(input.expected_head_sha, input.expected_branch);
    this.assertClean(state.clean);
    await this.validateBranch(input.expected_branch);
    await this.validateBranch(input.base);
    const repository = await this.repositoryFor(input.remote);
    const remoteHead = await this.readRemoteHead(input.remote, state.branch);
    if (remoteHead !== state.head) {
      throw new RepoReaderError("GIT_REMOTE_HEAD_MISMATCH", "Push the current branch before creating or updating its pull request.", {
        diagnostics: { expected_head_sha: state.head, remote_head_sha: remoteHead }
      });
    }
    const matches = await this.github.listOpenPulls(repository.owner, repository.name, state.branch);
    const existing = matches[0];
    const warnings = matches.length > 1 ? ["MULTIPLE_OPEN_PULL_REQUESTS"] : [];
    if (!existing) {
      if (input.dry_run) {
        return {
          ok: true as const,
          dry_run: true,
          action: "would_create" as const,
          remote: input.remote,
          branch: state.branch,
          head_sha: state.head,
          base: input.base,
          warnings
        };
      }
      const created = await this.github.createPull(repository.owner, repository.name, {
        title: input.title,
        head: state.branch,
        base: input.base,
        ...(input.body === undefined ? {} : { body: input.body }),
        draft: input.draft
      });
      return {
        ok: true as const,
        dry_run: false,
        action: "created" as const,
        remote: input.remote,
        branch: state.branch,
        head_sha: state.head,
        base: input.base,
        pull_request: mapPull(created),
        warnings
      };
    }
    const update: { title?: string; body?: string; base?: string } = {};
    if (existing.title !== input.title) update.title = input.title;
    if (input.body !== undefined && (existing.body ?? "") !== input.body) update.body = input.body;
    if (existing.base.ref !== input.base) update.base = input.base;
    if (existing.draft !== input.draft) warnings.push("EXISTING_PR_DRAFT_STATE_PRESERVED");
    const changed = Object.keys(update).length > 0;
    if (input.dry_run) {
      return {
        ok: true as const,
        dry_run: true,
        action: changed ? "would_update" as const : "unchanged" as const,
        remote: input.remote,
        branch: state.branch,
        head_sha: state.head,
        base: input.base,
        pull_request: mapPull(existing),
        warnings: unique(warnings)
      };
    }
    const pull = changed
      ? await this.github.updatePull(repository.owner, repository.name, existing.number, update)
      : existing;
    return {
      ok: true as const,
      dry_run: false,
      action: changed ? "updated" as const : "unchanged" as const,
      remote: input.remote,
      branch: state.branch,
      head_sha: state.head,
      base: input.base,
      pull_request: mapPull(pull),
      warnings: unique(warnings)
    };
  }

  async syncBase(input: SyncBaseInput) {
    this.assertOrigin(input.remote);
    this.policy.assertSyncAllowed();
    const state = await this.localState(input.expected_head_sha);
    this.assertClean(state.clean);
    await this.validateBranch(input.base);
    await this.repositoryFor(input.remote);
    return this.performSync(input.remote, input.base, state, input.dry_run);
  }

  async mergePullRequest(input: MergePullRequestInput) {
    this.assertOrigin(input.remote);
    this.policy.assertMergeAllowed();
    const state = await this.localState(input.expected_head_sha);
    this.assertClean(state.clean);
    const repository = await this.repositoryFor(input.remote);
    const pull = await this.github.getPull(repository.owner, repository.name, input.pull_number);
    if (pull.head.sha !== input.expected_pull_head_sha) {
      throw new RepoReaderError("GITHUB_PR_HEAD_MISMATCH", "Pull request head changed after owner review; review the new head before merging.", {
        diagnostics: { expected_head_sha: input.expected_pull_head_sha, actual_head_sha: pull.head.sha }
      });
    }
    if (pull.state !== "open" || pull.merged) {
      throw new RepoReaderError("GITHUB_PR_NOT_OPEN", "Pull request is not open and mergeable through this workflow.");
    }
    if (pull.mergeable === false) {
      throw new RepoReaderError("GITHUB_PR_NOT_MERGEABLE", "GitHub reports that the pull request cannot currently be merged.");
    }
    const collected = await this.collectChecks(repository, pull.head.sha);
    if (input.require_checks_passed && collected.summary.overall !== "success") {
      throw new RepoReaderError("GITHUB_CHECKS_NOT_PASSED", `Pull request checks are ${collected.summary.overall}; merge was not attempted.`, {
        diagnostics: { checks_overall: collected.summary.overall }
      });
    }
    if (input.dry_run) {
      return {
        ok: true as const,
        dry_run: true,
        pull_request: mapPull(pull),
        checks: collected.summary,
        merge_method: input.merge_method,
        merged: false,
        message: "Dry run validated the approved pull request merge.",
        sync: { attempted: false, ok: true, base: pull.base.ref },
        warnings: unique([...collected.warnings, ...(pull.mergeable === null ? ["MERGEABILITY_PENDING"] : [])])
      };
    }
    const merged = await this.github.mergePull(repository.owner, repository.name, pull.number, {
      sha: input.expected_pull_head_sha,
      merge_method: input.merge_method
    });
    if (!merged.merged) {
      throw new RepoReaderError("GITHUB_MERGE_REJECTED", merged.message || "GitHub rejected the pull request merge.");
    }
    const warnings = [...collected.warnings];
    let sync: {
      attempted: boolean;
      ok: boolean;
      base: string;
      local_base_sha_after?: string;
      error_code?: string;
      message?: string;
    } = { attempted: false, ok: true, base: pull.base.ref };
    if (input.sync_local_base) {
      try {
        this.policy.assertSyncAllowed();
        const synced = await this.performSync(input.remote, pull.base.ref, state, false);
        sync = {
          attempted: true,
          ok: true,
          base: pull.base.ref,
          ...(synced.local_base_sha_after ? { local_base_sha_after: synced.local_base_sha_after } : {})
        };
      } catch (error) {
        const repoError = toRepoReaderError(error);
        warnings.push("LOCAL_BASE_SYNC_FAILED");
        sync = {
          attempted: true,
          ok: false,
          base: pull.base.ref,
          error_code: repoError.code,
          message: repoError.message
        };
      }
    }
    return {
      ok: true as const,
      dry_run: false,
      pull_request: { ...mapPull(pull), state: "closed" as const, merged: true },
      checks: collected.summary,
      merge_method: input.merge_method,
      merged: true,
      ...(merged.sha ? { merge_sha: merged.sha } : {}),
      message: merged.message,
      sync,
      warnings: unique(warnings)
    };
  }

  private async performSync(remote: string, base: string, state: { branch: string; head: string; clean: boolean }, dryRun: boolean) {
    const remoteBaseSha = await this.readRemoteHead(remote, base);
    if (!remoteBaseSha) {
      throw new RepoReaderError("GIT_REMOTE_BRANCH_NOT_FOUND", `Remote base branch ${remote}/${base} was not found.`);
    }
    const localBefore = await this.tryGit(["rev-parse", `refs/heads/${base}`]);
    if (!dryRun) {
      if (state.branch === base) {
        await this.runGit(["pull", "--ff-only", remote, base]);
      } else {
        await this.runGit(["fetch", remote, `refs/heads/${base}:refs/heads/${base}`]);
      }
    }
    const localAfter = dryRun ? undefined : await this.runGit(["rev-parse", `refs/heads/${base}`]);
    return {
      ok: true as const,
      dry_run: dryRun,
      remote,
      current_branch: state.branch,
      base,
      head_sha: state.head,
      remote_base_sha: remoteBaseSha,
      ...(localBefore ? { local_base_sha_before: localBefore } : {}),
      ...(localAfter ? { local_base_sha_after: localAfter } : {}),
      updated: !dryRun && localAfter !== localBefore,
      warnings: [] as string[]
    };
  }

  private async collectChecks(repository: GitHubRepository, sha: string): Promise<{ summary: CheckSummary; warnings: string[] }> {
    const warnings: string[] = [];
    let checkRuns: GitHubCheckRun[] = [];
    let combined: GitHubCombinedStatus | undefined;
    try {
      checkRuns = await this.github.listCheckRuns(repository.owner, repository.name, sha);
    } catch (error) {
      warnings.push(`CHECK_RUNS_${toRepoReaderError(error).code}`);
    }
    try {
      combined = await this.github.getCombinedStatus(repository.owner, repository.name, sha);
    } catch (error) {
      warnings.push(`COMMIT_STATUS_${toRepoReaderError(error).code}`);
    }
    const items: CheckSummary["items"] = [];
    for (const run of checkRuns) {
      const state = normalizeCheckRun(run);
      items.push({ name: run.name, state, ...(run.details_url ? { details_url: run.details_url } : {}) });
    }
    for (const status of combined?.statuses ?? []) {
      const state = status.state === "success" ? "success" : status.state === "pending" ? "pending" : "failure";
      items.push({ name: status.context, state, ...(status.target_url ? { details_url: status.target_url } : {}) });
    }
    const successful = items.filter((item) => item.state === "success").length;
    const pending = items.filter((item) => item.state === "pending").length;
    const failed = items.filter((item) => item.state === "failure").length;
    const observedOverall = failed > 0 || combined?.state === "failure" || combined?.state === "error"
      ? "failure"
      : pending > 0 || combined?.state === "pending"
        ? "pending"
        : items.length > 0
          ? "success"
          : "unknown";
    const overall = warnings.length > 0 && observedOverall !== "failure" ? "unknown" : observedOverall;
    return {
      summary: { overall, total: items.length, successful, pending, failed, items },
      warnings: unique(warnings)
    };
  }

  private assertOrigin(remote: string): void {
    if (remote !== "origin") {
      throw new RepoReaderError("GIT_REMOTE_NOT_ALLOWED", "Remote workflow is restricted to the configured origin remote.");
    }
  }

  private async localState(expectedHead?: string, expectedBranch?: string) {
    const head = await this.runGit(["rev-parse", "HEAD"]);
    if (expectedHead && head !== expectedHead) {
      throw new RepoReaderError("GIT_HEAD_MISMATCH", "Repository HEAD changed after review.", {
        diagnostics: { expected_head_sha: expectedHead, actual_head_sha: head }
      });
    }
    const branch = await this.tryGit(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (!branch) throw new RepoReaderError("GIT_DETACHED_HEAD", "Remote workflow requires a named local branch, not detached HEAD.");
    if (expectedBranch && branch !== expectedBranch) {
      throw new RepoReaderError("GIT_BRANCH_MISMATCH", `Current branch ${branch} does not match expected branch ${expectedBranch}.`);
    }
    const clean = (await this.runGit(["status", "--porcelain=v1", "--untracked-files=all"])).length === 0;
    return { head, branch, clean };
  }

  private assertClean(clean: boolean): void {
    if (!clean) throw new RepoReaderError("GIT_WORKTREE_DIRTY", "Remote mutation requires a clean worktree and index.");
  }

  private async validateBranch(branch: string): Promise<void> {
    try {
      await this.runGit(["check-ref-format", "--branch", branch]);
    } catch {
      throw new RepoReaderError("GIT_BRANCH_INVALID", "Branch name is not a valid Git branch ref.");
    }
  }

  private async repositoryFor(remote: string): Promise<GitHubRepository> {
    const url = await this.runGit(["remote", "get-url", remote]);
    return parseGitHubRemote(url);
  }

  private async readRemoteHead(remote: string, branch: string): Promise<string | undefined> {
    const output = await this.runGit(["ls-remote", "--heads", remote, `refs/heads/${branch}`]);
    const sha = output.split(/\s+/)[0];
    return /^[a-f0-9]{40}$/i.test(sha ?? "") ? sha : undefined;
  }

  private async runGit(args: string[]): Promise<string> {
    return (await this.gitRunner(args)).trim();
  }

  private async tryGit(args: string[]): Promise<string | undefined> {
    try {
      const value = await this.runGit(args);
      return value || undefined;
    } catch {
      return undefined;
    }
  }
}

function parseBranchLines(output: string, currentBranch: string, remote: boolean) {
  if (!output.trim()) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.trim().split(/\s+/);
    const name = remote ? (parts[1] ?? "").replace(/^refs\/heads\//, "") : parts[0] ?? "";
    const sha = remote ? parts[0] ?? "" : parts[1] ?? "";
    if (!name || !/^[a-f0-9]{40}$/i.test(sha)) {
      throw new RepoReaderError("GIT_ERROR", "Git returned malformed branch information.");
    }
    return { name, sha, current: name === currentBranch };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function parseGitHubRemote(raw: string): GitHubRepository {
  const value = raw.trim();
  let owner: string | undefined;
  let name: string | undefined;
  const scp = value.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (scp) {
    owner = scp[1];
    name = scp[2];
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new RepoReaderError("GIT_REMOTE_NOT_GITHUB", "Remote must be a supported GitHub HTTPS or SSH URL.");
    }
    const supportedProtocol = url.protocol === "https:" || url.protocol === "ssh:";
    const invalidUsername = url.protocol === "ssh:" ? Boolean(url.username && url.username !== "git") : Boolean(url.username);
    if (!supportedProtocol || url.hostname.toLowerCase() !== "github.com" || url.password || invalidUsername) {
      throw new RepoReaderError("GIT_REMOTE_NOT_GITHUB", "Remote must target github.com without embedded credentials.");
    }
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/i, "").split("/");
    if (parts.length !== 2) throw new RepoReaderError("GIT_REMOTE_NOT_GITHUB", "Remote must identify exactly one GitHub owner/repository pair.");
    [owner, name] = parts;
  }
  if (!owner || !name || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new RepoReaderError("GIT_REMOTE_NOT_GITHUB", "Remote contains an unsupported GitHub owner or repository name.");
  }
  return { owner, name, html_url: `https://github.com/${owner}/${name}` };
}

function mapPull(pull: GitHubPull): PullRequest {
  return {
    number: pull.number,
    title: pull.title,
    state: pull.state,
    draft: pull.draft,
    html_url: pull.html_url,
    head_ref: pull.head.ref,
    head_sha: pull.head.sha,
    base_ref: pull.base.ref,
    base_sha: pull.base.sha,
    mergeable: pull.mergeable,
    mergeable_state: pull.mergeable_state,
    merged: pull.merged
  };
}

function normalizeCheckRun(run: GitHubCheckRun): "success" | "pending" | "failure" {
  if (run.status !== "completed") return "pending";
  return run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped" ? "success" : "failure";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function gitTransportEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GPT_REPO_GITHUB_TOKEN;
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

function gitError(error: unknown): RepoReaderError {
  if (error instanceof RepoReaderError) return error;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : undefined;
  return new RepoReaderError("GIT_ERROR", "Git remote operation failed.", {
    retryable: code === "ETIMEDOUT" || code === "ECONNRESET"
  });
}
