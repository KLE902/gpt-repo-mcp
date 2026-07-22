import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";
import { PullRequestSchema } from "./remote-git.contract.js";

const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/i).describe("Exact 40-character Git commit SHA used as a stale-state guard.");
const BranchNameSchema = z.string().min(1).max(255).describe("Exact Git branch name, validated again with git check-ref-format.");
const RemoteNameSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).describe("Configured Git remote name, restricted to origin.");

export const BranchAuditInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote whose branch refs and GitHub pull requests should be inspected."),
  branch: BranchNameSchema.describe("Exact local or origin branch to audit for safe retirement."),
  base: BranchNameSchema.optional().default("main").describe("Explicit remote base branch used for ancestry and ahead/behind analysis.")
});

export const BranchAuditResultSchema = z.object({
  ok: z.literal(true).describe("Whether branch audit completed successfully."),
  remote: z.string().describe("Configured remote inspected by the audit."),
  branch: z.string().describe("Exact branch audited by the operation."),
  base: z.string().describe("Base branch used for ancestry analysis."),
  current_branch: z.string().describe("Currently checked-out local branch."),
  head_sha: ShaSchema.describe("Current repository HEAD SHA at audit time."),
  clean: z.boolean().describe("Whether the current worktree and index were clean at audit time."),
  local_branch_sha: ShaSchema.optional().describe("Local branch SHA when the branch exists locally."),
  remote_branch_sha: ShaSchema.optional().describe("Origin branch SHA when the branch exists remotely."),
  branch_sha: ShaSchema.describe("Single branch SHA used for ancestry analysis after local and remote refs agree."),
  base_sha: ShaSchema.describe("Exact current remote base-branch SHA used for ancestry analysis."),
  merge_base_sha: ShaSchema.optional().describe("Best common ancestor of the audited branch and remote base when one exists."),
  ahead: z.number().int().nonnegative().describe("Commits reachable only from the audited branch relative to the remote base."),
  behind: z.number().int().nonnegative().describe("Commits reachable only from the remote base relative to the audited branch."),
  merged_into_base: z.boolean().describe("Whether the audited branch commit is an ancestor of the current remote base."),
  open_pull_requests: z.array(PullRequestSchema).describe("Open GitHub pull requests whose head is the audited branch."),
  safe_to_retire: z.boolean().describe("Whether all bounded safety checks currently allow exact branch retirement."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes explaining absent refs or failed safety conditions.")
});

export const RetireBranchInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote, restricted to origin."),
  branch: BranchNameSchema.describe("Exact non-base branch approved for guarded retirement."),
  expected_head_sha: ShaSchema.describe("Exact current repository HEAD required before branch retirement."),
  expected_branch_sha: ShaSchema.describe("Exact branch SHA reviewed and approved for retirement."),
  base: BranchNameSchema.optional().default("main").describe("Explicit remote base branch that must already contain the retired branch."),
  expected_base_sha: ShaSchema.describe("Exact current remote base SHA required before branch retirement."),
  owner_approved: z.literal(true).describe("Confirms owner approval to retire this exact branch name and branch SHA."),
  delete_local_branch: z.boolean().optional().default(true).describe("Whether the exact verified local branch should be deleted when present."),
  delete_remote_branch: z.boolean().optional().default(true).describe("Whether the exact verified origin branch should be deleted when present."),
  dry_run: z.boolean().optional().default(false).describe("Validate all ancestry, pull-request, ref, and policy guards without deleting refs."),
  reason: z.string().max(500).optional().describe("Optional concise audit reason for the branch-retirement request.")
});

export const RetireBranchResultSchema = z.object({
  ok: z.literal(true).describe("Whether branch-retirement validation or execution completed successfully."),
  dry_run: z.boolean().describe("Whether no local or remote branch deletion was performed."),
  remote: z.string().describe("Configured remote used by the operation."),
  branch: z.string().describe("Exact branch validated or retired."),
  branch_sha: ShaSchema.describe("Exact branch SHA authorized for retirement."),
  base: z.string().describe("Base branch that contained the retired branch."),
  base_sha: ShaSchema.describe("Exact remote base SHA verified before retirement."),
  ahead: z.number().int().nonnegative().describe("Branch-only commit count verified before retirement."),
  behind: z.number().int().nonnegative().describe("Base-only commit count verified before retirement."),
  local_branch_deleted: z.boolean().describe("Whether the exact local branch ref was deleted."),
  remote_branch_deleted: z.boolean().describe("Whether the exact origin branch ref was deleted."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes from branch retirement.")
});

export type BranchAuditInput = z.infer<typeof BranchAuditInputSchema>;
export type RetireBranchInput = z.infer<typeof RetireBranchInputSchema>;
