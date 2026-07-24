import { z } from "zod";
import { DEFAULT_OPERATIONS_POLICY } from "../policies/operations-defaults.js";
import { DEFAULT_WRITE_POLICY } from "../policies/write-defaults.js";

const PositiveIntSchema = z.number().int().positive();

export const AllowedScriptConfigSchema = z.object({
  command: z.string().min(1).max(1024),
  args: z.array(z.string().max(4096)).max(64).default([]),
  timeout_ms: z.number().int().min(1000).max(7_200_000).default(900_000),
  max_output_bytes: z.number().int().min(1024).max(1_048_576).default(131_072),
  inherit_env: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(64).default([])
}).strict();

export const WritePolicyConfigSchema = z.object({
  enabled: z.boolean().default(DEFAULT_WRITE_POLICY.enabled),
  allowed_globs: z.array(z.string()).default(DEFAULT_WRITE_POLICY.allowed_globs),
  denied_globs: z.array(z.string()).default(DEFAULT_WRITE_POLICY.denied_globs),
  max_bytes_per_write: PositiveIntSchema.default(DEFAULT_WRITE_POLICY.max_bytes_per_write)
}).passthrough();

export const OperationsPolicyConfigSchema = z.object({
  enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.enabled),
  git_stage_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.git_stage_enabled),
  git_commit_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.git_commit_enabled),
  git_branch_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.git_branch_enabled),
  git_branch_manage_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.git_branch_manage_enabled),
  git_push_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.git_push_enabled),
  github_pull_request_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.github_pull_request_enabled),
  github_workflow_dispatch_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.github_workflow_dispatch_enabled),
  allowed_workflows: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)).max(64).default(DEFAULT_OPERATIONS_POLICY.allowed_workflows),
  github_merge_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.github_merge_enabled),
  git_sync_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.git_sync_enabled),
  script_run_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.script_run_enabled),
  allowed_scripts: z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/), AllowedScriptConfigSchema).default(DEFAULT_OPERATIONS_POLICY.allowed_scripts),
  codex_task_run_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.codex_task_run_enabled),
  codex_task_max_runtime_ms: z.number().int().min(1000).max(7_200_000).default(DEFAULT_OPERATIONS_POLICY.codex_task_max_runtime_ms),
  codex_task_max_output_bytes: z.number().int().min(1024).max(1_048_576).default(DEFAULT_OPERATIONS_POLICY.codex_task_max_output_bytes),
  codex_task_inherit_env: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(64).default(DEFAULT_OPERATIONS_POLICY.codex_task_inherit_env),
  claude_ato_001_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.claude_ato_001_enabled),
  max_paths_per_operation: PositiveIntSchema.default(DEFAULT_OPERATIONS_POLICY.max_paths_per_operation),
  cleanup_enabled: z.boolean().default(DEFAULT_OPERATIONS_POLICY.cleanup_enabled),
  cleanup_allowed_globs: z.array(z.string()).default(DEFAULT_OPERATIONS_POLICY.cleanup_allowed_globs)
}).passthrough();

export const RepoConfigSchema = z.object({
  repo_id: z.string().min(1),
  display_name: z.string().min(1),
  root: z.string().min(1),
  allow_non_git: z.boolean().optional(),
  writes: WritePolicyConfigSchema.default(DEFAULT_WRITE_POLICY),
  operations: OperationsPolicyConfigSchema.default(DEFAULT_OPERATIONS_POLICY)
}).passthrough();

export const LimitsConfigSchema = z.object({
  max_files: PositiveIntSchema.optional(),
  max_bytes_per_file: PositiveIntSchema.optional(),
  max_total_bytes: PositiveIntSchema.optional(),
  max_search_results: PositiveIntSchema.optional(),
  max_tree_entries: PositiveIntSchema.optional(),
  max_task_inventory_files: PositiveIntSchema.optional(),
  max_task_inventory_tree_pages: PositiveIntSchema.optional(),
  max_task_inventory_file_bytes: PositiveIntSchema.optional(),
  max_project_brief_doc_bytes: PositiveIntSchema.optional(),
  max_depth: PositiveIntSchema.optional(),
  max_diff_bytes: PositiveIntSchema.optional()
}).passthrough();

export const RepoReaderConfigSchema = z.object({
  repos: z.array(RepoConfigSchema).default([]),
  limits: LimitsConfigSchema.default({})
}).passthrough();

export type WritePolicyConfigDocument = z.input<typeof WritePolicyConfigSchema>;
export type OperationsPolicyConfigDocument = z.input<typeof OperationsPolicyConfigSchema>;
export type RepoConfig = {
  repo_id: string;
  display_name: string;
  root: string;
  allow_non_git?: boolean;
  writes?: WritePolicyConfigDocument;
  operations?: OperationsPolicyConfigDocument;
};
export type RepoReaderConfig = {
  repos: RepoConfig[];
  limits: z.input<typeof LimitsConfigSchema>;
};
