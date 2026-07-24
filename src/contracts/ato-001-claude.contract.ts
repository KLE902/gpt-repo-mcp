import { z } from "zod";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const IsoDateSchema = z.string().datetime({ offset: true });
const Ato001McpCallSchema = z.object({
  call_id: z.string().min(1).max(128),
  tool: z.string().min(1).max(128),
  recorded_at: IsoDateSchema.nullable(),
  outcome: z.string().min(1).max(256).optional()
}).strict();

export const Ato001ClaudeStartInputSchema = z.object({}).strict();
export const Ato001ClaudeReviewInputSchema = z.object({}).strict();

export const Ato001ClaudeSemanticResultSchema = z.object({
  framing_challenge: z.string().min(1).max(12_000),
  recommended_product_contract: z.string().min(1).max(12_000),
  recommended_ui_contract: z.string().min(1).max(12_000),
  preservation_notes: z.array(z.string().min(1).max(2_000)).min(1).max(20),
  assumptions: z.array(z.string().min(1).max(2_000)).max(20),
  evidence_gaps: z.array(z.string().min(1).max(2_000)).max(20),
  owner_judgments: z.array(z.string().min(1).max(2_000)).max(20),
  exclusions_confirmed: z.object({
    no_file_edits: z.literal(true),
    no_cross_source_deduplication: z.literal(true),
    no_production_implementation_plan: z.literal(true)
  }).strict()
}).strict();

export const Ato001BoundarySchema = z.object({
  repository: z.boolean(),
  branch: z.boolean(),
  head: z.boolean(),
  clean: z.boolean(),
  origin_synchronized: z.boolean(),
  task_identity: z.boolean(),
  context_hashes: z.boolean(),
  context_aggregate: z.boolean(),
  cli_resolution: z.boolean(),
  cli_version: z.boolean(),
  authentication: z.boolean(),
  capabilities: z.boolean(),
  read_only_invocation: z.boolean(),
  complete_output: z.boolean(),
  result_schema: z.boolean()
}).strict();

export const Ato001ExecutionStateSchema = z.object({
  schema_version: z.literal(1),
  run_id: z.literal("ato-001-pkr-004"),
  status: z.enum(["starting", "running", "completed", "provider_failed", "output_contract_failed", "timed_out", "truncated", "repository_drift", "context_drift", "unverifiable_read_boundary"]),
  terminal: z.boolean(),
  valid_for_pkr_intake: z.boolean(),
  diagnostic_only: z.boolean(),
  started_at: IsoDateSchema.nullable(),
  updated_at: IsoDateSchema,
  ended_at: IsoDateSchema.nullable(),
  runner_pid: z.number().int().positive().nullable(),
  process_pid: z.number().int().positive().nullable(),
  exit_code: z.number().int().nullable(),
  provider_runtime_ms: z.number().int().nonnegative().nullable(),
  timed_out: z.boolean(),
  output_complete: z.boolean(),
  output_truncated: z.boolean(),
  terminal_classification: z.string().min(1).nullable(),
  diagnostic: z.string().max(4_096).nullable(),
  boundary: Ato001BoundarySchema,
  provider_usage: z.record(z.string(), z.unknown()).nullable(),
  provider_cost_usd: z.number().nonnegative().nullable(),
  provider_turns: z.number().int().nonnegative().nullable(),
  result_sha256: Sha256Schema.nullable()
  ,process_tree_termination_outcome: z.enum(["not_required", "verified_complete", "requested_unverified"])
}).strict();

const ContextIdentitySchema = z.object({
  path: z.string().min(1),
  sha256: Sha256Schema
}).strict();

export const Ato001ClaudeStartResultSchema = z.object({
  ok: z.literal(true),
  run_id: z.literal("ato-001-pkr-004"),
  repo_id: z.literal("premium-komga-reader"),
  started: z.boolean(),
  state: Ato001ExecutionStateSchema,
  task_sha256: Sha256Schema,
  context_aggregate_sha256: Sha256Schema,
  artifact_paths: z.array(z.string().min(1)).min(5),
  invocation: z.object({
    provider: z.literal("claude"),
    version: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    cwd: z.literal("<premium-komga-reader-root>"),
    prompt_via_stdin: z.literal(true),
    max_turns: z.literal(1),
    permission_mode: z.literal("plan"),
    allowed_tools: z.array(z.enum(["Read", "Glob", "Grep"])),
    disallowed_tools: z.array(z.enum(["Bash", "Edit", "Write", "NotebookEdit"])),
    timeout_ms: z.number().int().positive(),
    max_output_bytes: z.number().int().positive()
  }).strict(),
  context: z.array(ContextIdentitySchema).length(10),
  next_steps: z.array(z.string()),
  warnings: z.array(z.string())
}).strict();

export const Ato001MeasurementsSchema = z.object({
  owner_prompt_relay_count: z.literal(0),
  owner_result_relay_count: z.literal(0),
  chatgpt_mcp_start_calls: z.array(Ato001McpCallSchema).min(1).max(2),
  chatgpt_mcp_review_calls: z.array(Ato001McpCallSchema).max(100),
  measured_start_via_chatgpt_mcp: z.literal(true),
  measured_result_retrieval_via_chatgpt_mcp: z.boolean(),
  owner_actions: z.object({
    terminal: z.literal(0),
    powershell: z.literal(0),
    filesystem: z.literal(0),
    attachment: z.literal(0),
    claude_ui: z.literal(0)
  }).strict(),
  prospective_active_owner_administration_ms: z.number().int().nonnegative().nullable(),
  total_elapsed_ms: z.number().int().nonnegative().nullable(),
  task_runtime_ms: z.number().int().nonnegative().nullable(),
  measured_attempt_count: z.number().int().min(1).max(2),
  narrow_repair_used: z.boolean(),
  timeout_outcome: z.string().min(1),
  process_tree_termination_outcome: z.enum(["not_required", "verified_complete", "requested_unverified"]),
  output_complete: z.boolean(),
  parsing_validation_outcome: z.string().min(1),
  repository_context_boundary_outcome: z.string().min(1),
  read_lease_outcome: z.string().min(1),
  turns: z.number().int().nonnegative().nullable(),
  usage: z.record(z.string(), z.unknown()).nullable(),
  reported_cost_usd: z.number().nonnegative().nullable(),
  remaining_recurring_setup_steps: z.array(z.string()),
  owner_perceived_administrative_burden: z.enum(["not_recorded", "lower", "similar", "higher"]),
  valid_for_pkr_interim_intake: z.boolean(),
  recommendation: z.enum(["pending", "proceed_to_phase_1", "proceed_only_after_bounded_changes", "stop_ato_development"])
}).strict();

export const Ato001ClaudeReviewResultSchema = z.object({
  ok: z.literal(true),
  run_id: z.literal("ato-001-pkr-004"),
  repo_id: z.literal("premium-komga-reader"),
  terminal: z.boolean(),
  lease_released: z.boolean(),
  valid_for_pkr_intake: z.boolean(),
  diagnostic_only: z.boolean(),
  state: Ato001ExecutionStateSchema,
  result: Ato001ClaudeSemanticResultSchema.nullable(),
  invalidation_reason: z.string().nullable(),
  evidence: z.object({
    task_sha256: Sha256Schema,
    context_aggregate_sha256: Sha256Schema,
    context: z.array(ContextIdentitySchema).length(10),
    boundary: Ato001BoundarySchema,
    artifacts_complete: z.boolean(),
    residual_risk: z.string().min(1)
  }).strict(),
  measurements: Ato001MeasurementsSchema,
  artifact_paths: z.array(z.string().min(1)).min(5),
  next_steps: z.array(z.string()),
  warnings: z.array(z.string())
}).strict();

export type Ato001ClaudeSemanticResult = z.infer<typeof Ato001ClaudeSemanticResultSchema>;
export type Ato001ExecutionState = z.infer<typeof Ato001ExecutionStateSchema>;
export type Ato001ClaudeStartResult = z.infer<typeof Ato001ClaudeStartResultSchema>;
export type Ato001ClaudeReviewResult = z.infer<typeof Ato001ClaudeReviewResultSchema>;
