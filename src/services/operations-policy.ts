import { DEFAULT_OPERATIONS_POLICY } from "../policies/operations-defaults.js";
import { RepoReaderError } from "../runtime/errors.js";

export type AllowedScriptConfig = {
  command: string;
  args: string[];
  timeout_ms: number;
  max_output_bytes: number;
  inherit_env: string[];
};

export type CodexTaskRunPolicy = {
  timeout_ms: number;
  max_output_bytes: number;
  inherit_env: string[];
};

export type OperationsPolicyConfig = {
  enabled?: boolean;
  git_stage_enabled?: boolean;
  git_commit_enabled?: boolean;
  git_branch_enabled?: boolean;
  git_branch_manage_enabled?: boolean;
  git_push_enabled?: boolean;
  github_pull_request_enabled?: boolean;
  github_workflow_dispatch_enabled?: boolean;
  allowed_workflows?: string[];
  github_merge_enabled?: boolean;
  git_sync_enabled?: boolean;
  script_run_enabled?: boolean;
  allowed_scripts?: Record<string, Partial<AllowedScriptConfig> & Pick<AllowedScriptConfig, "command">>;
  codex_task_run_enabled?: boolean;
  codex_task_max_runtime_ms?: number;
  codex_task_max_output_bytes?: number;
  codex_task_inherit_env?: string[];
  claude_ato_001_enabled?: boolean;
  max_paths_per_operation?: number;
  cleanup_enabled?: boolean;
  cleanup_allowed_globs?: string[];
};

export type EffectiveOperationsPolicy = {
  enabled: boolean;
  git_stage_enabled: boolean;
  git_commit_enabled: boolean;
  git_branch_enabled: boolean;
  git_branch_manage_enabled: boolean;
  git_push_enabled: boolean;
  github_pull_request_enabled: boolean;
  github_workflow_dispatch_enabled: boolean;
  allowed_workflows: string[];
  github_merge_enabled: boolean;
  git_sync_enabled: boolean;
  script_run_enabled: boolean;
  allowed_scripts: Record<string, AllowedScriptConfig>;
  codex_task_run_enabled: boolean;
  codex_task_max_runtime_ms: number;
  codex_task_max_output_bytes: number;
  codex_task_inherit_env: string[];
  claude_ato_001_enabled: boolean;
  max_paths_per_operation: number;
  cleanup_enabled: boolean;
  cleanup_allowed_globs: string[];
};

export class OperationsPolicy {
  readonly config: EffectiveOperationsPolicy;

  constructor(config: OperationsPolicyConfig = {}) {
    this.config = {
      enabled: config.enabled ?? DEFAULT_OPERATIONS_POLICY.enabled,
      git_stage_enabled: config.git_stage_enabled ?? DEFAULT_OPERATIONS_POLICY.git_stage_enabled,
      git_commit_enabled: config.git_commit_enabled ?? DEFAULT_OPERATIONS_POLICY.git_commit_enabled,
      git_branch_enabled: config.git_branch_enabled ?? DEFAULT_OPERATIONS_POLICY.git_branch_enabled,
      git_branch_manage_enabled: config.git_branch_manage_enabled ?? DEFAULT_OPERATIONS_POLICY.git_branch_manage_enabled,
      git_push_enabled: config.git_push_enabled ?? DEFAULT_OPERATIONS_POLICY.git_push_enabled,
      github_pull_request_enabled: config.github_pull_request_enabled ?? DEFAULT_OPERATIONS_POLICY.github_pull_request_enabled,
      github_workflow_dispatch_enabled: config.github_workflow_dispatch_enabled ?? DEFAULT_OPERATIONS_POLICY.github_workflow_dispatch_enabled,
      allowed_workflows: [...(config.allowed_workflows ?? DEFAULT_OPERATIONS_POLICY.allowed_workflows)],
      github_merge_enabled: config.github_merge_enabled ?? DEFAULT_OPERATIONS_POLICY.github_merge_enabled,
      git_sync_enabled: config.git_sync_enabled ?? DEFAULT_OPERATIONS_POLICY.git_sync_enabled,
      script_run_enabled: config.script_run_enabled ?? DEFAULT_OPERATIONS_POLICY.script_run_enabled,
      allowed_scripts: normalizeScripts(config.allowed_scripts ?? DEFAULT_OPERATIONS_POLICY.allowed_scripts),
      codex_task_run_enabled: config.codex_task_run_enabled ?? DEFAULT_OPERATIONS_POLICY.codex_task_run_enabled,
      codex_task_max_runtime_ms: config.codex_task_max_runtime_ms ?? DEFAULT_OPERATIONS_POLICY.codex_task_max_runtime_ms,
      codex_task_max_output_bytes: config.codex_task_max_output_bytes ?? DEFAULT_OPERATIONS_POLICY.codex_task_max_output_bytes,
      codex_task_inherit_env: [...(config.codex_task_inherit_env ?? DEFAULT_OPERATIONS_POLICY.codex_task_inherit_env)],
      claude_ato_001_enabled: config.claude_ato_001_enabled ?? DEFAULT_OPERATIONS_POLICY.claude_ato_001_enabled,
      max_paths_per_operation: config.max_paths_per_operation ?? DEFAULT_OPERATIONS_POLICY.max_paths_per_operation,
      cleanup_enabled: config.cleanup_enabled ?? DEFAULT_OPERATIONS_POLICY.cleanup_enabled,
      cleanup_allowed_globs: config.cleanup_allowed_globs ?? [...DEFAULT_OPERATIONS_POLICY.cleanup_allowed_globs]
    };
  }

  assertStageAllowed(paths: string[]): void {
    this.assertEnabled();
    if (!this.config.git_stage_enabled) throw new RepoReaderError("GIT_STAGE_DISABLED", "Git staging operations are disabled for this repository.");
    this.assertPathCount(paths);
  }

  assertCommitAllowed(paths: string[]): void {
    this.assertEnabled();
    if (!this.config.git_commit_enabled) throw new RepoReaderError("GIT_COMMIT_DISABLED", "Git commit operations are disabled for this repository.");
    this.assertPathCount(paths);
  }

  assertBranchAllowed(): void {
    this.assertEnabled();
    if (!this.config.git_branch_enabled) throw new RepoReaderError("GIT_BRANCH_CREATE_DISABLED", "Git feature-branch creation is disabled for this repository.");
  }

  assertBranchManageAllowed(): void {
    this.assertEnabled();
    if (!this.config.git_branch_manage_enabled) throw new RepoReaderError("GIT_BRANCH_MANAGE_DISABLED", "Git branch switch and cleanup operations are disabled for this repository.");
  }

  assertPushAllowed(): void {
    this.assertEnabled();
    if (!this.config.git_push_enabled) throw new RepoReaderError("GIT_PUSH_DISABLED", "Git push operations are disabled for this repository.");
  }

  assertPullRequestAllowed(): void {
    this.assertEnabled();
    if (!this.config.github_pull_request_enabled) throw new RepoReaderError("GITHUB_PULL_REQUEST_DISABLED", "GitHub pull request operations are disabled for this repository.");
  }

  assertWorkflowAllowed(workflowId: string): void {
    this.assertEnabled();
    if (!this.config.github_workflow_dispatch_enabled) throw new RepoReaderError("GITHUB_WORKFLOW_DISPATCH_DISABLED", "GitHub Actions workflow dispatch is disabled for this repository.");
    if (!this.config.allowed_workflows.includes(workflowId)) throw new RepoReaderError("GITHUB_WORKFLOW_NOT_ALLOWED", `Workflow ${workflowId} is not allowlisted for this repository.`);
  }

  assertMergeAllowed(): void {
    this.assertEnabled();
    if (!this.config.github_merge_enabled) throw new RepoReaderError("GITHUB_MERGE_DISABLED", "GitHub merge operations are disabled for this repository.");
  }

  assertSyncAllowed(): void {
    this.assertEnabled();
    if (!this.config.git_sync_enabled) throw new RepoReaderError("GIT_SYNC_DISABLED", "Guarded Git synchronization is disabled for this repository.");
  }

  getAllowedScript(scriptId: string): AllowedScriptConfig {
    this.assertEnabled();
    if (!this.config.script_run_enabled) throw new RepoReaderError("SCRIPT_RUN_DISABLED", "Allowlisted script execution is disabled for this repository.");
    const script = this.config.allowed_scripts[scriptId];
    if (!script) throw new RepoReaderError("SCRIPT_NOT_ALLOWED", `Script id ${scriptId} is not configured for this repository.`);
    return script;
  }

  getCodexTaskRunPolicy(): CodexTaskRunPolicy {
    this.assertEnabled();
    if (!this.config.codex_task_run_enabled) throw new RepoReaderError("CODEX_TASK_RUN_DISABLED", "Durable Codex task execution is disabled for this repository.");
    return {
      timeout_ms: this.config.codex_task_max_runtime_ms,
      max_output_bytes: this.config.codex_task_max_output_bytes,
      inherit_env: [...this.config.codex_task_inherit_env]
    };
  }

  assertAto001ClaudeAllowed(): void {
    this.assertEnabled();
    if (!this.config.claude_ato_001_enabled) {
      throw new RepoReaderError("ATO001_CLAUDE_DISABLED", "The fixed ATO-001 Claude transport spike is disabled for this repository.");
    }
  }

  assertRestoreAllowed(paths: string[]): void {
    this.assertEnabled();
    this.assertPathCount(paths);
  }

  assertCleanupAllowed(paths: string[]): void {
    this.assertEnabled();
    if (!this.config.cleanup_enabled) throw new RepoReaderError("CLEANUP_DISABLED", "Cleanup operations are disabled for this repository.");
    if (paths.length === 0) throw new RepoReaderError("CLEANUP_PATHS_REQUIRED", "At least one explicit cleanup path is required.");
    this.assertPathCount(paths);
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw new RepoReaderError("OPERATIONS_DISABLED", "Repository operations are disabled for this repository.");
  }

  private assertPathCount(paths: string[]): void {
    if (paths.length === 0) throw new RepoReaderError("GIT_OPERATION_PATHS_REQUIRED", "At least one explicit path is required.");
    if (paths.length > this.config.max_paths_per_operation) throw new RepoReaderError("GIT_OPERATION_TOO_MANY_PATHS", `Too many paths for one operation: ${paths.length}`);
  }
}

function normalizeScripts(input: OperationsPolicyConfig["allowed_scripts"]): Record<string, AllowedScriptConfig> {
  const result: Record<string, AllowedScriptConfig> = {};
  for (const [id, script] of Object.entries(input ?? {})) {
    result[id] = {
      command: script.command,
      args: script.args ?? [],
      timeout_ms: script.timeout_ms ?? 900_000,
      max_output_bytes: script.max_output_bytes ?? 131_072,
      inherit_env: script.inherit_env ?? []
    };
  }
  return result;
}
