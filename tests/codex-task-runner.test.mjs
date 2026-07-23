/* global Buffer, process */
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { executeCommand } from "../scripts/agent-cli-probe.mjs";
import { runCodexTaskRunner } from "../scripts/codex-task-runner.mjs";

const RUN_ID = "2026-07-23T130000Z-runner-test";
const NOW = new Date("2026-07-23T13:00:00.000Z");

describe("codex-task-runner", () => {
  test("uses the fixed non-interactive invocation and completes an allowed change", async () => {
    const fixture = await createFixture();
    const capture = {};
    const result = await run(fixture, {
      capture,
      behavior: async ({ stdout }) => {
        await writeFile(join(fixture.root, "src", "app.ts"), "export const app = 'changed';\n");
        await writeResult(fixture, "completed");
        stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
        return 0;
      }
    });

    expect(result).toMatchObject({
      status: "completed",
      exit_code: 0,
      output_complete: true,
      output_truncated: false,
      end_branch: "feat/runner-test",
      end_head_sha: fixture.head,
      changed_paths: ["src/app.ts"],
      scope_violations: [],
      forbidden_path_changes: [],
      result_status: "completed"
    });
    expect(capture).toMatchObject({
      command: "codex",
      args: ["exec", "--json", "--sandbox", "workspace-write", "--cd", fixture.root, "-"],
      options: {
        cwd: fixture.root,
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      }
    });
    expect(capture.stdin).toBe(fixture.prompt);
    const resultBuffer = await readFile(fixture.paths.result);
    expect(result.result_sha256).toBe(createHash("sha256").update(resultBuffer).digest("hex"));
    expect(result.result_bytes).toBe(resultBuffer.length);
  });

  test("accepts a blocked RESULT as a terminal success when contracts remain intact", async () => {
    const fixture = await createFixture();
    const result = await run(fixture, {
      behavior: async ({ stdout }) => {
        await writeResult(fixture, "blocked");
        stdout.write(`${JSON.stringify({ type: "message", text: "blocked" })}\n`);
        return 0;
      }
    });
    expect(result).toMatchObject({ status: "blocked", result_status: "blocked", exit_code: 0 });
  });

  test.each([
    ["missing", undefined, "CODEX_RESULT_MISSING"],
    ["malformed", "# CODEX_RESULT\nstatus: uncertain\n", "CODEX_RESULT_MALFORMED"]
  ])("fails when RESULT.md is %s", async (_label, resultText, errorCode) => {
    const fixture = await createFixture();
    const result = await run(fixture, {
      behavior: async ({ stdout }) => {
        if (resultText !== undefined) await writeFile(fixture.paths.result, resultText);
        stdout.write(`${JSON.stringify({ type: "message", text: "finished" })}\n`);
        return 0;
      }
    });
    expect(result).toMatchObject({ status: "failed", error_code: errorCode, output_complete: true });
  });

  test("fails when the final structured-output fragment is malformed without a trailing newline", async () => {
    const fixture = await createFixture();
    const result = await run(fixture, {
      behavior: async ({ stdout }) => {
        await writeResult(fixture, "completed");
        stdout.write("not-json");
        return 0;
      }
    });

    expect(result).toMatchObject({ status: "failed", error_code: "CODEX_OUTPUT_INVALID", output_complete: true });
  });

  test("revalidates unsafe allowed-path scope inside the detached runner", async () => {
    const fixture = await createFixture();
    const manifest = JSON.parse(await readFile(fixture.paths.manifest, "utf8"));
    manifest.allowed_paths = ["**"];
    await writeFile(fixture.paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await run(fixture, { behavior: async () => 0 });

    expect(result).toMatchObject({ status: "failed", error_code: "CODEX_TASK_INVALID" });
  });

  test("releases the single-writer lock without replacing an invalid starting state", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.paths.execution, "{}\n");

    await expect(run(fixture, { behavior: async () => 0 })).rejects.toMatchObject({ code: "CODEX_EXECUTION_INVALID" });
    await expect(access(fixture.paths.lock)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(fixture.paths.execution, "utf8")).resolves.toBe("{}\n");
  });

  test("fails on a nonzero Codex exit and preserves bounded diagnostics", async () => {
    const fixture = await createFixture();
    const result = await run(fixture, {
      behavior: async ({ stderr }) => {
        stderr.write("bounded failure\n");
        return 7;
      }
    });
    expect(result).toMatchObject({ status: "failed", exit_code: 7, error_code: "CODEX_PROCESS_NONZERO_EXIT" });
    await expect(readFile(fixture.paths.stderr, "utf8")).resolves.toContain("bounded failure");
  });

  test("fails and preserves evidence when Codex changes forbidden or out-of-scope paths", async () => {
    const fixture = await createFixture();
    const result = await run(fixture, {
      behavior: async ({ stdout }) => {
        await writeFile(join(fixture.root, "docs", "blocked.md"), "changed\n");
        await writeResult(fixture, "completed");
        stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
        return 0;
      }
    });
    expect(result).toMatchObject({
      status: "failed",
      error_code: "CODEX_POSTFLIGHT_CONTRACT_VIOLATION",
      scope_violations: ["docs/blocked.md"],
      forbidden_path_changes: ["docs/blocked.md"]
    });
    await expect(readFile(join(fixture.root, "docs", "blocked.md"), "utf8")).resolves.toBe("changed\n");
  });

  test("fails without recovery when branch or HEAD changes", async () => {
    const branchFixture = await createFixture();
    const branchResult = await run(branchFixture, {
      behavior: async ({ stdout }) => {
        await git(branchFixture.root, ["switch", "-c", "feat/rogue"]);
        await writeResult(branchFixture, "completed");
        stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
        return 0;
      }
    });
    expect(branchResult).toMatchObject({ status: "failed", end_branch: "feat/rogue", error_code: "CODEX_POSTFLIGHT_CONTRACT_VIOLATION" });

    const headFixture = await createFixture();
    const headResult = await run(headFixture, {
      behavior: async ({ stdout }) => {
        await writeFile(join(headFixture.root, "src", "app.ts"), "export const app = 'committed';\n");
        await git(headFixture.root, ["add", "src/app.ts"]);
        await git(headFixture.root, ["commit", "-m", "unauthorized commit"]);
        await writeResult(headFixture, "completed");
        stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
        return 0;
      }
    });
    expect(headResult.status).toBe("failed");
    expect(headResult.end_head_sha).not.toBe(headFixture.head);
    expect(headResult.error_code).toBe("CODEX_POSTFLIGHT_CONTRACT_VIOLATION");
  });

  test("fails when Codex stages an otherwise allowed path", async () => {
    const fixture = await createFixture();
    const result = await run(fixture, {
      behavior: async ({ stdout }) => {
        await writeFile(join(fixture.root, "src", "app.ts"), "export const app = 'staged';\n");
        await git(fixture.root, ["add", "src/app.ts"]);
        await writeResult(fixture, "completed");
        stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
        return 0;
      }
    });

    expect(result).toMatchObject({
      status: "failed",
      error_code: "CODEX_POSTFLIGHT_CONTRACT_VIOLATION",
      staged_paths: ["src/app.ts"]
    });
  });

  test("fails when Codex creates a local branch ref even if it remains on the start branch", async () => {
    const fixture = await createFixture();
    const result = await run(fixture, {
      behavior: async ({ stdout }) => {
        await git(fixture.root, ["branch", "feat/rogue"]);
        await writeResult(fixture, "completed");
        stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
        return 0;
      }
    });

    expect(result).toMatchObject({
      status: "failed",
      end_branch: "feat/runner-test",
      end_head_sha: fixture.head,
      branch_ref_changes: ["refs/heads/feat/rogue:created"],
      error_code: "CODEX_POSTFLIGHT_CONTRACT_VIOLATION"
    });
  });

  test.each([
    ["prompt", async (fixture) => writeFile(fixture.paths.prompt, "tampered prompt\n"), "PROMPT.md:modified"],
    ["manifest", async (fixture) => writeFile(fixture.paths.manifest, "{}\n"), "run.json:modified"],
    ["execution", async (fixture) => writeFile(fixture.paths.execution, "{}\n"), "execution.json:modified"],
    ["unexpected artifact", async (fixture) => writeFile(join(fixture.paths.runDir, "extra.tmp"), "unexpected\n"), "extra.tmp:unexpected"]
  ])("fails when Codex changes protected current-run %s", async (_label, mutate, violation) => {
    const fixture = await createFixture();
    const result = await run(fixture, {
      behavior: async ({ stdout }) => {
        await mutate(fixture);
        await writeResult(fixture, "completed");
        stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
        return 0;
      }
    });

    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("CODEX_POSTFLIGHT_CONTRACT_VIOLATION");
    expect(result.run_artifact_violations).toContain(violation);
  });

  test("fails when another run gains empty-directory structure", async () => {
    const fixture = await createFixture();
    const result = await run(fixture, {
      behavior: async ({ stdout }) => {
        await mkdir(join(fixture.root, ".chatgpt", "codex-runs", "other-run", "empty"), { recursive: true });
        await writeResult(fixture, "completed");
        stdout.write(`${JSON.stringify({ type: "message", text: "done" })}\n`);
        return 0;
      }
    });

    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("CODEX_POSTFLIGHT_CONTRACT_VIOLATION");
    expect(result.scope_violations).toContain(".chatgpt/codex-runs/other-run/");
    expect(result.scope_violations).toContain(".chatgpt/codex-runs/other-run/empty/");
  });

  test("terminates the process tree and records truncation when output exceeds the server limit", async () => {
    const fixture = await createFixture();
    let terminated = false;
    const result = await run(fixture, {
      maxOutputBytes: 1024,
      behavior: async ({ stdout }) => {
        await writeResult(fixture, "completed");
        stdout.write(`${JSON.stringify({ type: "message", text: "x".repeat(2000) })}\n`);
        return 0;
      },
      terminateTree: (child) => {
        terminated = true;
        child.finish(0);
      }
    });
    expect(terminated).toBe(true);
    expect(result).toMatchObject({ status: "failed", error_code: "CODEX_OUTPUT_TRUNCATED", output_truncated: true, output_complete: false });
    expect(Buffer.byteLength(await readFile(fixture.paths.stdout, "utf8"))).toBeLessThanOrEqual(1024);
  });

  test("terminates the process tree and records timed_out without retry", async () => {
    const fixture = await createFixture();
    let terminations = 0;
    const result = await run(fixture, {
      timeoutMs: 1000,
      behavior: async () => new Promise(() => {}),
      terminateTree: (child) => {
        terminations += 1;
        child.finish(null);
      }
    });
    expect(terminations).toBe(1);
    expect(result).toMatchObject({ status: "timed_out", error_code: "CODEX_PROCESS_TIMED_OUT", timed_out: true, output_complete: false });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-task-runner-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, ".gitignore"), ".chatgpt/\n");
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await writeFile(join(root, "docs", "blocked.md"), "original\n");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["add", ".gitignore", "src/app.ts", "docs/blocked.md"]);
  await git(root, ["commit", "-m", "initial"]);
  await git(root, ["switch", "-c", "feat/runner-test"]);
  const head = await git(root, ["rev-parse", "HEAD"]);
  const runDir = join(root, ".chatgpt", "codex-runs", RUN_ID);
  await mkdir(runDir, { recursive: true });
  const prompt = "Update only the allowed source path and write RESULT.md.\n";
  const paths = {
    runDir,
    prompt: join(runDir, "PROMPT.md"),
    result: join(runDir, "RESULT.md"),
    manifest: join(runDir, "run.json"),
    execution: join(runDir, "execution.json"),
    stdout: join(runDir, "stdout.jsonl"),
    stderr: join(runDir, "stderr.log"),
    lock: join(root, ".chatgpt", "codex-runs", ".active-codex.lock")
  };
  await writeFile(paths.prompt, prompt);
  await writeFile(paths.manifest, `${JSON.stringify({
    schema_version: 2,
    repo_id: "demo",
    run_id: RUN_ID,
    title: "Runner test",
    objective: "Update the allowed source path.",
    prompt_path: `.chatgpt/codex-runs/${RUN_ID}/PROMPT.md`,
    result_path: `.chatgpt/codex-runs/${RUN_ID}/RESULT.md`,
    prompt_sha256: createHash("sha256").update(prompt).digest("hex"),
    inspect_first: [],
    allowed_paths: ["src/**"],
    forbidden_paths: ["docs/**"],
    verification_commands: [],
    created_at: "2026-07-23T130000Z"
  }, null, 2)}\n`);
  await writeFile(paths.execution, `${JSON.stringify(startingState(head), null, 2)}\n`);
  await writeFile(paths.lock, `${JSON.stringify({ schema_version: 1, repo_id: "demo", run_id: RUN_ID, pid: process.pid, created_at: NOW.toISOString() }, null, 2)}\n`);
  return { root, head, prompt, paths };
}

function startingState(head) {
  return {
    schema_version: 1,
    status: "starting",
    repo_id: "demo",
    run_id: RUN_ID,
    prompt_path: `.chatgpt/codex-runs/${RUN_ID}/PROMPT.md`,
    result_path: `.chatgpt/codex-runs/${RUN_ID}/RESULT.md`,
    execution_path: `.chatgpt/codex-runs/${RUN_ID}/execution.json`,
    stdout_path: `.chatgpt/codex-runs/${RUN_ID}/stdout.jsonl`,
    stderr_path: `.chatgpt/codex-runs/${RUN_ID}/stderr.log`,
    start_branch: "feat/runner-test",
    start_head_sha: head,
    runner_pid: null,
    process_pid: null,
    started_at: null,
    updated_at: NOW.toISOString(),
    ended_at: null,
    timeout_ms: 60000,
    max_output_bytes: 64000,
    exit_code: null,
    timed_out: false,
    output_complete: false,
    output_truncated: false,
    error_code: null,
    diagnostic: null,
    end_branch: null,
    end_head_sha: null,
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
    result_status: null
  };
}

async function run(fixture, options) {
  const capture = options.capture ?? {};
  return runCodexTaskRunner({
    repoRoot: fixture.root,
    repoId: "demo",
    runId: RUN_ID,
    timeoutMs: options.timeoutMs ?? 60000,
    maxOutputBytes: options.maxOutputBytes ?? 64000
  }, {
    now: () => NOW,
    resolveCli: async () => "codex",
    runCommand: async (command, args, commandOptions) => {
      if (command === "git") return executeCommand(command, args, commandOptions);
      if (args[0] === "--version") return commandResult("codex 1.0.0\n");
      return commandResult("exec --json --sandbox --cd\n");
    },
    spawnProcess: (command, args, spawnOptions) => {
      capture.command = command;
      capture.args = args;
      capture.options = spawnOptions;
      const child = fakeChild(async (streams) => {
        capture.stdin = streams.stdinText;
        return options.behavior(streams);
      });
      capture.child = child;
      return child;
    },
    terminateTree: options.terminateTree ?? ((child) => child.finish(null))
  });
}

function fakeChild(behavior) {
  const child = new EventEmitter();
  child.pid = 31001;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.closed = false;
  child.finish = (code) => {
    if (child.closed) return;
    child.closed = true;
    child.emit("close", code);
  };
  let stdinText = "";
  child.stdin.on("data", (chunk) => { stdinText += String(chunk); });
  child.stdin.on("finish", async () => {
    try {
      const code = await behavior({ stdinText, stdout: child.stdout, stderr: child.stderr, child });
      child.finish(code);
    } catch (error) {
      child.emit("error", error);
    }
  });
  return child;
}

function commandResult(stdout = "", overrides = {}) {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
    timedOut: false,
    complete: true,
    truncated: false,
    ...overrides
  };
}

async function writeResult(fixture, status) {
  await writeFile(fixture.paths.result, `# CODEX_RESULT\n\nstatus: ${status}\nsummary: runner test\nchanged_files:\ncommands_run:\ntests:\nacceptance_criteria:\nblockers:\nfollowups:\n`);
}

async function git(root, args) {
  const result = await executeCommand("git", args, {
    cwd: root,
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs: 30000,
    maxOutputBytes: 1048576
  });
  if (result.exitCode !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}
