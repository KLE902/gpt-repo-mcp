import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("Windows runtime supervisor installation", () => {
  test("starts the scheduled supervisor through a hidden fixed launcher", async () => {
    const installer = await readFile(join(process.cwd(), "scripts", "install-windows-runtime.ps1"), "utf8");
    const launcher = await readFile(join(process.cwd(), "scripts", "start-runtime-supervisor.ps1"), "utf8");

    expect(installer).toContain("start-runtime-supervisor.ps1");
    expect(installer).toContain("-WindowStyle");
    expect(installer).toContain("Hidden");
    expect(installer).toContain("New-ScheduledTaskAction -Execute $powershellPath");
    expect(launcher).toContain("runtime-supervisor.mjs");
    expect(launcher).toContain("& $NodePath @arguments");
    expect(launcher).not.toContain("Invoke-Expression");
    expect(launcher).not.toContain("Start-Process");
  });
});
