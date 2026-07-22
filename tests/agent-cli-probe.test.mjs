import { describe, expect, test } from "vitest";
import {
  buildClaudeEnvironment,
  buildProbeInvocation,
  claudeNpmEntryCandidates,
  detectCapabilities,
  knownWindowsCliCandidates,
  probeAgentCli,
  resolveExecutableInvocation,
  resolveGlobalNpmClaudeEntry,
  selectCliCandidate,
  validateProbeOutput
} from "../scripts/agent-cli-probe.mjs";

const HEAD = "a".repeat(40);

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

function queuedRunner(results) {
  const queue = [...results];
  const calls = [];
  return {
    calls,
    run: async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input });
      if (queue.length === 0) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      const next = queue.shift();
      return typeof next === "function" ? next(command, args, options) : next;
    }
  };
}

describe("agent-cli-probe", () => {
  test("detects and builds the required Codex read-only invocation", () => {
    const capabilities = detectCapabilities("codex", "exec --json --sandbox -C, --cd --output-schema --output-last-message");
    expect(capabilities).toMatchObject({ exec: true, json: true, sandbox: true, cd: true, cd_flag: "--cd" });
    expect(buildProbeInvocation("codex", capabilities, "C:\\Premium-Komga-Reader")).toEqual({
      args: ["exec", "--json", "--sandbox", "read-only", "--cd", "C:\\Premium-Komga-Reader", "-"],
      redactedArgs: ["exec", "--json", "--sandbox", "read-only", "--cd", "<repo-root>", "-"]
    });

    const shortOnly = detectCapabilities("codex", "exec --json --sandbox -C");
    expect(buildProbeInvocation("codex", shortOnly, "/repo").args).toEqual([
      "exec", "--json", "--sandbox", "read-only", "-C", "/repo", "-"
    ]);
  });

  test("detects and builds the bounded Claude read-only invocation", () => {
    const capabilities = detectCapabilities(
      "claude",
      "-p, --print --output-format --max-turns --permission-mode --disallowedTools --json-schema --no-session-persistence"
    );
    expect(capabilities).toMatchObject({
      print: true,
      output_format: true,
      max_turns: true,
      permission_mode: true,
      disallowed_tools: true,
      json_schema: true,
      no_session_persistence: true
    });
    expect(buildProbeInvocation("claude", capabilities, "/repo").args).toEqual([
      "-p",
      "--output-format", "json",
      "--max-turns", "1",
      "--permission-mode", "plan",
      "--disallowedTools", "Bash,Edit,Write,NotebookEdit",
      "--no-session-persistence"
    ]);
  });

  test("enumerates bounded Windows fallback locations without scanning the filesystem", () => {
    expect(knownWindowsCliCandidates("claude", "win32", {
      USERPROFILE: "C:\\Users\\fixture",
      APPDATA: "C:\\Users\\fixture\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local"
    })).toEqual([
      "C:\\Users\\fixture\\.local\\bin\\claude.exe",
      "C:\\Users\\fixture\\.claude\\local\\claude.exe",
      "C:\\Users\\fixture\\AppData\\Roaming\\npm\\claude.cmd",
      "C:\\Users\\fixture\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
      "C:\\Users\\fixture\\AppData\\Local\\Programs\\claude\\claude.exe"
    ]);
  });

  test("sets a verified unquoted Git Bash path for native Windows Claude", () => {
    const result = buildClaudeEnvironment(
      { CLAUDE_CODE_GIT_BASH_PATH: "\"C:\\Program Files\\Git\\bin\\bash.exe\"", SAFE: "yes" },
      "win32",
      (path) => path === "C:\\Program Files\\Git\\bin\\bash.exe"
    );
    expect(result).toMatchObject({
      SAFE: "yes",
      CLAUDE_CODE_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe"
    });
  });

  test("fails closed when native Windows Claude has no Git Bash", () => {
    expect(() => buildClaudeEnvironment({}, "win32", () => false))
      .toThrow(/requires a verified Git Bash/);
  });

  test("prefers the npm platform binary before the JavaScript wrapper", () => {
    expect(claudeNpmEntryCandidates("D:\\npm-global\\node_modules", "x64")).toEqual([
      "D:\\npm-global\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe",
      "D:\\npm-global\\node_modules\\@anthropic-ai\\claude-code\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe",
      "D:\\npm-global\\node_modules\\@anthropic-ai\\claude-code\\claude.exe",
      "D:\\npm-global\\node_modules\\@anthropic-ai\\claude-code\\cli.js"
    ]);
  });

  test("resolves the installed Claude package from npm's exact global root", async () => {
    const npmCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
    const globalRoot = "D:\\npm-global\\node_modules";
    const entry = `${globalRoot}\\@anthropic-ai\\claude-code-win32-x64\\claude.exe`;
    const calls = [];
    const result = await resolveGlobalNpmClaudeEntry(
      async (command, args) => {
        calls.push({ command, args });
        return commandResult(`${globalRoot}\n`);
      },
      "win32",
      {},
      (path) => path === npmCli || path === entry,
      "C:\\Program Files\\nodejs\\node.exe"
    );
    expect(result).toBe(entry);
    expect(calls).toEqual([{
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [npmCli, "root", "-g"]
    }]);
  });

  test("prefers the npm command shim for Claude and native executables for other providers", () => {
    const candidates = [
      "C:\\Users\\fixture\\.local\\bin\\claude.exe",
      "C:\\Users\\fixture\\AppData\\Roaming\\npm\\claude.cmd",
      "C:\\Users\\fixture\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"
    ];
    expect(selectCliCandidate("claude", candidates)).toBe(candidates[2]);
    expect(selectCliCandidate("codex", candidates)).toBe(candidates[0]);
  });

  test("runs the Claude package entry directly through Node", () => {
    const entry = "C:\\Users\\fixture\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js";
    expect(resolveExecutableInvocation(
      entry,
      ["--version"],
      "win32",
      () => true,
      "C:\\Program Files\\nodejs\\node.exe"
    )).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [entry, "--version"]
    });
  });

  test("runs the verified npm Claude entry through Node without cmd.exe quoting", () => {
    const executable = "C:\\Users\\fixture\\AppData\\Roaming\\npm\\claude.cmd";
    expect(resolveExecutableInvocation(
      executable,
      ["--version"],
      "win32",
      (path) => path.endsWith("\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"),
      "C:\\Program Files\\nodejs\\node.exe"
    )).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [
        "C:\\Users\\fixture\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
        "--version"
      ]
    });
  });

  test("runs a complete Codex probe and verifies unchanged Git state", async () => {
    const help = "exec --json --sandbox -C, --cd --output-schema --output-last-message";
    const runner = queuedRunner([
      commandResult(`${HEAD}\n`),
      commandResult(""),
      commandResult("codex-cli 1.2.3\n"),
      commandResult(help),
      commandResult(help),
      commandResult(`${JSON.stringify({ type: "item.completed", item: { text: "PKR_CODEX_PROBE_OK" } })}\n`),
      commandResult(`${HEAD}\n`),
      commandResult("")
    ]);

    const result = await probeAgentCli({
      provider: "codex",
      cwd: "C:\\Premium-Komga-Reader",
      runCommand: runner.run,
      resolveCli: async () => "C:\\Users\\fixture\\codex.exe"
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "codex",
      version: "codex-cli 1.2.3",
      authentication: "verified_by_non_interactive_probe",
      git: { head_sha: HEAD, clean_before: true, clean_after: true },
      output: { complete: true, truncated: false, marker_verified: true }
    });
    expect(runner.calls[5].input).toContain("PKR_CODEX_PROBE_OK");
  });

  test("fails closed before launching an agent when the worktree is dirty", async () => {
    const runner = queuedRunner([
      commandResult(`${HEAD}\n`),
      commandResult(" M src/server.ts\n")
    ]);

    await expect(probeAgentCli({
      provider: "claude",
      cwd: "/repo",
      runCommand: runner.run,
      resolveCli: async () => "/usr/bin/claude"
    })).rejects.toMatchObject({ code: "WORKTREE_NOT_CLEAN" });
    expect(runner.calls).toHaveLength(2);
  });

  test("verifies hidden documented Claude flags through execution rather than help text", () => {
    const capabilities = detectCapabilities(
      "claude",
      "-p --output-format --permission-mode --disallowedTools"
    );
    expect(capabilities.max_turns).toBe(false);
    expect(() => buildProbeInvocation("claude", capabilities, "/repo")).not.toThrow();
    expect(buildProbeInvocation("claude", capabilities, "/repo").args).toContain("--max-turns");
  });

  test("fails closed when required local CLI capabilities are absent", () => {
    const capabilities = detectCapabilities("claude", "-p --output-format --max-turns");
    expect(() => buildProbeInvocation("claude", capabilities, "/repo"))
      .toThrow(/missing required non-interactive capabilities/);
  });

  test("preserves bounded structured stdout diagnostics for nonzero provider exits", async () => {
    const help = "-p --output-format --permission-mode --disallowedTools";
    const runner = queuedRunner([
      commandResult(`${HEAD}\n`),
      commandResult(""),
      commandResult("2.1.89\n"),
      commandResult(help),
      commandResult('{"type":"result","is_error":true,"result":"probe failed"}\n', { exitCode: 1 })
    ]);

    await expect(probeAgentCli({
      provider: "claude",
      cwd: "/repo",
      platform: "linux",
      runCommand: runner.run,
      resolveCli: async () => "/usr/bin/claude"
    })).rejects.toMatchObject({
      code: "CLI_PROBE_FAILED",
      details: { stdout: expect.stringContaining("probe failed") }
    });
  });

  test("validates structured provider output and rejects missing markers", () => {
    expect(() => validateProbeOutput("claude", JSON.stringify({ type: "result", is_error: false, result: "PKR_CLAUDE_PROBE_OK" })))
      .not.toThrow();
    expect(() => validateProbeOutput("codex", `${JSON.stringify({ type: "item.completed", text: "PKR_CODEX_PROBE_OK" })}\n`))
      .not.toThrow();
    expect(() => validateProbeOutput("claude", JSON.stringify({ type: "result", is_error: false, result: "wrong" })))
      .toThrow(/marker/);
    expect(() => validateProbeOutput("codex", "not-json\n"))
      .toThrow(/non-JSONL/);
  });
});
