import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runAto001ClaudeRunner } from "../scripts/ato-001-claude-runner.mjs";

const TASK = "Challenge the framing first. Then recommend the smallest truthful product and UI contract for showing owning-library provenance only when all-libraries Global Search returns visually ambiguous duplicate-looking results. Preserve source identity, current navigation, accessibility, cover-first quietness, and existing result grouping. Identify assumptions, evidence gaps, and what would require owner judgment. Do not edit files and do not expand the task into cross-source deduplication or a production implementation plan.";

describe("ATO-001 Claude runner", () => {
  test("uses one fixed read-only structured invocation and validates the semantic result", async () => {
    const fixture = await createFixture();
    const calls = [];
    const semantic = validSemanticResult();
    const state = await runAto001ClaudeRunner(fixture, {
      now: clock(),
      environment: {},
      verifyRepository: async () => {},
      resolveCli: async () => "claude",
      runCommand: async (_command, args, options) => {
        calls.push({ args, options });
        if (args[0] === "--version") return command("2.1.89\n");
        if (args[0] === "--help") return command("-p --output-format --max-turns --permission-mode --tools --disallowedTools --json-schema --no-session-persistence\n");
        if (args[0] === "auth") return command('{"loggedIn":true}\n');
        return command(JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: semantic,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: { input_tokens: 120, output_tokens: 80 }
        }));
      }
    });

    expect(state).toMatchObject({
      status: "completed",
      terminal: true,
      valid_for_pkr_intake: true,
      diagnostic_only: false,
      output_complete: true,
      output_truncated: false,
      provider_turns: 1,
      provider_cost_usd: 0.01,
      boundary: { complete_output: true, result_schema: true }
    });
    const invocation = calls.find(({ args }) => args[0] === "-p");
    expect(invocation.args).toEqual(expect.arrayContaining([
      "--output-format", "json",
      "--max-turns", "1",
      "--permission-mode", "plan",
      "--tools", "Read,Glob,Grep",
      "--disallowedTools", "Bash,Edit,Write,NotebookEdit",
      "--json-schema",
      "--no-session-persistence"
    ]));
    expect(invocation.options).toMatchObject({
      cwd: fixture.repoRoot,
      input: TASK,
      timeoutMs: 600_000,
      maxOutputBytes: 262_144
    });
    expect(JSON.parse(await readFile(join(fixture.artifactDirectory, "validated-result.json"), "utf8"))).toEqual({
      schema_version: 1,
      valid_for_pkr_intake: true,
      result: semantic
    });
  });

  test.each([
    ["timeout", { timedOut: true, complete: false }, "timed_out", "ATO001_PROVIDER_TIMEOUT"],
    ["truncation", { truncated: true, complete: false }, "truncated", "ATO001_OUTPUT_INCOMPLETE"],
    ["invalid semantic result", { stdout: '{"type":"result","subtype":"success","structured_output":{"unexpected":true}}' }, "output_contract_failed", "ATO001_RESULT_SCHEMA_INVALID"]
  ])("fails closed for %s and retains diagnostic artifacts", async (_label, providerOverride, expectedStatus, expectedCode) => {
    const fixture = await createFixture();
    const state = await runAto001ClaudeRunner(fixture, {
      now: clock(),
      environment: {},
      verifyRepository: async () => {},
      resolveCli: async () => "claude",
      runCommand: async (_command, args) => {
        if (args[0] === "--version") return command("2.1.89\n");
        if (args[0] === "--help") return command("-p --output-format --max-turns --permission-mode --tools --disallowedTools --json-schema\n");
        if (args[0] === "auth") return command('{"authenticated":true}\n');
        return command(JSON.stringify({ type: "result", subtype: "success", structured_output: validSemanticResult() }), providerOverride);
      }
    });
    expect(state).toMatchObject({
      status: expectedStatus,
      terminal: true,
      valid_for_pkr_intake: false,
      diagnostic_only: true,
      terminal_classification: expectedCode
    });
    expect(JSON.parse(await readFile(join(fixture.artifactDirectory, "validated-result.json"), "utf8"))).toMatchObject({
      valid_for_pkr_intake: false,
      invalidation_reason: expectedCode,
      result: null
    });
  });
});

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "ato-runner-repo-"));
  const artifactDirectory = join(repoRoot, ".chatgpt", "ato-001-claude-spike", "ato-001-pkr-004");
  await mkdir(artifactDirectory, { recursive: true });
  const taskPath = join(artifactDirectory, "task.txt");
  await writeFile(taskPath, TASK);
  await writeFile(join(artifactDirectory, "execution.json"), `${JSON.stringify(startingState(), null, 2)}\n`);
  await writeFile(join(artifactDirectory, "metadata.json"), `${JSON.stringify({ invocation: { version: "2.1.89" } }, null, 2)}\n`);
  return { repoRoot, artifactDirectory, taskPath };
}

function startingState() {
  return {
    schema_version: 1,
    run_id: "ato-001-pkr-004",
    status: "starting",
    terminal: false,
    valid_for_pkr_intake: false,
    diagnostic_only: false,
    started_at: null,
    updated_at: "2026-07-24T10:00:00.000Z",
    ended_at: null,
    runner_pid: null,
    process_pid: null,
    exit_code: null,
    provider_runtime_ms: null,
    timed_out: false,
    output_complete: false,
    output_truncated: false,
    terminal_classification: null,
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
      complete_output: false,
      result_schema: false
    },
    provider_usage: null,
    provider_cost_usd: null,
    provider_turns: null,
    result_sha256: null,
    process_tree_termination_outcome: "not_required"
  };
}

function validSemanticResult() {
  return {
    framing_challenge: "Ambiguity, not duplication itself, is the trigger.",
    recommended_product_contract: "Show provenance only for ambiguous duplicate-looking results.",
    recommended_ui_contract: "Use a quiet accessible library label subordinate to the cover-first result.",
    preservation_notes: ["Keep source identity and grouping unchanged."],
    assumptions: ["Owning-library identity is already available per result."],
    evidence_gaps: ["The ambiguity heuristic has not been owner-ratified."],
    owner_judgments: ["Approve the exact ambiguity threshold."],
    exclusions_confirmed: {
      no_file_edits: true,
      no_cross_source_deduplication: true,
      no_production_implementation_plan: true
    }
  };
}

function command(stdout = "", overrides = {}) {
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

function clock() {
  let value = Date.parse("2026-07-24T10:00:00.000Z");
  return () => {
    const date = new Date(value);
    value += 100;
    return date;
  };
}
