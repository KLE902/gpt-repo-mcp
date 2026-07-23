import { describe, expect, test } from "vitest";
import {
  createCodexExecutionBoundaryTracker,
  detectSandboxFailureText
} from "../scripts/codex-execution-boundary.mjs";

describe("Codex execution boundary classification", () => {
  test("accepts a changed run only after verified bootstrap and a successful built-in operation", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeEvent(commandCompleted("powershell -File bounded.ps1"));

    expect(tracker.finalize({ changedPaths: ["src/app.ts"], resultPath: "RESULT.md" })).toMatchObject({
      sandbox_bootstrap_verified: true,
      sandbox_failure_detected: false,
      sandboxed_operation_observed: true,
      execution_boundary_verified: true,
      fallback_tool_violations: []
    });
  });

  test("accepts a successful built-in file_change as positive provenance", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeEvent({ type: "item.completed", item: { type: "file_change", status: "completed" } });

    expect(tracker.finalize({ changedPaths: ["src/app.ts"] }).execution_boundary_verified).toBe(true);
  });

  test.each([
    ["orchestrator_helper_launch_failed", "orchestrator_helper_launch_failed"],
    ["missing helper", "helper=codex-windows-sandbox-setup.exe error=program not found"],
    ["spawn failure", "failed to spawn codex-windows-sandbox-setup.exe"],
    ["windows sandbox failure", "windows sandbox failed while preparing workspace"],
    ["setup refresh failure", "setup refresh failed before command execution"]
  ])("detects %s from bounded diagnostic text", (_label, diagnostic) => {
    expect(detectSandboxFailureText(diagnostic)).toBeTruthy();
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeStderr(diagnostic);
    expect(tracker.finalize()).toMatchObject({
      sandbox_failure_detected: true,
      execution_boundary_verified: false
    });
  });

  test("prefers a structured Codex sandbox error code", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeEvent({
      type: "error",
      error: {
        code: "orchestrator_helper_launch_failed",
        message: "helper launch failed"
      }
    });

    expect(tracker.finalize()).toMatchObject({
      sandbox_failure_detected: true,
      sandbox_failure_code: "orchestrator_helper_launch_failed",
      execution_boundary_verified: false
    });
  });

  test("flags Node REPL file operations as a control-boundary violation", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeEvent(mcpCall("node_repl", "run", "require('fs').writeFileSync('src/app.ts', 'x')"));

    expect(tracker.finalize({ changedPaths: ["src/app.ts"] })).toMatchObject({
      execution_boundary_verified: false,
      fallback_tool_violations: expect.arrayContaining([
        "node_repl/run:host_file_or_git_operation",
        "node_repl/run:unverified_external_write_path"
      ])
    });
  });

  test("flags Node REPL Git commands even without a tracked file diff", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeEvent(mcpCall("node_repl", "run", "require('child_process').execFileSync('git', ['status'])"));

    expect(tracker.finalize()).toMatchObject({
      execution_boundary_verified: false,
      fallback_tool_violations: expect.arrayContaining([
        "node_repl/run:host_file_or_git_operation",
        "node_repl/run:unverified_external_tool_path"
      ])
    });
  });

  test("fails closed when changed paths have no positive built-in provenance", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeEvent({ type: "item.completed", item: { type: "agent_message", text: "done" } });

    expect(tracker.finalize({ changedPaths: ["src/app.ts"] })).toMatchObject({
      execution_boundary_verified: false,
      fallback_tool_violations: ["unknown_write_provenance"]
    });
  });

  test("fails closed when an external MCP path accompanies a changed run", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeEvent(commandCompleted("bounded command"));
    tracker.observeEvent(mcpCall("filesystem", "write_file", "src/app.ts"));

    expect(tracker.finalize({ changedPaths: ["src/app.ts"] })).toMatchObject({
      execution_boundary_verified: false,
      fallback_tool_violations: expect.arrayContaining([
        "filesystem/write_file:unverified_external_tool_path",
        "filesystem/write_file:unverified_external_write_path"
      ])
    });
  });

  test("detects a sandbox marker split across stderr chunks", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeStderr("windows sandbox: orchestrator_helper_");
    tracker.observeStderr("launch_failed helper missing");

    expect(tracker.finalize()).toMatchObject({
      sandbox_failure_detected: true,
      sandbox_failure_code: "orchestrator_helper_launch_failed",
      execution_boundary_verified: false
    });
  });

  test("a structured sandbox code outranks an earlier defensive text classification", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeStderr("windows sandbox failed");
    tracker.observeEvent({ type: "error", error: { code: "orchestrator_helper_launch_failed" } });

    expect(tracker.finalize()).toMatchObject({
      sandbox_failure_code: "orchestrator_helper_launch_failed",
      execution_boundary_verified: false
    });
  });

  test("any external MCP tool path is unverified even when it produces no diff", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeEvent(mcpCall("filesystem", "read_file", "src/app.ts"));

    expect(tracker.finalize()).toMatchObject({
      execution_boundary_verified: false,
      fallback_tool_violations: ["filesystem/read_file:unverified_external_tool_path"]
    });
  });

  test("classifies the model cache warning as non-blocking when structured output remains valid", () => {
    const tracker = trackerWithVerifiedBootstrap();
    tracker.observeStderr("missing field supports_reasoning_summaries");
    tracker.observeEvent(commandCompleted("bounded command"));

    expect(tracker.finalize({ changedPaths: ["src/app.ts"] })).toMatchObject({
      sandbox_failure_detected: false,
      execution_boundary_verified: true,
      warnings: ["CODEX_MODEL_CACHE_WARNING"]
    });
  });

  test("never treats missing bootstrap evidence as verified", () => {
    const tracker = createCodexExecutionBoundaryTracker({
      sandboxRequested: "workspace-write",
      sandboxBootstrapVerified: false
    });
    tracker.observeEvent(commandCompleted("bounded command"));

    expect(tracker.finalize({ changedPaths: ["src/app.ts"] }).execution_boundary_verified).toBe(false);
  });
});

function trackerWithVerifiedBootstrap() {
  return createCodexExecutionBoundaryTracker({
    sandboxRequested: "workspace-write",
    sandboxBootstrapVerified: true
  });
}

function commandCompleted(command) {
  return {
    type: "item.completed",
    item: { type: "command_execution", command, status: "completed", exit_code: 0 }
  };
}

function mcpCall(server, tool, input) {
  return {
    type: "item.completed",
    item: { type: "mcp_tool_call", server, tool, status: "completed", arguments: { input } }
  };
}
