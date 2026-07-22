import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";
import { PullRequestSchema } from "./remote-git.contract.js";

const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/i).describe("Exact 40-character Git commit SHA used as a stale-state guard.");
const PullNumberSchema = z.number().int().positive().describe("GitHub pull request number.");
const RemoteNameSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).describe("Configured Git remote name, restricted to origin.");
const BranchNameSchema = z.string().min(1).max(255).describe("Exact branch name, validated again by git check-ref-format.");

export const PullRequestListInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote name, restricted to origin."),
  state: z.enum(["open", "closed", "all"]).optional().default("open").describe("GitHub pull request state filter."),
  head: BranchNameSchema.optional().describe("Optional exact head branch filter."),
  base: BranchNameSchema.optional().describe("Optional exact base branch filter."),
  limit: z.number().int().min(1).max(100).optional().default(30).describe("Maximum number of pull requests to return."),
  include_checks: z.boolean().optional().default(false).describe("Whether to collect normalized checks for each returned pull request head.")
});

export const PullRequestListItemSchema = PullRequestSchema.extend({
  body: z.string().nullable().optional().describe("Current pull request body when returned by GitHub CLI."),
  checks: z.object({
    overall: z.enum(["success", "pending", "failure", "unknown"]).describe("Combined check state for the pull request head."),
    total: z.number().int().nonnegative().describe("Number of check runs and commit status contexts considered."),
    successful: z.number().int().nonnegative().describe("Number of successful, neutral, or skipped checks."),
    pending: z.number().int().nonnegative().describe("Number of queued or in-progress checks."),
    failed: z.number().int().nonnegative().describe("Number of failed, cancelled, timed-out, or error checks."),
    items: z.array(z.object({
      name: z.string().describe("Check run name or commit status context."),
      state: z.enum(["success", "pending", "failure"]).describe("Normalized state for the check item."),
      details_url: z.string().url().optional().describe("Optional GitHub or CI details URL."),
      summary: z.string().optional().describe("Bounded sanitized check-run output summary.")
    })).describe("Normalized check and status items.")
  }).optional().describe("Normalized check state when include_checks is true.")
});

export const PullRequestListResultSchema = z.object({
  ok: z.literal(true).describe("True when the bounded pull-request listing completed."),
  remote: z.string().describe("Git remote whose GitHub repository was inspected."),
  repository: z.object({
    owner: z.string().describe("GitHub repository owner."),
    name: z.string().describe("GitHub repository name."),
    html_url: z.string().url().describe("Canonical GitHub repository URL.")
  }).describe("GitHub repository identity derived from origin."),
  state: z.enum(["open", "closed", "all"]).describe("Applied pull-request state filter."),
  head: z.string().optional().describe("Applied exact head branch filter."),
  base: z.string().optional().describe("Applied exact base branch filter."),
  pull_requests: z.array(PullRequestListItemSchema).describe("Bounded structured pull-request results."),
  truncated: z.boolean().describe("Whether more matching pull requests existed than the requested limit."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes.")
});

export const RetirePullRequestInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote name, restricted to origin."),
  pull_number: PullNumberSchema,
  expected_head_sha: ShaSchema.describe("Exact current local HEAD required before retirement."),
  expected_pull_head_sha: ShaSchema.describe("Exact pull request head SHA approved for retirement."),
  owner_approved: z.literal(true).describe("Confirms explicit owner approval to close this exact pull request without merge."),
  comment: z.string().trim().min(1).max(1000).optional().describe("Optional bounded comment added while closing the pull request."),
  delete_local_branch: z.boolean().optional().default(true).describe("Whether the exact verified local pull-request branch should be deleted."),
  delete_remote_branch: z.boolean().optional().default(true).describe("Whether the exact verified origin pull-request branch should be deleted."),
  dry_run: z.boolean().optional().default(false).describe("Validate GitHub and branch cleanup guards without mutation."),
  reason: z.string().max(500).optional().describe("Optional concise audit reason for the retirement request.")
});

export const RetirePullRequestResultSchema = z.object({
  ok: z.literal(true).describe("True when pull-request retirement validation or execution completed."),
  dry_run: z.boolean().describe("Whether no GitHub or Git mutation was performed."),
  pull_request: PullRequestSchema.describe("Exact pull request validated or retired."),
  closed: z.boolean().describe("Whether GitHub confirmed the pull request closed without merge."),
  comment_added: z.boolean().describe("Whether a retirement comment was requested during actual closure."),
  local_branch_deleted: z.boolean().describe("Whether the exact verified local head branch was deleted."),
  remote_branch_deleted: z.boolean().describe("Whether the exact verified origin head branch was deleted."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes, including best-effort cleanup failures.")
});

export type PullRequestListInput = z.infer<typeof PullRequestListInputSchema>;
export type RetirePullRequestInput = z.infer<typeof RetirePullRequestInputSchema>;
