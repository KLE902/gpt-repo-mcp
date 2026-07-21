import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/i).describe("Exact 40-character Git commit SHA used as a stale-state guard.");
const RemoteNameSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).describe("Configured Git remote name, normally origin.");
const BranchNameSchema = z.string().min(1).max(255).describe("Exact local or remote branch name; validated again by git check-ref-format.");
const PullNumberSchema = z.number().int().positive().describe("GitHub pull request number.");

export const PullRequestSchema = z.object({
  number: PullNumberSchema,
  title: z.string().describe("Current GitHub pull request title."),
  state: z.enum(["open", "closed"]).describe("Current GitHub pull request state."),
  draft: z.boolean().describe("Whether the pull request is a draft."),
  html_url: z.string().url().describe("Canonical GitHub web URL for the pull request."),
  head_ref: z.string().describe("Pull request head branch name."),
  head_sha: ShaSchema,
  base_ref: z.string().describe("Pull request base branch name."),
  base_sha: ShaSchema,
  mergeable: z.boolean().nullable().describe("GitHub mergeability result; null means GitHub has not finished computing it."),
  mergeable_state: z.string().describe("GitHub mergeability state string."),
  merged: z.boolean().describe("Whether the pull request has already been merged.")
});

export const CheckSummarySchema = z.object({
  overall: z.enum(["success", "pending", "failure", "unknown"]).describe("Combined check-run and commit-status result."),
  total: z.number().int().nonnegative().describe("Number of check runs and commit status contexts considered."),
  successful: z.number().int().nonnegative().describe("Number of successful, neutral, or skipped checks."),
  pending: z.number().int().nonnegative().describe("Number of queued or in-progress checks."),
  failed: z.number().int().nonnegative().describe("Number of failed, cancelled, timed-out, or error checks."),
  items: z.array(z.object({
    name: z.string().describe("Check run name or commit status context."),
    state: z.enum(["success", "pending", "failure"]).describe("Normalized result for this check item."),
    details_url: z.string().url().optional().describe("Optional GitHub or CI details URL."),
    summary: z.string().optional().describe("Bounded sanitized check-run output summary when GitHub exposes one.")
  })).describe("Normalized individual check and status results.")
});

export const CreateBranchInputSchema = RepoInputSchema.extend({
  branch: BranchNameSchema.describe("New local feature branch to create and switch to."),
  expected_source_branch: BranchNameSchema.describe("Exact current source branch expected before the new branch is created."),
  expected_head_sha: ShaSchema,
  dry_run: z.boolean().optional().default(false).describe("Validate branch creation without changing the current branch."),
  reason: z.string().max(500).optional().describe("Optional short audit reason; omit unless it adds useful context.")
});

export const CreateBranchResultSchema = z.object({
  ok: z.literal(true).describe("True when feature-branch creation validation or execution completed."),
  dry_run: z.boolean().describe("Whether no branch was created or switched."),
  source_branch: z.string().describe("Verified branch from which the new feature branch was created."),
  branch: z.string().describe("New feature branch that was validated or created."),
  head_sha: ShaSchema,
  created: z.boolean().describe("Whether the new local branch was created and checked out."),
  worktree_clean: z.boolean().describe("Whether the worktree and index were clean before branch creation."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes.")
});

export const RemoteStatusInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote name, normally origin."),
  pull_number: PullNumberSchema.optional().describe("Optional pull request to inspect; otherwise the open PR for the current branch is used when available.")
});

export const RemoteStatusResultSchema = z.object({
  ok: z.literal(true).describe("True when remote status inspection completed."),
  remote: z.string().describe("Git remote that was inspected."),
  repository: z.object({
    owner: z.string().describe("GitHub repository owner parsed from the configured remote."),
    name: z.string().describe("GitHub repository name parsed from the configured remote."),
    html_url: z.string().url().describe("Canonical GitHub repository URL without credentials.")
  }).describe("GitHub repository identity derived from the local remote."),
  branch: z.string().describe("Current local branch name."),
  head_sha: ShaSchema,
  clean: z.boolean().describe("Whether the local worktree and index are clean."),
  upstream: z.string().optional().describe("Configured upstream ref for the current branch."),
  ahead: z.number().int().nonnegative().optional().describe("Commits local HEAD is ahead of its upstream."),
  behind: z.number().int().nonnegative().optional().describe("Commits local HEAD is behind its upstream."),
  remote_head_sha: ShaSchema.optional().describe("Current SHA of the same branch on the configured remote, when it exists."),
  pushed: z.boolean().describe("Whether the remote branch currently matches local HEAD."),
  pull_request: PullRequestSchema.optional().describe("Matching or explicitly requested GitHub pull request, when available."),
  checks: CheckSummarySchema.optional().describe("Checks for the pull request head SHA, when available."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes.")
});

export const PushInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote name, normally origin."),
  expected_branch: BranchNameSchema,
  expected_head_sha: ShaSchema,
  set_upstream: z.boolean().optional().default(true).describe("Whether to configure the pushed branch to track the remote branch."),
  dry_run: z.boolean().optional().default(false).describe("Validate local state and the GitHub remote without pushing."),
  reason: z.string().max(500).optional().describe("Optional short audit reason; omit unless it adds useful context.")
});

export const PushResultSchema = z.object({
  ok: z.literal(true).describe("True when push validation or the actual push completed."),
  dry_run: z.boolean().describe("Whether no remote mutation was performed."),
  remote: z.string().describe("Git remote used for the push."),
  repository: z.object({
    owner: z.string().describe("GitHub repository owner."),
    name: z.string().describe("GitHub repository name."),
    html_url: z.string().url().describe("Canonical GitHub repository URL.")
  }).describe("GitHub repository identity derived from the remote."),
  branch: z.string().describe("Branch pushed or validated."),
  head_sha: ShaSchema,
  remote_head_sha: ShaSchema.optional().describe("Verified remote branch SHA after an actual push, or existing SHA in dry-run mode."),
  pushed: z.boolean().describe("Whether an actual push was performed and verified."),
  upstream: z.string().optional().describe("Expected upstream ref after the operation."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes.")
});

export const PullRequestInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote name, normally origin."),
  expected_branch: BranchNameSchema,
  expected_head_sha: ShaSchema,
  base: BranchNameSchema.describe("Explicit pull request base branch, normally main or master."),
  title: z.string().trim().min(1).max(256).describe("Pull request title."),
  body: z.string().max(65536).optional().describe("Optional pull request body. Omit to preserve an existing PR body."),
  draft: z.boolean().optional().default(false).describe("Whether a newly created pull request should be a draft."),
  dry_run: z.boolean().optional().default(false).describe("Inspect whether the PR would be created or updated without mutating GitHub."),
  reason: z.string().max(500).optional().describe("Optional short audit reason; omit unless it adds useful context.")
});

export const PullRequestResultSchema = z.object({
  ok: z.literal(true).describe("True when pull request planning or mutation completed."),
  dry_run: z.boolean().describe("Whether no pull request mutation was performed."),
  action: z.enum(["would_create", "would_update", "unchanged", "created", "updated"]).describe("What happened or would happen to the pull request."),
  remote: z.string().describe("Git remote whose GitHub repository was used."),
  branch: z.string().describe("Pull request head branch."),
  head_sha: ShaSchema,
  base: z.string().describe("Pull request base branch."),
  pull_request: PullRequestSchema.optional().describe("Current or created pull request. It is absent only for a dry-run create plan."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes.")
});

export const SyncBaseInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote name, normally origin."),
  base: BranchNameSchema.describe("Explicit local and remote base branch to synchronize, normally main or master."),
  expected_head_sha: ShaSchema,
  dry_run: z.boolean().optional().default(false).describe("Validate and inspect the remote base without changing local refs."),
  reason: z.string().max(500).optional().describe("Optional short audit reason; omit unless it adds useful context.")
});

export const SyncBaseResultSchema = z.object({
  ok: z.literal(true).describe("True when base synchronization validation or execution completed."),
  dry_run: z.boolean().describe("Whether no local ref was changed."),
  remote: z.string().describe("Git remote used for synchronization."),
  current_branch: z.string().describe("Branch currently checked out in the approved worktree."),
  base: z.string().describe("Local base branch updated or inspected."),
  head_sha: ShaSchema,
  remote_base_sha: ShaSchema,
  local_base_sha_before: ShaSchema.optional().describe("Local base branch SHA before synchronization, when the branch existed."),
  local_base_sha_after: ShaSchema.optional().describe("Local base branch SHA after actual synchronization."),
  updated: z.boolean().describe("Whether the local base ref changed."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes.")
});

export const MergePullRequestInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote name, normally origin."),
  pull_number: PullNumberSchema,
  expected_head_sha: ShaSchema.describe("Expected current local HEAD SHA."),
  expected_pull_head_sha: ShaSchema.describe("Exact pull request head SHA that the owner reviewed and approved."),
  owner_approved: z.literal(true).describe("Must be true only after the owner explicitly approves merging this pull request."),
  merge_method: z.enum(["merge", "squash", "rebase"]).optional().default("squash").describe("GitHub merge method."),
  require_checks_passed: z.boolean().optional().default(true).describe("Reject merge unless known check runs and commit statuses are successful."),
  sync_local_base: z.boolean().optional().default(true).describe("Fast-forward the local base branch after GitHub reports a successful merge."),
  dry_run: z.boolean().optional().default(false).describe("Validate approval, PR state, head SHA, mergeability, and checks without merging."),
  reason: z.string().max(500).optional().describe("Optional short audit reason; omit unless it adds useful context.")
});

export const MergePullRequestResultSchema = z.object({
  ok: z.literal(true).describe("True when merge validation or the merge request completed."),
  dry_run: z.boolean().describe("Whether no GitHub merge was performed."),
  pull_request: PullRequestSchema.describe("Pull request that was validated or merged."),
  checks: CheckSummarySchema.describe("Normalized check state used for the merge decision."),
  merge_method: z.enum(["merge", "squash", "rebase"]).describe("GitHub merge method used or validated."),
  merged: z.boolean().describe("Whether GitHub merged the pull request."),
  merge_sha: ShaSchema.optional().describe("Merge or resulting base SHA returned by GitHub."),
  message: z.string().describe("Sanitized GitHub merge result or dry-run summary."),
  sync: z.object({
    attempted: z.boolean().describe("Whether local base synchronization was attempted."),
    ok: z.boolean().describe("Whether the local synchronization completed successfully."),
    base: z.string().describe("Pull request base branch targeted by synchronization."),
    local_base_sha_after: ShaSchema.optional().describe("Local base SHA after successful synchronization."),
    error_code: z.string().optional().describe("Stable error code when post-merge synchronization failed."),
    message: z.string().optional().describe("Sanitized post-merge synchronization failure message.")
  }).describe("Best-effort local base synchronization result; merge success is preserved even if sync fails."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes.")
});

export type CreateBranchInput = z.infer<typeof CreateBranchInputSchema>;
export type RemoteStatusInput = z.infer<typeof RemoteStatusInputSchema>;
export type PushInput = z.infer<typeof PushInputSchema>;
export type PullRequestInput = z.infer<typeof PullRequestInputSchema>;
export type SyncBaseInput = z.infer<typeof SyncBaseInputSchema>;
export type MergePullRequestInput = z.infer<typeof MergePullRequestInputSchema>;
export type PullRequest = z.infer<typeof PullRequestSchema>;
export type CheckSummary = z.infer<typeof CheckSummarySchema>;
