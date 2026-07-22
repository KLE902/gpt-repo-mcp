import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("Windows runtime supervisor installation", () => {
  test("starts the scheduled supervisor through a no-console Windows Script Host launcher", async () => {
    const installer = await readFile(join(process.cwd(), "scripts", "install-windows-runtime.ps1"), "utf8");
    const launcher = await readFile(join(process.cwd(), "scripts", "start-runtime-supervisor.vbs"), "utf8");

    expect(installer).toContain("start-runtime-supervisor.vbs");
    expect(installer).toContain("System32\\wscript.exe");
    expect(installer).toContain("New-ScheduledTaskAction -Execute $wscriptPath");
    expect(installer).toContain("//B");
    expect(installer).toContain("//NoLogo");
    expect(installer).not.toContain("New-ScheduledTaskAction -Execute $powershellPath");
    expect(installer).not.toContain("-WindowStyle");
    expect(installer).not.toContain("\\\"{0}\\\"");

    expect(launcher).toContain("runtime-supervisor.mjs");
    expect(launcher).toContain("shell.Run(command, 0, True)");
    expect(launcher).not.toContain("Exec(");
    expect(launcher).not.toContain("Run(command, 1");
  });

  test("VBScript launcher parses on Windows", async () => {
    if (process.platform !== "win32") return;

    const launcherPath = join(process.cwd(), "scripts", "start-runtime-supervisor.vbs");
    const result = await runCscript(launcherPath);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe("");
  });
});

function runCscript(launcherPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("cscript.exe", ["//B", "//NoLogo", launcherPath], {
      cwd: process.cwd(),
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
