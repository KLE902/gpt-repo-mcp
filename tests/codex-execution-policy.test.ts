import { describe, expect, test } from "vitest";
import { CodexStartInputSchema } from "../src/contracts/codex-task.contract.js";
import { OperationsPolicyConfigSchema } from "../src/config/schema.js";
import { PolicyExplainService } from "../src/services/policy-explain-service.js";
import { OperationsPolicy } from "../src/services/operations-policy.js";

describe("durable Codex execution policy", () => {
  test("is disabled by default with bounded server-owned runtime, output, and environment", () => {
    const parsed = OperationsPolicyConfigSchema.parse({});
    expect(parsed).toMatchObject({
      codex_task_run_enabled: false,
      codex_task_max_runtime_ms: 1_800_000,
      codex_task_max_output_bytes: 1_048_576,
      codex_task_inherit_env: []
    });
    expect(() => new OperationsPolicy({ enabled: true }).getCodexTaskRunPolicy()).toThrowError(expect.objectContaining({ code: "CODEX_TASK_RUN_DISABLED" }));
  });

  test("accepts bounded local opt-in and rejects invalid policy values", () => {
    const parsed = OperationsPolicyConfigSchema.parse({
      codex_task_run_enabled: true,
      codex_task_max_runtime_ms: 120_000,
      codex_task_max_output_bytes: 64_000,
      codex_task_inherit_env: ["LANG", "CUSTOM_HOME"]
    });
    expect(parsed.codex_task_run_enabled).toBe(true);
    expect(parsed.codex_task_inherit_env).toEqual(["LANG", "CUSTOM_HOME"]);
    expect(() => OperationsPolicyConfigSchema.parse({ codex_task_max_runtime_ms: 999 })).toThrow();
    expect(() => OperationsPolicyConfigSchema.parse({ codex_task_max_output_bytes: 1_048_577 })).toThrow();
    expect(() => OperationsPolicyConfigSchema.parse({ codex_task_inherit_env: ["INVALID-NAME"] })).toThrow();
  });

  test("caller contract exposes identity and stale-state guards but no execution controls", () => {
    const keys = Object.keys(CodexStartInputSchema.shape).sort();
    expect(keys).toEqual([
      "dry_run",
      "expected_branch",
      "expected_head_sha",
      "reason",
      "repo_id",
      "run_id"
    ]);
    expect(keys).not.toEqual(expect.arrayContaining([
      "prompt",
      "command",
      "args",
      "model",
      "reasoning_level",
      "sandbox",
      "timeout",
      "environment",
      "cwd",
      "verification_commands"
    ]));
  });

  test("policy explanation reports the dedicated execution opt-in and server-owned limits", () => {
    const result = new PolicyExplainService({
      repo_id: "demo",
      display_name: "Demo",
      root: "C:/demo",
      operations: {
        enabled: true,
        codex_task_run_enabled: true,
        codex_task_max_runtime_ms: 90_000,
        codex_task_max_output_bytes: 32_000,
        codex_task_inherit_env: ["LANG"]
      }
    }).explain({});

    expect(result.operations).toMatchObject({
      codex_task_run_enabled: true,
      codex_task_max_runtime_ms: 90_000,
      codex_task_max_output_bytes: 32_000,
      codex_task_inherit_env: ["LANG"]
    });
  });
});
