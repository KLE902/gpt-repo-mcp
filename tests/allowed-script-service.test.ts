import { describe, expect, test } from "vitest";
import { AllowedScriptService, type AllowedScriptProcessResult } from "../src/services/allowed-script-service.js";
import { OperationsPolicy } from "../src/services/operations-policy.js";

const HEAD = "a".repeat(40);

function result(overrides: Partial<AllowedScriptProcessResult> = {}): AllowedScriptProcessResult {
  return {
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
    timedOut: false,
    complete: true,
    truncated: false,
    ...overrides
  };
}

describe("AllowedScriptService", () => {
  test("is disabled unless both operations and script execution are enabled", async () => {
    const service = new AllowedScriptService("/repo", new OperationsPolicy(), {}, async () => result(), async () => HEAD);
    await expect(service.run({ repo_id: "fixture", script_id: "checks", expected_head_sha: HEAD, dry_run: true }))
      .rejects.toMatchObject({ code: "OPERATIONS_DISABLED" });
  });

  test("rejects script ids that are not configured", async () => {
    const service = new AllowedScriptService("/repo", new OperationsPolicy({ enabled: true, script_run_enabled: true, allowed_scripts: {} }), {}, async () => result(), async () => HEAD);
    await expect(service.run({ repo_id: "fixture", script_id: "missing", expected_head_sha: HEAD, dry_run: true }))
      .rejects.toMatchObject({ code: "SCRIPT_NOT_ALLOWED" });
  });

  test("dry run validates the configured id and HEAD without starting a process", async () => {
    let invoked = false;
    const service = new AllowedScriptService("/repo", policy(), {}, async () => {
      invoked = true;
      return result();
    }, async () => HEAD);

    const output = await service.run({ repo_id: "fixture", script_id: "checks", expected_head_sha: HEAD, dry_run: true });
    expect(invoked).toBe(false);
    expect(output).toMatchObject({ executed: false, succeeded: false, complete: true, warnings: [] });
  });

  test("passes only the server-configured command, arguments, and allowlisted environment", async () => {
    let captured: { command?: string; args?: string[]; env?: NodeJS.ProcessEnv } = {};
    const service = new AllowedScriptService("/repo", policy(), {
      PATH: "fixture-path",
      SAFE_FLAG: "allowed",
      UNLISTED_FLAG: "blocked"
    }, async (_root, script, env) => {
      captured = { command: script.command, args: script.args, env };
      return result({ stdout: "configured check passed\n" });
    }, async () => HEAD);

    const output = await service.run({ repo_id: "fixture", script_id: "checks", expected_head_sha: HEAD, dry_run: false });
    expect(captured.command).toBe("npm.cmd");
    expect(captured.args).toEqual(["run", "test"]);
    expect(captured.env).toMatchObject({ PATH: "fixture-path", SAFE_FLAG: "allowed" });
    expect(captured.env).not.toHaveProperty("UNLISTED_FLAG");
    expect(output).toMatchObject({ executed: true, succeeded: true, exit_code: 0, complete: true, stdout: "configured check passed\n" });
  });

  test("fails closed on timeout, truncation, or nonzero exit", async () => {
    for (const processResult of [
      result({ exitCode: null, timedOut: true, complete: false }),
      result({ truncated: true, complete: false }),
      result({ exitCode: 7 })
    ]) {
      const service = new AllowedScriptService("/repo", policy(), {}, async () => processResult, async () => HEAD);
      const output = await service.run({ repo_id: "fixture", script_id: "checks", expected_head_sha: HEAD, dry_run: false });
      expect(output.succeeded).toBe(false);
      expect(output.warnings.length).toBeGreaterThan(0);
    }
  });

  test("rejects stale HEAD before process execution", async () => {
    let invoked = false;
    const service = new AllowedScriptService("/repo", policy(), {}, async () => {
      invoked = true;
      return result();
    }, async () => "b".repeat(40));
    await expect(service.run({ repo_id: "fixture", script_id: "checks", expected_head_sha: HEAD, dry_run: false }))
      .rejects.toMatchObject({ code: "GIT_HEAD_MISMATCH" });
    expect(invoked).toBe(false);
  });
});

function policy(): OperationsPolicy {
  return new OperationsPolicy({
    enabled: true,
    script_run_enabled: true,
    allowed_scripts: {
      checks: {
        command: "npm.cmd",
        args: ["run", "test"],
        timeout_ms: 30_000,
        max_output_bytes: 16_384,
        inherit_env: ["SAFE_FLAG"]
      }
    }
  });
}
