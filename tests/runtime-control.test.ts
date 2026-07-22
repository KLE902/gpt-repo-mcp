import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error The supervised runtime helper is intentionally plain JavaScript and loaded directly by Node.
const runtimeState = await import("../scripts/runtime-state.mjs");
const {
  createControlRequest,
  isDueControlRequest,
  isFreshRuntimeStatus,
  resolveRuntimeDirectory,
  runtimePaths
} = runtimeState;

describe("supervised runtime control", () => {
  test("uses a user-local runtime directory and supports an explicit override", () => {
    expect(resolveRuntimeDirectory({ LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" }, "win32", "C:\\Users\\demo"))
      .toBe("C:\\Users\\demo\\AppData\\Local\\gpt-repo-mcp\\runtime");
    expect(resolveRuntimeDirectory({ GPT_REPO_RUNTIME_DIR: "D:\\runtime" }, "win32", "C:\\Users\\demo"))
      .toBe("D:\\runtime");
    expect(resolveRuntimeDirectory({}, "linux", "/home/demo"))
      .toBe("/home/demo/.gpt-repo-mcp/runtime");
  });

  test("creates delayed bounded restart requests", () => {
    const request = createControlRequest("restart_mcp", { now: 1_000, delayMs: 4_000, requestId: "request-1234" });
    expect(request).toMatchObject({
      version: 1,
      request_id: "request-1234",
      action: "restart_mcp",
      requested_at: new Date(1_000).toISOString(),
      not_before: new Date(5_000).toISOString()
    });
    expect(isDueControlRequest(request, 4_999)).toBe(false);
    expect(isDueControlRequest(request, 5_000)).toBe(true);
    expect(() => createControlRequest("shell" as never)).toThrow("Unsupported runtime control action");
  });

  test("rejects stale status and schedules restart only with a fresh supervisor heartbeat", async () => {
    const runtimeDirectory = await mkdtemp(join(tmpdir(), "gpt-repo-runtime-"));
    const paths = runtimePaths(runtimeDirectory);
    const staleStatus = {
      version: 1,
      supervisor_pid: 12,
      updated_at: new Date(Date.now() - 60_000).toISOString(),
      mcp: { state: "running" },
      tunnel: { state: "running" }
    };
    expect(isFreshRuntimeStatus(staleStatus)).toBe(false);
    await writeFile(paths.status, JSON.stringify(staleStatus));

    const stale = await runControl("restart-mcp", runtimeDirectory);
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain("supervisor is not running");

    const freshStatus = { ...staleStatus, updated_at: new Date().toISOString() };
    await writeFile(paths.status, JSON.stringify(freshStatus));
    const scheduled = await runControl("restart-mcp", runtimeDirectory);
    expect(scheduled.code).toBe(0);
    expect(scheduled.stdout).toContain("restart scheduled after the current tool response");
    const request = JSON.parse(await readFile(paths.control, "utf8")) as { action: string; not_before: string };
    expect(request.action).toBe("restart_mcp");
    expect(Date.parse(request.not_before)).toBeGreaterThan(Date.now() + 2_000);
  });
});

function runControl(command: string, runtimeDirectory: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(process.cwd(), "scripts", "runtime-control.mjs"), command], {
      cwd: process.cwd(),
      env: { ...process.env, GPT_REPO_RUNTIME_DIR: runtimeDirectory },
      encoding: "utf8"
    }, (error, stdout, stderr) => {
      resolve({ code: typeof error?.code === "number" ? error.code : error ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
