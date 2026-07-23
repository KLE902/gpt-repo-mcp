import { createHash } from "node:crypto";
import { CodexExecutionStateSchema, CodexReviewInputSchema, type CodexExecutionReviewState, type CodexReviewInput, type CodexReviewResult } from "../contracts/codex-task.contract.js";
import { DEFAULT_LIMITS } from "../policies/limits.js";
import { RepoReaderError } from "../runtime/errors.js";
import { readFilePrefix } from "./bounded-read.js";
import { isProcessAlive } from "./codex-execution-service.js";
import { CodexResultService } from "./codex-result-service.js";
import { codexRunPaths } from "./codex-task-service.js";
import type { GitReviewService } from "./git-review-service.js";
import { PathSandbox } from "./path-sandbox.js";

export class CodexReviewService {
  private readonly legacy: CodexResultService;

  constructor(
    private readonly sandbox: PathSandbox,
    private readonly gitReviewService: GitReviewService,
    private readonly processAlive: (pid: number) => boolean = isProcessAlive
  ) {
    this.legacy = new CodexResultService(sandbox, gitReviewService);
  }

  async review(rawInput: CodexReviewInput): Promise<CodexReviewResult> {
    const input = CodexReviewInputSchema.parse(rawInput);
    const paths = codexRunPaths(input.run_id);
    const execution = await this.readExecution(paths.executionPath);
    if (!execution) {
      const legacy = await this.legacy.review(input);
      return { ...legacy, execution_found: false };
    }

    const executionState = this.withActivity(execution);
    const executionBoundary = boundaryReview(execution);
    if (execution.status === "starting" || execution.status === "running") {
      return {
        ok: true,
        repo_id: input.repo_id,
        run_id: input.run_id,
        result_path: paths.resultPath,
        execution_found: true,
        execution_state: executionState,
        execution_boundary: executionBoundary,
        result_found: false,
        next_steps: ["The durable Codex run has not reached a terminal state. Call repo_codex_review again in a later turn."],
        warnings: executionState.process_active ? [] : ["CODEX_PROCESS_NOT_ACTIVE"]
      };
    }

    if ((execution.status === "completed" || execution.status === "blocked") && !execution.execution_boundary_verified) {
      const gitReview = await this.gitReviewService.review({
        repo_id: input.repo_id,
        ...(input.max_files ? { max_files: input.max_files } : {})
      });
      return {
        ok: true,
        repo_id: input.repo_id,
        run_id: input.run_id,
        result_path: paths.resultPath,
        execution_found: true,
        execution_state: executionState,
        execution_boundary: executionBoundary,
        result_found: await this.exists(paths.resultPath),
        git_review: gitReview,
        next_tool_payloads: gitReview.next_tool_payloads,
        next_steps: [
          "The durable state claims success but lacks verified workspace-write execution-boundary evidence; do not accept the run even if RESULT.md and the Git diff look correct.",
          "Retain the Git review and recovery evidence, repair the local sandbox separately, and rerun through a new run id."
        ],
        warnings: [...new Set([
          ...gitReview.recommendation.warnings,
          "CODEX_EXECUTION_BOUNDARY_UNVERIFIED",
          ...(execution.boundary_evidence_version === null ? ["CODEX_LEGACY_EXECUTION_STATE"] : [])
        ])]
      };
    }

    if (execution.status === "completed" || execution.status === "blocked") {
      const provenance = await this.verifyResultProvenance(paths.resultPath, execution);
      if (!provenance.valid) {
        const gitReview = await this.gitReviewService.review({
          repo_id: input.repo_id,
          ...(input.max_files ? { max_files: input.max_files } : {})
        });
        return {
          ok: true,
          repo_id: input.repo_id,
          run_id: input.run_id,
          result_path: paths.resultPath,
          execution_found: true,
          execution_state: executionState,
          execution_boundary: executionBoundary,
          result_found: provenance.found,
          git_review: gitReview,
          next_tool_payloads: gitReview.next_tool_payloads,
          next_steps: [
            "RESULT.md no longer matches the terminal execution provenance; do not treat it as a verified Codex result.",
            "Review the durable execution state and actual Git diff, then use guarded recovery or rerun through a new run id if needed."
          ],
          warnings: [...new Set([...gitReview.recommendation.warnings, "CODEX_RESULT_PROVENANCE_MISMATCH"])]
        };
      }
      const reviewed = await this.legacy.review(input);
      return {
        ...reviewed,
        execution_found: true,
        execution_state: executionState,
        execution_boundary: executionBoundary,
        warnings: [...new Set([
          ...reviewed.warnings,
          ...(execution.scope_violations.length ? ["CODEX_SCOPE_VIOLATION"] : []),
          ...(execution.forbidden_path_changes.length ? ["CODEX_FORBIDDEN_PATH_CHANGED"] : []),
          ...(execution.staged_paths.length ? ["CODEX_STAGED_PATHS"] : []),
          ...(execution.branch_ref_changes.length ? ["CODEX_BRANCH_REFS_CHANGED"] : []),
          ...(execution.run_artifact_violations.length ? ["CODEX_RUN_ARTIFACT_VIOLATION"] : []),
          ...(execution.output_truncated ? ["CODEX_OUTPUT_TRUNCATED"] : []),
          ...(!execution.output_complete ? ["CODEX_OUTPUT_INCOMPLETE"] : [])
        ])]
      };
    }

    const gitReview = await this.gitReviewService.review({
      repo_id: input.repo_id,
      ...(input.max_files ? { max_files: input.max_files } : {})
    });
    return {
      ok: true,
      repo_id: input.repo_id,
      run_id: input.run_id,
      result_path: paths.resultPath,
      execution_found: true,
      execution_state: executionState,
      execution_boundary: executionBoundary,
      result_found: await this.exists(paths.resultPath),
      git_review: gitReview,
      next_tool_payloads: gitReview.next_tool_payloads,
      next_steps: [
        "Review the terminal execution diagnostic together with the actual Git review and preserved output artifacts.",
        "Use the review-provided guarded recovery payload only after deciding which changes should be retained or recovered."
      ],
      warnings: [...new Set([
        ...gitReview.recommendation.warnings,
        `CODEX_EXECUTION_${execution.status.toUpperCase()}`,
        ...(execution.scope_violations.length ? ["CODEX_SCOPE_VIOLATION"] : []),
        ...(execution.forbidden_path_changes.length ? ["CODEX_FORBIDDEN_PATH_CHANGED"] : []),
        ...(execution.staged_paths.length ? ["CODEX_STAGED_PATHS"] : []),
        ...(execution.branch_ref_changes.length ? ["CODEX_BRANCH_REFS_CHANGED"] : []),
        ...(execution.run_artifact_violations.length ? ["CODEX_RUN_ARTIFACT_VIOLATION"] : []),
        ...(execution.sandbox_failure_detected ? ["CODEX_SANDBOX_BOOTSTRAP_FAILED"] : []),
        ...(execution.fallback_tool_violations.length ? ["CODEX_EXECUTION_BOUNDARY_VIOLATION"] : []),
        ...(!execution.execution_boundary_verified ? ["CODEX_EXECUTION_BOUNDARY_UNVERIFIED"] : []),
        ...(execution.output_truncated ? ["CODEX_OUTPUT_TRUNCATED"] : []),
        ...(!execution.output_complete ? ["CODEX_OUTPUT_INCOMPLETE"] : [])
      ])]
    };
  }

  private async readExecution(path: string) {
    try {
      const resolved = await this.sandbox.resolve(path);
      if (!resolved.stat.isFile()) throw new RepoReaderError("UNSUPPORTED_FILE_TYPE", `Not a regular file: ${resolved.repoPath}`);
      const { buffer, truncated } = await readFilePrefix(resolved.absolutePath, DEFAULT_LIMITS.max_bytes_per_file);
      if (truncated) throw new RepoReaderError("SIZE_LIMIT_EXCEEDED", `File exceeds max_bytes: ${resolved.repoPath}`);
      return CodexExecutionStateSchema.parse(JSON.parse(decodeUtf8(buffer, resolved.repoPath)));
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      if (error instanceof RepoReaderError) throw error;
      throw new RepoReaderError("CODEX_EXECUTION_INVALID", "execution.json is malformed or outside the supported schema.");
    }
  }

  private async verifyResultProvenance(path: string, state: ReturnType<typeof CodexExecutionStateSchema.parse>): Promise<{ valid: boolean; found: boolean }> {
    if (!state.result_sha256 || state.result_bytes === null || state.result_status !== state.status) return { valid: false, found: await this.exists(path) };
    try {
      const resolved = await this.sandbox.resolve(path);
      if (!resolved.stat.isFile()) return { valid: false, found: false };
      const limit = Math.max(DEFAULT_LIMITS.max_bytes_per_file, state.result_bytes + 1);
      const { buffer, truncated } = await readFilePrefix(resolved.absolutePath, limit);
      if (truncated || buffer.length !== state.result_bytes) return { valid: false, found: true };
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      if (sha256 !== state.result_sha256) return { valid: false, found: true };
      const text = decodeUtf8(buffer, resolved.repoPath);
      const status = text.match(/^status:\s*(completed|blocked)\s*$/im)?.[1]?.toLowerCase();
      return { valid: status === state.status, found: true };
    } catch (error) {
      if (isNotFoundError(error)) return { valid: false, found: false };
      return { valid: false, found: true };
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      const resolved = await this.sandbox.resolve(path);
      return resolved.stat.isFile();
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  private withActivity(state: ReturnType<typeof CodexExecutionStateSchema.parse>): CodexExecutionReviewState {
    const processActive = [state.process_pid, state.runner_pid].some((pid) => typeof pid === "number" && this.processAlive(pid));
    return { ...state, process_active: processActive };
  }
}

function boundaryReview(state: ReturnType<typeof CodexExecutionStateSchema.parse>) {
  let classificationReason = "Execution boundary provenance is not verified.";
  if (state.sandbox_failure_detected) {
    classificationReason = `The requested sandbox failed before or during execution (${state.sandbox_failure_code ?? "unknown sandbox failure"}).`;
  } else if (state.fallback_tool_violations.length > 0) {
    classificationReason = `Unverified host or fallback execution paths were observed: ${state.fallback_tool_violations.join(", ")}.`;
  } else if (state.boundary_evidence_version === null) {
    classificationReason = "This is an older durable execution state with no sandbox provenance evidence; missing evidence is not treated as verified.";
  } else if (state.execution_boundary_verified) {
    classificationReason = "The workspace-write sandbox bootstrap and execution boundary were positively verified.";
  } else if (state.status === "starting" || state.status === "running") {
    classificationReason = "Sandbox bootstrap was verified, but terminal execution-boundary classification is still pending.";
  }
  return {
    requested_sandbox: state.sandbox_requested,
    sandbox_bootstrap_verified: state.sandbox_bootstrap_verified,
    sandbox_failure_detected: state.sandbox_failure_detected,
    sandbox_failure_code: state.sandbox_failure_code,
    execution_boundary_verified: state.execution_boundary_verified,
    fallback_tool_violations: state.fallback_tool_violations,
    classification_reason: classificationReason
  };
}

function decodeUtf8(buffer: Buffer, path: string): string {
  if (buffer.includes(0)) throw new RepoReaderError("BINARY_FILE_REJECTED", `Binary file blocked: ${path}`);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { throw new RepoReaderError("BINARY_FILE_REJECTED", `Invalid UTF-8 file blocked: ${path}`); }
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}
