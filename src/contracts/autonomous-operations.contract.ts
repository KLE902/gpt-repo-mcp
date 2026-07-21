import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";
import { PullRequestSchema } from "./remote-git.contract.js";

const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/i).describe("Exact 40-character Git commit SHA used as a stale-state guard.");
const BranchNameSchema = z.string().min(1).max(255).describe("Exact Git branch name, validated again with git check-ref-format.");
const RemoteNameSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).describe("Configured Git remote name, normally origin.");
const PullNumberSchema = z.number().int().positive().describe("Positive GitHub pull request number.");
const ScriptIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).describe("Configured allowlisted script identifier; callers cannot supply command text or arguments.");

const BranchEntrySchema = z.object({
  name: z.string().describe("Branch name without a refs/heads or refs/remotes prefix."),
  sha: ShaSchema.describe("Commit SHA currently referenced by this branch."),
  current: z.boolean().describe("Whether this local branch is currently checked out.")
});

export const BranchListInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote to inspect; only origin is supported.")
});
export const BranchListResultSchema = z.object({
  ok: z.literal(true).describe("Whether branch inspection completed successfully."),
  remote: z.string().describe("Remote name inspected by the operation."),
  current_branch: z.string().describe("Currently checked-out local branch."),
  head_sha: ShaSchema.describe("Current local HEAD SHA."),
  clean: z.boolean().describe("Whether the current worktree and index are clean."),
  local_branches: z.array(BranchEntrySchema).describe("Deterministically sorted local branch names and SHAs."),
  remote_branches: z.array(BranchEntrySchema).describe("Deterministically sorted remote branch names and SHAs."),
  warnings: z.array(z.string()).describe("Stable warning codes from branch inspection.")
});

export const SwitchBranchInputSchema = RepoInputSchema.extend({
  branch: BranchNameSchema.describe("Existing local branch to switch to."),
  expected_current_branch: BranchNameSchema.describe("Exact currently checked-out branch expected before switching."),
  expected_head_sha: ShaSchema.describe("Exact current HEAD expected before switching."),
  dry_run: z.boolean().optional().default(false).describe("Validate the guarded branch switch without changing the worktree."),
  reason: z.string().max(500).optional().describe("Optional concise audit reason for the branch switch.")
});
export const SwitchBranchResultSchema = z.object({
  ok: z.literal(true).describe("Whether branch-switch validation or execution succeeded."),
  dry_run: z.boolean().describe("Whether the operation was validation-only."),
  previous_branch: z.string().describe("Branch checked out before the operation."),
  branch: z.string().describe("Target branch validated or checked out."),
  head_sha: ShaSchema.describe("Target branch HEAD SHA."),
  switched: z.boolean().describe("Whether Git actually changed the checked-out branch."),
  warnings: z.array(z.string()).describe("Stable warning codes from branch switching.")
});

export const FinalizePullRequestInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured GitHub remote, restricted to origin."),
  pull_number: PullNumberSchema.describe("Confirmed merged pull request to finalize locally and remotely."),
  expected_head_sha: ShaSchema.describe("Exact current local HEAD required before post-merge finalization."),
  expected_pull_head_sha: ShaSchema.describe("Exact merged pull-request head SHA approved for branch deletion."),
  owner_approved: z.literal(true).describe("Confirms owner approval for cleanup of this exact merged pull-request head."),
  delete_remote_branch: z.boolean().optional().default(true).describe("Whether the verified origin feature branch should also be deleted."),
  dry_run: z.boolean().optional().default(false).describe("Validate merge, refs, synchronization, switch, and deletion guards without mutation."),
  reason: z.string().max(500).optional().describe("Optional concise audit reason for post-merge finalization.")
});
export const FinalizePullRequestResultSchema = z.object({
  ok: z.literal(true).describe("Whether post-merge finalization validation or execution succeeded."),
  dry_run: z.boolean().describe("Whether the operation was validation-only."),
  pull_request: PullRequestSchema.describe("Confirmed merged pull request used as cleanup authority."),
  base: z.string().describe("Base branch synchronized and checked out by finalization."),
  base_sha: ShaSchema.describe("Remote base SHA verified after merge."),
  switched_to_base: z.boolean().describe("Whether Git changed from the feature branch to the base branch."),
  local_branch_deleted: z.boolean().describe("Whether the verified local feature branch was deleted."),
  remote_branch_deleted: z.boolean().describe("Whether the verified origin feature branch was deleted."),
  warnings: z.array(z.string()).describe("Stable warning codes from post-merge finalization.")
});

export const AllowedScriptInputSchema = RepoInputSchema.extend({
  script_id: ScriptIdSchema.describe("Configured script id to run with server-owned command and arguments."),
  expected_head_sha: ShaSchema.describe("Exact repository HEAD required before script execution."),
  dry_run: z.boolean().optional().default(false).describe("Validate script policy, id, and HEAD without starting a process."),
  reason: z.string().max(500).optional().describe("Optional concise audit reason for running the configured script.")
});
export const AllowedScriptResultSchema = z.object({
  ok: z.literal(true).describe("Whether the script request was handled successfully."),
  dry_run: z.boolean().describe("Whether the operation was validation-only."),
  script_id: ScriptIdSchema.describe("Configured script id validated or executed."),
  executed: z.boolean().describe("Whether a local child process was started."),
  succeeded: z.boolean().describe("Whether execution completed with exit code zero and complete output."),
  exit_code: z.number().int().nullable().describe("Operating-system process exit code, or null when unavailable."),
  timed_out: z.boolean().describe("Whether the configured timeout terminated the process."),
  complete: z.boolean().describe("Whether output collection completed without timeout or truncation."),
  output_truncated: z.boolean().describe("Whether the configured output limit truncated process output."),
  duration_ms: z.number().int().nonnegative().describe("Measured process duration in milliseconds."),
  stdout: z.string().describe("Sanitized bounded standard output from the configured process."),
  stderr: z.string().describe("Sanitized bounded standard error from the configured process."),
  warnings: z.array(z.string()).describe("Stable warning codes from script execution.")
});

export const WorkflowDispatchInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured GitHub remote, restricted to origin."),
  workflow_id: z.string().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).describe("Locally allowlisted workflow file name or numeric workflow id."),
  ref: BranchNameSchema.describe("Remote branch supplied to the GitHub Actions workflow_dispatch event."),
  expected_ref_sha: ShaSchema.describe("Exact remote branch SHA required before workflow dispatch."),
  inputs: z.record(z.string().min(1).max(100), z.string().max(1024)).optional().default({}).describe("Bounded string inputs supplied to the named workflow."),
  dry_run: z.boolean().optional().default(false).describe("Validate remote, workflow id, ref, and inputs without dispatching GitHub Actions."),
  reason: z.string().max(500).optional().describe("Optional concise audit reason for workflow dispatch.")
});
export const WorkflowDispatchResultSchema = z.object({
  ok: z.literal(true).describe("Whether workflow-dispatch validation or execution succeeded."),
  dry_run: z.boolean().describe("Whether the operation was validation-only."),
  workflow_id: z.string().describe("Workflow identifier validated or dispatched."),
  ref: z.string().describe("Git ref used for workflow dispatch."),
  dispatched: z.boolean().describe("Whether GitHub accepted a workflow-dispatch request."),
  input_names: z.array(z.string()).describe("Sorted workflow input names without their values."),
  warnings: z.array(z.string()).describe("Stable warning codes from workflow dispatch.")
});

export type BranchListInput = z.infer<typeof BranchListInputSchema>;
export type SwitchBranchInput = z.infer<typeof SwitchBranchInputSchema>;
export type FinalizePullRequestInput = z.infer<typeof FinalizePullRequestInputSchema>;
export type AllowedScriptInput = z.infer<typeof AllowedScriptInputSchema>;
export type WorkflowDispatchInput = z.infer<typeof WorkflowDispatchInputSchema>;
