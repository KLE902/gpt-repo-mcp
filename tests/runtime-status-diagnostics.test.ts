import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("runtime status diagnostics", () => {
  test("reports bounded last-exit details", async () => {
    const runtimeDirectory = await mkdtemp(join(tmpdir(), "gpt-repo-runtime-status-"));
    await writeFile(join(runtimeDirectory, "status.json"), JSON.stringify({
      version: 1,
      supervisor_pid: 10,
      updated_at: new Date().toISOString(),
      mcp: {
        state: "running",
        pid: 11,
        restarts: 3,
        last_exit: { code: 0, signal: null, at: "2026-07-22T18:15:12.062Z" }
      },
      tunnel: {
        state: "running",
        source: "supervised",
        restarts: 1
      }
    }), "utf8");

    const result = await runStatus(runtimeDirectory);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("MCP: running (pid 11), restarts 3");
    expect(result.stdout).toContain("MCP last exit: code=0, signal=null, at=2026-07-22T18:15:12.062Z");
  });
});

function runStatus(runtimeDirectory: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(process.cwd(), "scripts", "runtime-control.mjs"), "status"], {
      cwd: process.cwd(),
      env: { ...process.env, GPT_REPO_RUNTIME_DIR: runtimeDirectory },
      encoding: "utf8"
    }, (error, stdout, stderr) => {
      resolve({
        code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stdout: String(stdout),
        stderr: String(stderr)
      });
    });
  });
}
