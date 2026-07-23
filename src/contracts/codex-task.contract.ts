import { z } from "zod";
import { GitReviewResultSchema } from "./git-review.contract.js";
import { RepoInputSchema } from "./repo.contract.js";

const NonEmptyStringSchema = z.string().min(1);
const RepoPathListSchema = z.array(z.string().min(1)).default([]);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const CodexRunIdSchema = z.string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[a-z0-9][a-z0-9-]{0,79}$/)
  .describe("Stable repo-local Codex run id. Generated when omitted.");

export const CodexTaskManifestSchema = z.object({
  schema_version: z.literal(2),
  repo_id: z.string().min(1),
  run_id: CodexRunIdSchema,
  title: z.string().min(1),
  objective: z.string().min(1),
  prompt_path: z.string().min(1),
  result_path: z.string().min(1),
  prompt_sha256: Sha256Schema,
  inspect_first: z.array(z.string()),
  allowed_paths: z.array(z.string()),
  forbidden_paths: z.array(z.string()),
  verification_commands: z.array(z.string()),
  created_at: z.string().nullable()
}).strict();

export const CodexExecutionStatusSchema = z.enum([
  "starting",
  "running",
  "completed",
  "blocked",
  "failed",
  "timed_out"
]);

export const CodexExecutionStateSchema = z.object({
  schema_version: z.literal(1),
  status: CodexExecutionStatusSchema,
  repo_id: z.string().min(1),
  run_id: CodexRunIdSchema,
  prompt_path: z.string().min(1),
  result_path: z.string().min(1),
  execution_path: z.string().min(1),
  stdout_path: z.string().min(1),
  stderr_path: z.string().min(1),
  start_branch: z.string().min(1),
  start_head_sha: GitShaSchema,
  runner_pid: z.number().int().positive().nullable(),
  process_pid: z.number().int().positive().nullable(),
  started_at: z.string().nullable(),
  updated_at: z.string(),
  ended_at: z.string().nullable(),
  timeout_ms: z.number().int().positive(),
  max_output_bytes: z.number().int().positive(),
  exit_code: z.number().int().nullable(),
  timed_out: z.boolean(),
  output_complete: z.boolean(),
  output_truncated: z.boolean(),
  error_code: z.string().nullable(),
  diagnostic: z.string().nullable(),
  end_branch: z.string().nullable(),
  end_head_sha: GitShaSchema.nullable(),
  worktree_clean_before: z.boolean(),
  worktree_clean_after: z.boolean().nullable(),
  changed_paths: z.array(z.string()),
  staged_paths: z.array(z.string()),
  branch_ref_changes: z.array(z.string()),
  run_artifact_violations: z.array(z.string()),
  scope_violations: z.array(z.string()),
  forbidden_path_changes: z.array(z.string()),
  result_sha256: Sha256Schema.nullable(),
  result_bytes: z.number().int().nonnegative().nullable(),
  result_status: z.enum(["completed", "blocked"]).nullable()
}).strict();

export const CodexExecutionReviewStateSchema = CodexExecutionStateSchema.extend({
  process_active: z.boolean()
});

export const CodexTaskInputSchema = RepoInputSchema.extend({
  title: NonEmptyStringSchema.describe("Short human-readable task title used in the prompt and generated run id."),
  objective: NonEmptyStringSchema.describe("Concrete implementation objective for Codex."),
  context_summary: z.string().min(1).optional().describe("Short context summary ChatGPT wants Codex to know before editing."),
  inspect_first: RepoPathListSchema.describe("Repo-relative files or globs Codex should inspect before editing."),
  allowed_paths: RepoPathListSchema.describe("Repo-relative files or globs Codex may edit."),
  forbidden_paths: RepoPathListSchema.describe("Repo-relative files or globs Codex must not edit."),
  implementation_scope: z.object({
    include: z.array(z.string().min(1)).default([]),
    exclude: z.array(z.string().min(1)).default([])
  }).optional().describe("Explicit implementation boundaries."),
  acceptance_criteria: z.array(z.string().min(1)).default([]).describe("Criteria Codex should satisfy before finishing."),
  verification_commands: z.array(z.string().min(1)).default([]).describe("Commands Codex should run when feasible and report in RESULT.md."),
  run_id: CodexRunIdSchema.optional()
});

export const CodexTaskWriteInputSchema = CodexTaskInputSchema.extend({
  dry_run: z.boolean().optional().describe("For repo_write_codex_task only: render and validate without writing files."),
  reason: z.string().min(1).optional().describe("Short audit reason for writing the task locally.")
});

export const CodexTaskResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  run_id: CodexRunIdSchema,
  prompt_path: z.string(),
  result_path: z.string(),
  manifest_path: z.string(),
  prompt_markdown: z.string(),
  codex_user_prompt: z.string(),
  next_steps: z.array(z.string()),
  warnings: z.array(z.string())
});

export const CodexTaskWriteResultSchema = CodexTaskResultSchema.extend({
  dry_run: z.boolean(),
  written_paths: z.array(z.string())
});

export const CodexStartInputSchema = RepoInputSchema.extend({
  run_id: CodexRunIdSchema.describe("Existing verified Codex task run id under .chatgpt/codex-runs."),
  expected_branch: z.string().min(1).max(255).describe("Exact non-base branch required before execution."),
  expected_head_sha: GitShaSchema.describe("Exact repository HEAD required before execution."),
  dry_run: z.boolean().optional().default(false).describe("Validate policy, task integrity, Git state, lock state, and Codex CLI capabilities without starting a runner."),
  reason: z.string().min(1).max(500).optional().describe("Optional concise audit reason for starting the existing task.")
});

export const CodexStartResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  run_id: CodexRunIdSchema,
  dry_run: z.boolean(),
  validated: z.boolean(),
  started: z.boolean(),
  execution_path: z.string(),
  stdout_path: z.string(),
  stderr_path: z.string(),
  execution_state: CodexExecutionReviewStateSchema.optional(),
  invocation: z.object({
    command: z.string(),
    args: z.array(z.string()),
    cwd_verified: z.boolean(),
    prompt_via_stdin: z.boolean(),
    structured_output: z.boolean(),
    sandbox: z.literal("workspace-write")
  }),
  next_steps: z.array(z.string()),
  warnings: z.array(z.string())
});

export const CodexReviewInputSchema = RepoInputSchema.extend({
  run_id: CodexRunIdSchema.describe("Codex run id under .chatgpt/codex-runs."),
  max_files: z.number().int().positive().optional().describe("Maximum git diff files to summarize.")
});

export const CodexParsedResultSchema = z.object({
  status: z.enum(["completed", "blocked", "unknown"]),
  summary: z.string(),
  changed_files: z.array(z.string()),
  commands_run: z.array(z.string()),
  tests: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  blockers: z.array(z.string()),
  followups: z.array(z.string()),
  raw_text: z.string()
});

export const CodexReviewResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  run_id: CodexRunIdSchema,
  result_path: z.string(),
  execution_found: z.boolean().optional(),
  execution_state: CodexExecutionReviewStateSchema.optional(),
  result_found: z.boolean(),
  codex_result: CodexParsedResultSchema.optional(),
  git_review: GitReviewResultSchema.optional(),
  next_tool_payloads: GitReviewResultSchema.shape.next_tool_payloads.optional(),
  next_steps: z.array(z.string()),
  warnings: z.array(z.string())
});

export type CodexTask = z.output<typeof CodexTaskInputSchema>;
export type CodexTaskInput = z.input<typeof CodexTaskInputSchema>;
export type CodexTaskWrite = z.output<typeof CodexTaskWriteInputSchema>;
export type CodexTaskWriteInput = z.input<typeof CodexTaskWriteInputSchema>;
export type CodexTaskResult = z.infer<typeof CodexTaskResultSchema>;
export type CodexTaskWriteResult = z.infer<typeof CodexTaskWriteResultSchema>;
export type CodexTaskManifest = z.infer<typeof CodexTaskManifestSchema>;
export type CodexExecutionStatus = z.infer<typeof CodexExecutionStatusSchema>;
export type CodexExecutionState = z.infer<typeof CodexExecutionStateSchema>;
export type CodexExecutionReviewState = z.infer<typeof CodexExecutionReviewStateSchema>;
export type CodexStartInput = z.infer<typeof CodexStartInputSchema>;
export type CodexStartResult = z.infer<typeof CodexStartResultSchema>;
export type CodexReviewInput = z.infer<typeof CodexReviewInputSchema>;
export type CodexParsedResult = z.infer<typeof CodexParsedResultSchema>;
export type CodexReviewResult = z.infer<typeof CodexReviewResultSchema>;
