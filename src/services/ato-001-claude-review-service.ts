import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Ato001ClaudeReviewResultSchema,
  Ato001ClaudeSemanticResultSchema,
  Ato001ExecutionStateSchema,
  Ato001MeasurementsSchema,
  type Ato001ClaudeReviewResult,
  type Ato001ExecutionState
} from "../contracts/ato-001-claude.contract.js";
import { RepoReaderError } from "../runtime/errors.js";
import {
  ATO001_ARTIFACT_PATHS,
  ATO001_CONTEXT,
  ATO001_CONTEXT_AGGREGATE_SHA256,
  ATO001_REPO_ID,
  ATO001_RUN_ID,
  ATO001_TASK_SHA256,
  ato001ArtifactPaths
} from "./ato-001-claude-profile.js";
import { Ato001ReadLease } from "./ato-001-read-lease.js";
import { Ato001RepositoryVerifier } from "./ato-001-repository-verifier.js";

type ReviewDependencies = {
  verifyRepository?: () => Promise<unknown>;
  now?: () => Date;
  artifactRoot?: string;
};

type ReviewCall = { call_id: string; recorded_at: string; tool: string };
type Measurements = ReturnType<typeof Ato001MeasurementsSchema.parse>;

export class Ato001ClaudeReviewService {
  private readonly verifyRepository: () => Promise<unknown>;
  private readonly now: () => Date;
  private readonly artifactRoot: string;

  constructor(
    private readonly repoRoot: string,
    dependencies: ReviewDependencies = {}
  ) {
    this.verifyRepository = dependencies.verifyRepository ?? (() => new Ato001RepositoryVerifier(repoRoot).verify());
    this.now = dependencies.now ?? (() => new Date());
    this.artifactRoot = dependencies.artifactRoot ?? repoRoot;
  }

  async review(call: ReviewCall): Promise<Ato001ClaudeReviewResult> {
    let state = await this.readState();
    let measurements = await this.recordReviewCall(call, state.terminal);
    const lease = new Ato001ReadLease(this.artifactRoot);
    if (!state.terminal) {
      return this.buildResult(state, null, null, false, await lease.isActive(), measurements);
    }

    let invalidationReason: string | null = state.valid_for_pkr_intake ? null : state.terminal_classification;
    if (state.valid_for_pkr_intake) {
      try {
        await this.verifyRepository();
      } catch (error) {
        invalidationReason = error instanceof RepoReaderError ? error.code : "ATO001_RESULT_REVALIDATION_FAILED";
        state = await this.invalidateState(state, invalidationReason, invalidationReason.includes("CONTEXT"));
      }
    } else {
      try {
        await this.verifyRepository();
      } catch (error) {
        invalidationReason ??= error instanceof RepoReaderError ? error.code : "ATO001_RESULT_REVALIDATION_FAILED";
      }
    }

    const artifactsComplete = await this.artifactsComplete();
    if (state.valid_for_pkr_intake && !artifactsComplete) {
      invalidationReason = "ATO001_ARTIFACT_SET_INCOMPLETE";
      state = await this.invalidateState(state, invalidationReason, false);
    }

    const result = state.valid_for_pkr_intake ? await this.readValidatedResult() : null;
    const leaseWasActive = await lease.isActive();
    if (leaseWasActive) await lease.releaseAfterTerminalReview();
    measurements = await this.finalizeMeasurements(state, measurements, leaseWasActive ? "released_after_terminal_review" : "not_active_at_terminal_review");
    return this.buildResult(state, result, invalidationReason, artifactsComplete, false, measurements);
  }

  private async invalidateState(state: Ato001ExecutionState, reason: string, contextDrift: boolean): Promise<Ato001ExecutionState> {
    const invalidated: Ato001ExecutionState = {
      ...state,
      status: contextDrift ? "context_drift" : "repository_drift",
      valid_for_pkr_intake: false,
      diagnostic_only: true,
      updated_at: this.now().toISOString(),
      terminal_classification: reason,
      diagnostic: "Result-time PKR, context, or artifact revalidation failed; output is diagnostic-only.",
      boundary: {
        ...state.boundary,
        repository: contextDrift ? state.boundary.repository : false,
        context_hashes: contextDrift ? false : state.boundary.context_hashes,
        context_aggregate: contextDrift ? false : state.boundary.context_aggregate,
        result_schema: false
      }
    };
    await writeJsonAtomic(this.absolute(ATO001_ARTIFACT_PATHS.state), invalidated);
    await writeJsonAtomic(this.absolute(ATO001_ARTIFACT_PATHS.result), {
      schema_version: 1,
      valid_for_pkr_intake: false,
      invalidation_reason: reason,
      result: null
    });
    return invalidated;
  }

  private buildResult(
    state: Ato001ExecutionState,
    result: ReturnType<typeof Ato001ClaudeSemanticResultSchema.parse> | null,
    invalidationReason: string | null,
    artifactsComplete: boolean,
    leaseActive: boolean,
    measurements: Measurements
  ): Ato001ClaudeReviewResult {
    return Ato001ClaudeReviewResultSchema.parse({
      ok: true,
      run_id: ATO001_RUN_ID,
      repo_id: ATO001_REPO_ID,
      terminal: state.terminal,
      lease_released: state.terminal && !leaseActive,
      valid_for_pkr_intake: state.valid_for_pkr_intake,
      diagnostic_only: state.diagnostic_only,
      state,
      result,
      invalidation_reason: invalidationReason,
      evidence: {
        task_sha256: ATO001_TASK_SHA256,
        context_aggregate_sha256: ATO001_CONTEXT_AGGREGATE_SHA256,
        context: ATO001_CONTEXT.map(([path, sha256]) => ({ path, sha256 })),
        boundary: state.boundary,
        artifacts_complete: artifactsComplete,
        residual_risk: "The live-worktree lease blocks known MCP mutations only; external host processes remain outside MCP control."
      },
      measurements,
      artifact_paths: ato001ArtifactPaths(),
      next_steps: state.terminal
        ? [state.valid_for_pkr_intake ? "Carry the advisory result visibly into owner-controlled PKR need intake." : "Use the retained output only for ATO-001 spike diagnosis."]
        : ["Call repo_ato_001_claude_review again after the fixed runner reaches a terminal state."],
      warnings: ["LIVE_WORKTREE_EXTERNAL_PROCESS_RISK", ...(state.diagnostic_only ? ["RESULT_DIAGNOSTIC_ONLY"] : [])]
    });
  }

  private async readState(): Promise<Ato001ExecutionState> {
    try {
      return Ato001ExecutionStateSchema.parse(JSON.parse(await readFile(this.absolute(ATO001_ARTIFACT_PATHS.state), "utf8")));
    } catch {
      throw new RepoReaderError("ATO001_EXECUTION_INVALID", "ATO-001 execution state is missing or malformed; the lease remains fail-closed.");
    }
  }

  private async readValidatedResult() {
    try {
      const artifact = JSON.parse(await readFile(this.absolute(ATO001_ARTIFACT_PATHS.result), "utf8"));
      if (artifact.valid_for_pkr_intake !== true) throw new Error("invalid");
      return Ato001ClaudeSemanticResultSchema.parse(artifact.result);
    } catch {
      throw new RepoReaderError("ATO001_RESULT_INVALID", "The validated ATO-001 result artifact is missing or malformed; the lease remains fail-closed.");
    }
  }

  private async recordReviewCall(call: ReviewCall, terminal: boolean): Promise<Measurements> {
    const current = await this.readMeasurements();
    const measurements = Ato001MeasurementsSchema.parse({
      ...current,
      chatgpt_mcp_review_calls: [
        ...current.chatgpt_mcp_review_calls,
        call
      ],
      measured_result_retrieval_via_chatgpt_mcp: terminal || current.measured_result_retrieval_via_chatgpt_mcp
    });
    await writeJsonAtomic(this.absolute(ATO001_ARTIFACT_PATHS.measurements), measurements);
    return measurements;
  }

  private async finalizeMeasurements(state: Ato001ExecutionState, current: Measurements, leaseOutcome: string): Promise<Measurements> {
    const started = state.started_at ? Date.parse(state.started_at) : NaN;
    const ended = state.ended_at ? Date.parse(state.ended_at) : NaN;
    const recommendation = state.valid_for_pkr_intake ? "proceed_to_phase_1" : "proceed_only_after_bounded_changes";
    const measurements = Ato001MeasurementsSchema.parse({
      ...current,
      measured_result_retrieval_via_chatgpt_mcp: true,
      total_elapsed_ms: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null,
      task_runtime_ms: state.provider_runtime_ms,
      timeout_outcome: state.timed_out ? "timed_out" : "not_triggered",
      process_tree_termination_outcome: state.process_tree_termination_outcome,
      output_complete: state.output_complete,
      parsing_validation_outcome: state.boundary.result_schema ? "validated" : state.terminal_classification ?? "invalid",
      repository_context_boundary_outcome: state.valid_for_pkr_intake ? "result_revalidated" : "invalidated",
      read_lease_outcome: leaseOutcome,
      turns: state.provider_turns,
      usage: state.provider_usage,
      reported_cost_usd: state.provider_cost_usd,
      valid_for_pkr_interim_intake: state.valid_for_pkr_intake,
      recommendation
    });
    await writeJsonAtomic(this.absolute(ATO001_ARTIFACT_PATHS.measurements), measurements);
    return measurements;
  }

  private async readMeasurements(): Promise<Measurements> {
    try {
      return Ato001MeasurementsSchema.parse(JSON.parse(await readFile(this.absolute(ATO001_ARTIFACT_PATHS.measurements), "utf8")));
    } catch {
      throw new RepoReaderError("ATO001_EXECUTION_INVALID", "ATO-001 measurements are missing or malformed; the lease remains fail-closed.");
    }
  }

  private async artifactsComplete(): Promise<boolean> {
    for (const path of [
      ATO001_ARTIFACT_PATHS.task,
      ATO001_ARTIFACT_PATHS.metadata,
      ATO001_ARTIFACT_PATHS.state,
      ATO001_ARTIFACT_PATHS.output,
      ATO001_ARTIFACT_PATHS.result,
      ATO001_ARTIFACT_PATHS.measurements
    ]) {
      try {
        await readFile(this.absolute(path));
      } catch {
        return false;
      }
    }
    return true;
  }

  private absolute(path: string): string {
    return join(this.artifactRoot, ...path.split("/"));
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}
