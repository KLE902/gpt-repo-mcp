import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  Ato001ClaudeReviewInputSchema,
  Ato001ClaudeStartInputSchema
} from "../src/contracts/ato-001-claude.contract.js";
import {
  buildAto001ClaudeArgs,
  publicAto001Invocation,
  verifyAto001ClaudeCli
} from "../src/services/ato-001-claude-cli.js";
import {
  ATO001_CONTEXT,
  ATO001_CONTEXT_AGGREGATE_SHA256,
  ATO001_HEAD,
  ATO001_TASK_SHA256,
  ato001ContextIdentityText
} from "../src/services/ato-001-claude-profile.js";
import { Ato001ReadLease } from "../src/services/ato-001-read-lease.js";
import { Ato001RepositoryVerifier } from "../src/services/ato-001-repository-verifier.js";
import { Ato001ClaudeReviewService } from "../src/services/ato-001-claude-review-service.js";
import { RepoReaderError } from "../src/runtime/errors.js";

const TASK = "Challenge the framing first. Then recommend the smallest truthful product and UI contract for showing owning-library provenance only when all-libraries Global Search returns visually ambiguous duplicate-looking results. Preserve source identity, current navigation, accessibility, cover-first quietness, and existing result grouping. Identify assumptions, evidence gaps, and what would require owner judgment. Do not edit files and do not expand the task into cross-source deduplication or a production implementation plan.";

describe("ATO-001 fixed Claude spike", () => {
  test("binds the exact no-newline ATO-001 task bytes and aggregate context", async () => {
    const bytes = await readFile(resolve("src/fixed-tasks/ato-001-pkr-004.txt"));
    expect(bytes.toString("utf8")).toBe(TASK);
    expect(bytes.at(-1)).toBe(".".charCodeAt(0));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ATO001_TASK_SHA256);
    expect(createHash("sha256").update(ato001ContextIdentityText()).digest("hex")).toBe(ATO001_CONTEXT_AGGREGATE_SHA256);
    expect(ATO001_CONTEXT).toHaveLength(10);
  });

  test("exposes strict zero-parameter start and review inputs", () => {
    expect(Ato001ClaudeStartInputSchema.parse({})).toEqual({});
    expect(Ato001ClaudeReviewInputSchema.parse({})).toEqual({});
    expect(Ato001ClaudeStartInputSchema.safeParse({ prompt: "caller controlled" }).success).toBe(false);
    expect(Ato001ClaudeStartInputSchema.safeParse({ timeout_ms: 1 }).success).toBe(false);
    expect(Ato001ClaudeReviewInputSchema.safeParse({ repo_id: "other" }).success).toBe(false);
  });

  test("verifies exact CLI version, capability and non-interactive authentication without invoking Claude provider", async () => {
    const calls: string[][] = [];
    const result = await verifyAto001ClaudeCli({
      resolveCli: async () => "claude",
      runCommand: async (_command, args) => {
        calls.push(args);
        if (args[0] === "--version") return command("2.1.89\n");
        if (args[0] === "--help") return command("-p --output-format --max-turns --permission-mode --tools --disallowedTools --json-schema --no-session-persistence\n");
        return command('{"loggedIn":true}\n');
      }
    });
    expect(calls).toEqual([["--version"], ["--help"], ["auth", "status", "--json"]]);
    expect(publicAto001Invocation(result)).toMatchObject({
      max_turns: 1,
      permission_mode: "plan",
      allowed_tools: ["Read", "Glob", "Grep"],
      disallowed_tools: ["Bash", "Edit", "Write", "NotebookEdit"],
      args: expect.arrayContaining(["--no-session-persistence", "<fixed-semantic-result-schema>"])
    });
    expect(buildAto001ClaudeArgs(true)).toEqual(expect.arrayContaining([
      "--output-format", "json", "--max-turns", "1", "--permission-mode", "plan",
      "--tools", "Read,Glob,Grep", "--disallowedTools", "Bash,Edit,Write,NotebookEdit",
      "--json-schema", "--no-session-persistence"
    ]));
  });

  test("repository verification checks identity, clean synchronization, and all ten hashes", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "ato-verifier-")), "Premium-Komga-Reader");
    await mkdir(root);
    const expectedByPath = new Map<string, string>(ATO001_CONTEXT);
    const verifier = new Ato001RepositoryVerifier(root, {
      canonicalize: async (path) => resolve(path),
      git: async (args) => {
        const key = args.join(" ");
        if (key === "rev-parse --show-toplevel") return root;
        if (key === "remote get-url origin") return "https://github.com/KLE902/Premium-Komga-Reader.git";
        if (key === "symbolic-ref --quiet --short HEAD") return "master";
        if (key === "rev-parse HEAD" || key === "rev-parse refs/remotes/origin/master") return ATO001_HEAD;
        if (key === "status --porcelain=v1 --untracked-files=normal") return "";
        throw new Error(key);
      },
      readBytes: async (path) => {
        const relative = path.slice(resolve(root).length + 1).replaceAll("\\", "/");
        if (!expectedByPath.has(relative)) throw new Error("missing");
        return Buffer.from(relative);
      },
      hashBytes: (bytes) => expectedByPath.get(bytes.toString("utf8")) ?? "0".repeat(64)
    });

    await expect(verifier.verify()).resolves.toMatchObject({
      branch: "master",
      head: ATO001_HEAD,
      clean: true,
      origin_synchronized: true,
      context: expect.arrayContaining([{ path: "AGENTS.md", sha256: ATO001_CONTEXT[0][1] }])
    });
  });

  test("persistent read lease blocks known mutation guards until terminal release", async () => {
    const root = await mkdtemp(join(tmpdir(), "ato-lease-"));
    const lease = new Ato001ReadLease(root);
    await lease.acquireForStart(new Date("2026-07-24T10:00:00Z"), async () => {});
    await expect(lease.withMutationGuard(async () => "mutated")).rejects.toMatchObject({ code: "ATO001_READ_LEASE_ACTIVE" });
    expect(await lease.isActive()).toBe(true);
    await lease.releaseAfterTerminalReview();
    expect(await lease.isActive()).toBe(false);
    await expect(lease.withMutationGuard(async () => "allowed")).resolves.toBe("allowed");
  });

  test("terminal review revalidates context, invalidates drift, and releases the lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "ato-review-"));
    const lease = new Ato001ReadLease(root);
    await lease.acquireForStart(new Date("2026-07-24T10:00:00Z"), async () => {
      const artifactDirectory = join(root, ".chatgpt", "ato-001-claude-spike", "ato-001-pkr-004");
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(join(artifactDirectory, "task.txt"), TASK);
      await writeFile(join(artifactDirectory, "metadata.json"), "{}\n");
      await writeFile(join(artifactDirectory, "provider-output.json"), "{}\n");
      await writeFile(join(artifactDirectory, "measurements.json"), `${JSON.stringify(initialMeasurements(), null, 2)}\n`);
      await writeFile(join(artifactDirectory, "validated-result.json"), `${JSON.stringify({
        schema_version: 1,
        valid_for_pkr_intake: true,
        result: semanticResult()
      })}\n`);
      await writeFile(join(artifactDirectory, "execution.json"), `${JSON.stringify(completedState(), null, 2)}\n`);
    });

    const result = await new Ato001ClaudeReviewService(root, {
      verifyRepository: async () => {
        throw new RepoReaderError("ATO001_CONTEXT_DRIFT", "fixture drift");
      },
      now: () => new Date("2026-07-24T10:01:00Z")
    }).review({
      call_id: "00000000-0000-4000-8000-000000000001",
      recorded_at: "2026-07-24T10:01:00.000Z"
    });

    expect(result).toMatchObject({
      terminal: true,
      lease_released: true,
      valid_for_pkr_intake: false,
      diagnostic_only: true,
      result: null,
      invalidation_reason: "ATO001_CONTEXT_DRIFT",
      state: {
        status: "context_drift",
        boundary: { context_hashes: false, context_aggregate: false }
      }
    });
    expect(await lease.isActive()).toBe(false);
  });
});

function command(stdout: string) {
  return { exitCode: 0, stdout, stderr: "", timedOut: false, complete: true, truncated: false };
}

function semanticResult() {
  return {
    framing_challenge: "Challenge",
    recommended_product_contract: "Product",
    recommended_ui_contract: "UI",
    preservation_notes: ["Preserve identity"],
    assumptions: [],
    evidence_gaps: [],
    owner_judgments: [],
    exclusions_confirmed: {
      no_file_edits: true,
      no_cross_source_deduplication: true,
      no_production_implementation_plan: true
    }
  };
}

function initialMeasurements() {
  return {
    owner_prompt_relay_count: 0,
    owner_result_relay_count: 0,
    chatgpt_mcp_start_calls: [{
      call_id: "00000000-0000-4000-8000-000000000000",
      tool: "repo_start_ato_001_claude",
      recorded_at: "2026-07-24T10:00:00.000Z"
    }],
    chatgpt_mcp_review_calls: [],
    measured_start_via_chatgpt_mcp: true,
    measured_result_retrieval_via_chatgpt_mcp: false,
    owner_actions: { terminal: 0, powershell: 0, filesystem: 0, attachment: 0, claude_ui: 0 },
    prospective_active_owner_administration_ms: null,
    total_elapsed_ms: null,
    task_runtime_ms: null,
    measured_attempt_count: 1,
    narrow_repair_used: false,
    timeout_outcome: "pending",
    process_tree_termination_outcome: "not_required",
    output_complete: false,
    parsing_validation_outcome: "pending",
    repository_context_boundary_outcome: "start_verified",
    read_lease_outcome: "acquired",
    turns: null,
    usage: null,
    reported_cost_usd: null,
    remaining_recurring_setup_steps: [],
    owner_perceived_administrative_burden: "not_recorded",
    valid_for_pkr_interim_intake: false,
    recommendation: "pending"
  };
}

function completedState() {
  return {
    schema_version: 1,
    run_id: "ato-001-pkr-004",
    status: "completed",
    terminal: true,
    valid_for_pkr_intake: true,
    diagnostic_only: false,
    started_at: "2026-07-24T10:00:00.000Z",
    updated_at: "2026-07-24T10:00:30.000Z",
    ended_at: "2026-07-24T10:00:30.000Z",
    runner_pid: null,
    process_pid: null,
    exit_code: 0,
    provider_runtime_ms: 30_000,
    timed_out: false,
    output_complete: true,
    output_truncated: false,
    terminal_classification: "transport_success",
    diagnostic: null,
    boundary: {
      repository: true,
      branch: true,
      head: true,
      clean: true,
      origin_synchronized: true,
      task_identity: true,
      context_hashes: true,
      context_aggregate: true,
      cli_resolution: true,
      cli_version: true,
      authentication: true,
      capabilities: true,
      read_only_invocation: true,
      complete_output: true,
      result_schema: true
    },
    provider_usage: null,
    provider_cost_usd: null,
    provider_turns: 1,
    result_sha256: "a".repeat(64),
    process_tree_termination_outcome: "not_required"
  };
}
