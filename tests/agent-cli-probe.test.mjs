import { describe, expect, test } from "vitest";
import {
  buildProbeInvocation,
  detectCapabilities,
  knownWindowsCliCandidates,
  probeAgentCli,
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
      "C:\\Users\\fixture\\AppData\\Local\\Programs\\claude\\claude.exe"
    ]);
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

  test("fails closed when required local CLI capabilities are absent", () => {
    const capabilities = detectCapabilities("claude", "-p --output-format --max-turns");
    expect(() => buildProbeInvocation("claude", capabilities, "/repo"))
      .toThrow(/missing required non-interactive capabilities/);
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
