import { describe, expect, test } from "vitest";
import {
  AllowedScriptService,
  resolveAllowedScriptInvocation,
  type AllowedScriptProcessResult
} from "../src/services/allowed-script-service.js";
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

  test("resolves npm.cmd through the active npm CLI on Windows without a shell", () => {
    const script = policy().config.allowed_scripts.checks;
    const resolved = resolveAllowedScriptInvocation(
      script,
      { npm_execpath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" },
      "win32",
      "C:\\Program Files\\nodejs\\node.exe"
    );

    expect(resolved).toEqual({
      ...script,
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "run", "test"]
    });
  });

  test("fails closed when Windows npm.cmd has no active npm runtime", () => {
    const script = policy().config.allowed_scripts.checks;
    let thrown: unknown;
    try {
      resolveAllowedScriptInvocation(script, {}, "win32", "node.exe");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "SCRIPT_RUNTIME_UNAVAILABLE" });
  });

  test("executes a real npm.cmd allowlisted script on Windows", async () => {
    if (process.platform !== "win32") return;

    expect(process.env.npm_execpath).toBeTruthy();
    const runtimePolicy = new OperationsPolicy({
      enabled: true,
      script_run_enabled: true,
      allowed_scripts: {
        npmVersion: {
          command: "npm.cmd",
          args: ["--version"],
          timeout_ms: 30_000,
          max_output_bytes: 16_384,
          inherit_env: []
        }
      }
    });
    const service = new AllowedScriptService(process.cwd(), runtimePolicy, process.env, undefined, async () => HEAD);

    const output = await service.run({
      repo_id: "fixture",
      script_id: "npmVersion",
      expected_head_sha: HEAD,
      dry_run: false
    });

    expect(output).toMatchObject({ executed: true, succeeded: true, exit_code: 0, complete: true });
    expect(output.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
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

  test("enforces one UTF-8 byte budget across stdout and stderr", async () => {
    const boundedPolicy = new OperationsPolicy({
      enabled: true,
      script_run_enabled: true,
      allowed_scripts: {
        checks: {
          command: "npm.cmd",
          args: ["run", "test"],
          timeout_ms: 30_000,
          max_output_bytes: 9,
          inherit_env: []
        }
      }
    });
    const service = new AllowedScriptService("/repo", boundedPolicy, {}, async () => result({
      stdout: "éééé",
      stderr: "XYZ"
    }), async () => HEAD);

    const output = await service.run({ repo_id: "fixture", script_id: "checks", expected_head_sha: HEAD, dry_run: false });
    expect(Buffer.byteLength(output.stdout, "utf8") + Buffer.byteLength(output.stderr, "utf8")).toBeLessThanOrEqual(9);
    expect(output).toMatchObject({
      stdout: "éééé",
      stderr: "X",
      output_truncated: true,
      complete: false,
      succeeded: false,
      warnings: ["SCRIPT_OUTPUT_TRUNCATED"]
    });
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
