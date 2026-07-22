import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/i).describe("Exact 40-character Git commit SHA used as a stale-state guard.");
const BranchNameSchema = z.string().min(1).max(255).describe("Exact Git branch name; validated again by git check-ref-format.");
const RemoteNameSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).describe("Configured Git remote name, restricted to origin.");

export const BranchUpdateInputSchema = RepoInputSchema.extend({
  remote: RemoteNameSchema.optional().default("origin").describe("Configured Git remote, restricted to origin."),
  feature_branch: BranchNameSchema.describe("Exact currently checked-out feature branch to update."),
  expected_head_sha: ShaSchema.describe("Exact current feature-branch HEAD required before the update."),
  base: BranchNameSchema.describe("Explicit remote base branch whose current tip should be incorporated."),
  expected_base_sha: ShaSchema.describe("Exact current remote base-branch SHA required before preflight or update."),
  dry_run: z.boolean().optional().default(false).describe("Fetch and preflight without changing the feature branch, index, or worktree."),
  reason: z.string().max(500).optional().describe("Optional concise audit reason for the branch update.")
});

export const BranchUpdateResultSchema = z.object({
  ok: z.literal(true).describe("True when branch-update validation or execution completed."),
  dry_run: z.boolean().describe("Whether the feature branch was left unchanged."),
  remote: z.string().describe("Git remote used to resolve the base branch."),
  feature_branch: z.string().describe("Verified currently checked-out feature branch."),
  base: z.string().describe("Verified remote base branch."),
  head_sha_before: ShaSchema.describe("Feature-branch HEAD before the operation."),
  head_sha_after: ShaSchema.describe("Feature-branch HEAD after the operation or unchanged preflight."),
  base_sha: ShaSchema.describe("Verified remote base-branch SHA incorporated or inspected."),
  action: z.enum(["up_to_date", "fast_forward", "merge", "conflicts"]).describe("Resolved update path."),
  can_update: z.boolean().describe("Whether the branch is already current or can be updated without conflicts."),
  updated: z.boolean().describe("Whether the feature-branch HEAD changed."),
  conflict_files: z.array(z.string()).describe("Bounded conflicted paths reported by merge-tree preflight."),
  conflicts_truncated: z.boolean().describe("Whether additional conflicted paths were omitted."),
  warnings: z.array(z.string()).describe("Stable non-fatal warning codes.")
});

export type BranchUpdateInput = z.infer<typeof BranchUpdateInputSchema>;
export type BranchUpdateResult = z.infer<typeof BranchUpdateResultSchema>;
