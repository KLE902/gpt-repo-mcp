import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import type { CodexExecutionState } from "../src/contracts/codex-task.contract.js";
import { CodexReviewService } from "../src/services/codex-review-service.js";
import { codexRunPaths } from "../src/services/codex-task-service.js";
import { GitReviewService } from "../src/services/git-review-service.js";
import { OperationsPolicy } from "../src/services/operations-policy.js";
import { PathSandbox } from "../src/services/path-sandbox.js";

const execFileAsync = promisify(execFile);
const RUN_ID = "2026-07-23T140000Z-review-test";
const NOW = "2026-07-23T14:00:00.000Z";

describe("CodexReviewService", () => {
  test("returns durable running status without asking for manual result relay", async () => {
    const fixture = await createFixture();
    await writeExecution(fixture, state(fixture, "running", {
      runner_pid: 51001,
      process_pid: 51002,
      started_at: NOW
    }));

    const result = await reviewService(fixture, () => true).review({ repo_id: "demo", run_id: RUN_ID });

    expect(result).toMatchObject({
      execution_found: true,
      result_found: false,
      execution_state: {
        status: "running",
        process_active: true,
        start_branch: fixture.branch,
        start_head_sha: fixture.head
      }
    });
    expect(result.next_steps.join(" ")).not.toMatch(/paste|manual/i);
  });

  test.each(["completed", "blocked"] as const)("returns parsed RESULT.md and Git review for %s", async (status) => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "src", "app.ts"), `export const app = '${status}';\n`);
    const resultEvidence = await writeResult(fixture, status);
    await writeExecution(fixture, state(fixture, status, {
      runner_pid: 52001,
      process_pid: null,
      started_at: NOW,
      ended_at: NOW,
      exit_code: 0,
      output_complete: true,
      worktree_clean_after: false,
      changed_paths: ["src/app.ts"],
      result_sha256: resultEvidence.sha256,
      result_bytes: resultEvidence.bytes,
      result_status: status
    }));

    const result = await reviewService(fixture, () => false).review({ repo_id: "demo", run_id: RUN_ID });

    expect(result).toMatchObject({
      execution_found: true,
      result_found: true,
      execution_state: { status, process_active: false, output_complete: true },
      codex_result: { status, summary: `${status} review` },
      git_review: { ok: true }
    });
    expect(result.git_review?.changed_paths.map((entry) => entry.path)).toContain("src/app.ts");
  });

  test("refuses a terminal RESULT.md that no longer matches durable provenance", async () => {
    const fixture = await createFixture();
    const evidence = await writeResult(fixture, "completed");
    await writeExecution(fixture, state(fixture, "completed", {
      started_at: NOW,
      ended_at: NOW,
      exit_code: 0,
      output_complete: true,
      result_sha256: evidence.sha256,
      result_bytes: evidence.bytes,
      result_status: "completed"
    }));
    await writeFile(join(fixture.root, fixture.paths.resultPath), "# CODEX_RESULT\n\nstatus: completed\nsummary: tampered\n");

    const result = await reviewService(fixture, () => false).review({ repo_id: "demo", run_id: RUN_ID });

    expect(result.warnings).toContain("CODEX_RESULT_PROVENANCE_MISMATCH");
    expect(result.result_found).toBe(true);
    expect(result.codex_result).toBeUndefined();
    expect(result.git_review).toBeDefined();
  });

  test.each([
    ["failed", "CODEX_PROCESS_NONZERO_EXIT", false],
    ["timed_out", "CODEX_PROCESS_TIMED_OUT", true]
  ] as const)("returns terminal diagnostics and Git review for %s", async (status, errorCode, timedOut) => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "src", "app.ts"), `export const app = '${status}';\n`);
    await writeExecution(fixture, state(fixture, status, {
      runner_pid: 53001,
      process_pid: null,
      started_at: NOW,
      ended_at: NOW,
      exit_code: status === "failed" ? 7 : null,
      timed_out: timedOut,
      output_complete: false,
      error_code: errorCode,
      diagnostic: `${status} diagnostic`,
      worktree_clean_after: false,
      changed_paths: ["src/app.ts"]
    }));

    const result = await reviewService(fixture, () => false).review({ repo_id: "demo", run_id: RUN_ID });

    expect(result).toMatchObject({
      execution_found: true,
      execution_state: { status, error_code: errorCode, process_active: false },
      git_review: { ok: true }
    });
    expect(result.warnings).toContain(`CODEX_EXECUTION_${status.toUpperCase()}`);
    expect(result.next_tool_payloads).toBeDefined();
    expect(result.next_steps.join(" ")).toMatch(/recovery/i);
  });

  test("preserves legacy manual RESULT.md compatibility when execution.json is absent", async () => {
    const fixture = await createFixture();
    await writeResult(fixture, "completed");

    const result = await reviewService(fixture, () => false).review({ repo_id: "demo", run_id: RUN_ID });

    expect(result).toMatchObject({
      execution_found: false,
      result_found: true,
      codex_result: { status: "completed", summary: "completed review" },
      git_review: { ok: true }
    });
    expect(result.execution_state).toBeUndefined();
  });
});

type Fixture = { root: string; branch: string; head: string; paths: ReturnType<typeof codexRunPaths> };

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "codex-review-service-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, ".gitignore"), ".chatgpt/\n");
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["add", ".gitignore", "src/app.ts"]);
  await git(root, ["commit", "-m", "initial"]);
  await git(root, ["switch", "-c", "feat/review-test"]);
  const head = await git(root, ["rev-parse", "HEAD"]);
  const paths = codexRunPaths(RUN_ID);
  await mkdir(join(root, paths.runDir), { recursive: true });
  return { root, branch: "feat/review-test", head, paths };
}

function reviewService(fixture: Fixture, processAlive: (pid: number) => boolean) {
  return new CodexReviewService(
    new PathSandbox(fixture.root),
    new GitReviewService(fixture.root, new OperationsPolicy({
      enabled: true,
      git_stage_enabled: true,
      git_commit_enabled: true,
      cleanup_enabled: true
    })),
    processAlive
  );
}

function state(fixture: Fixture, status: CodexExecutionState["status"], overrides: Partial<CodexExecutionState> = {}): CodexExecutionState {
  return {
    schema_version: 1,
    status,
    repo_id: "demo",
    run_id: RUN_ID,
    prompt_path: fixture.paths.promptPath,
    result_path: fixture.paths.resultPath,
    execution_path: fixture.paths.executionPath,
    stdout_path: fixture.paths.stdoutPath,
    stderr_path: fixture.paths.stderrPath,
    start_branch: fixture.branch,
    start_head_sha: fixture.head,
    runner_pid: null,
    process_pid: null,
    started_at: null,
    updated_at: NOW,
    ended_at: null,
    timeout_ms: 60000,
    max_output_bytes: 64000,
    exit_code: null,
    timed_out: false,
    output_complete: false,
    output_truncated: false,
    error_code: null,
    diagnostic: null,
    end_branch: fixture.branch,
    end_head_sha: fixture.head,
    worktree_clean_before: true,
    worktree_clean_after: null,
    changed_paths: [],
    staged_paths: [],
    branch_ref_changes: [],
    run_artifact_violations: [],
    scope_violations: [],
    forbidden_path_changes: [],
    result_sha256: null,
    result_bytes: null,
    result_status: null,
    ...overrides
  };
}

async function writeExecution(fixture: Fixture, execution: CodexExecutionState): Promise<void> {
  await writeFile(join(fixture.root, fixture.paths.executionPath), `${JSON.stringify(execution, null, 2)}\n`);
}

async function writeResult(fixture: Fixture, status: "completed" | "blocked"): Promise<{ sha256: string; bytes: number }> {
  const content = `# CODEX_RESULT\n\nstatus: ${status}\nsummary: ${status} review\nchanged_files:\n- src/app.ts\ncommands_run:\ntests:\nacceptance_criteria:\nblockers:\nfollowups:\n`;
  await writeFile(join(fixture.root, fixture.paths.resultPath), content);
  return {
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    bytes: Buffer.byteLength(content, "utf8")
  };
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    env: { PATH: process.env.PATH ?? "" },
    windowsHide: true
  });
  return stdout.trim();
}
