import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("package startup scripts", () => {
  test("declares local startup shortcuts", async () => {
    const raw = await readFile(join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      bin?: Record<string, string>;
      engines?: Record<string, string>;
      keywords?: string[];
      scripts?: Record<string, string>;
    };

    expect(pkg.bin?.["gpt-repo"]).toBe("dist/cli/connect-gpt.js");
    expect(pkg.bin?.["connect-gpt"]).toBe("dist/cli/connect-gpt.js");
    expect(pkg.engines?.node).toBe(">=20");
    expect(pkg.keywords).toEqual(
      expect.arrayContaining(["mcp", "chatgpt", "developer-tools", "repository", "local-first"])
    );
    expect(pkg.scripts?.mcp).toBe("GPT_REPO_CONFIG=./config.local.json PORT=8787 npm run dev");
    expect(pkg.scripts?.tunnel).toContain("--log=stdout");
    expect(pkg.scripts?.connect).toBe("node scripts/preload-github-runtime-access.mjs dev");
    expect(pkg.scripts?.["connect:secure"]).toBe("node scripts/preload-github-runtime-access.mjs secure");
    expect(pkg.scripts?.["install:desktop-launcher"]).toBe(
      "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-launcher.ps1"
    );
    expect(pkg.scripts?.["runtime:supervise"]).toBe("node scripts/runtime-supervisor.mjs");
    expect(pkg.scripts?.["runtime:status"]).toBe("node scripts/runtime-control.mjs status");
    expect(pkg.scripts?.["runtime:restart"]).toBe("node scripts/runtime-control.mjs restart-mcp");
    expect(pkg.scripts?.["install:windows-runtime"]).toContain("scripts/install-windows-runtime.ps1");
    expect(pkg.scripts?.["uninstall:windows-runtime"]).toContain("-Action Uninstall");
    expect(pkg.scripts?.add).toBe("node dist/cli/connect-gpt.js add");
    expect(pkg.scripts?.remove).toBe("node dist/cli/connect-gpt.js remove");
    expect(pkg.scripts?.list).toBe("node dist/cli/connect-gpt.js list");
    expect(pkg.scripts?.["check:config"]).toBe("node dist/cli/connect-gpt.js check");
  });

  test("includes connect runner script and ngrok URL hints", async () => {
    const scriptPath = join(process.cwd(), "scripts", "connect-dev.mjs");
    await expect(access(scriptPath)).resolves.toBeUndefined();
    const script = await readFile(scriptPath, "utf8");
    expect(script).toContain("loadOrCreatePublicPathToken");
    expect(script).toContain("stable user-local MCP path value");
    expect(script).toContain("GPT_REPO_PUBLIC_PATH_TOKEN");
    expect(script).toContain("REPO_READER_PUBLIC_PATH_TOKEN");
    expect(script).toContain("/t/${publicPathSegment}/mcp");
    expect(script).toContain("local guess-resistance, not authentication");
    expect(script).toContain("127.0.0.1:4040/api/tunnels");
    expect(script).toContain("ChatGPT MCP URL");
    expect(script).toContain("Reusing existing ngrok tunnel");
    expect(script).toContain("readNgrokHttpsUrl");
  });

  test("includes a bounded supervised Windows runtime", async () => {
    const supervisor = await readFile(join(process.cwd(), "scripts", "runtime-supervisor.mjs"), "utf8");
    const control = await readFile(join(process.cwd(), "scripts", "runtime-control.mjs"), "utf8");
    const installer = await readFile(join(process.cwd(), "scripts", "install-windows-runtime.ps1"), "utf8");

    expect(supervisor).toContain("runtime control action");
    expect(supervisor).toContain("restart_mcp");
    expect(supervisor).toContain("server.js");
    expect(supervisor).toContain("ensureGitHubRuntimeAccess");
    expect(supervisor).toContain("readNgrokHttpsUrl");
    expect(control).toContain("restart scheduled after the current tool response");
    expect(control).not.toContain("execFile");
    expect(control).not.toContain("spawn");
    expect(installer).toContain("New-ScheduledTaskSettingsSet");
    expect(installer).toContain("RestartCount 99");
    expect(installer).toContain("mcp.runtime.status");
    expect(installer).toContain("mcp.runtime.restart");
  });

  test("includes a Windows desktop launcher installer", async () => {
    const installerPath = join(process.cwd(), "scripts", "install-desktop-launcher.ps1");
    await expect(access(installerPath)).resolves.toBeUndefined();
    const installer = await readFile(installerPath, "utf8");
    expect(installer).toContain("DesktopDirectory");
    expect(installer).toContain("Start GPT Repo MCP.cmd");
    expect(installer).toContain("npm.cmd run connect");
    expect(installer).toContain("Keep the window open");

  });

  test("Windows runtime installer parses as PowerShell", async () => {
    if (process.platform !== "win32") return;
    const installerPath = join(process.cwd(), "scripts", "install-windows-runtime.ps1");
    const escapedPath = installerPath.replaceAll("'", "''");
    const command = [
      "$lexemes = $null",
      "$parseIssues = $null",
      `[System.Management.Automation.Language.Parser]::ParseFile('${escapedPath}', [ref]$lexemes, [ref]$parseIssues) | Out-Null`,
      "if ($parseIssues.Count -gt 0) { $parseIssues | ForEach-Object { Write-Error $_ }; exit 1 }"
    ].join("; ");
    await expect(run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], process.cwd()))
      .resolves.toBeDefined();
  });

  test("includes a bounded visible Claude login launcher", async () => {
    const powershellLauncherPath = join(process.cwd(), "scripts", "start-claude-login.ps1");
    const nodeLauncherPath = join(process.cwd(), "scripts", "start-claude-login.mjs");
    await expect(access(powershellLauncherPath)).resolves.toBeUndefined();
    await expect(access(nodeLauncherPath)).resolves.toBeUndefined();

    const powershellLauncher = await readFile(powershellLauncherPath, "utf8");
    expect(powershellLauncher).toContain("ClaudePath");
    expect(powershellLauncher).toContain("Start-Process");
    expect(powershellLauncher).toContain("-WindowStyle Normal");
    expect(powershellLauncher).toContain("auth login");
    expect(powershellLauncher).toContain("auth status --text");
    expect(powershellLauncher).not.toContain("npm root");
    expect(powershellLauncher).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(powershellLauncher).not.toContain("ANTHROPIC_API_KEY");

    const nodeLauncher = await readFile(nodeLauncherPath, "utf8");
    expect(nodeLauncher).toContain("resolveGlobalNpmClaudeEntry");
    expect(nodeLauncher).toContain("knownWindowsCliCandidates");
    expect(nodeLauncher).not.toContain("detached: true");
    expect(nodeLauncher).not.toContain("windowsHide: false");
    expect(nodeLauncher).not.toContain("CLAUDE_AUTH_LOGIN_STARTED");
    expect(nodeLauncher).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(nodeLauncher).not.toContain("ANTHROPIC_API_KEY");
    await expect(run(process.execPath, ["--check", nodeLauncherPath], process.cwd())).resolves.toBeDefined();

    if (process.platform !== "win32") return;
    const escapedPath = powershellLauncherPath.replaceAll("'", "''");
    const command = [
      "$lexemes = $null",
      "$parseIssues = $null",
      `[System.Management.Automation.Language.Parser]::ParseFile('${escapedPath}', [ref]$lexemes, [ref]$parseIssues) | Out-Null`,
      "if ($parseIssues.Count -gt 0) { $parseIssues | ForEach-Object { Write-Error $_ }; exit 1 }"
    ].join("; ");
    await expect(run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], process.cwd()))
      .resolves.toBeDefined();
  });

  test("includes secure tunnel startup script and env example", async () => {
    const scriptPath = join(process.cwd(), "scripts", "connect-secure.mjs");
    await expect(access(scriptPath)).resolves.toBeUndefined();
    const script = await readFile(scriptPath, "utf8");
    expect(script).toContain("CONTROL_PLANE_API_KEY");
    expect(script).toContain("TUNNEL_CLIENT_BIN");
    expect(script).toContain("TUNNEL_CLIENT_PROFILE");
    expect(script).toContain("GPT_REPO_LOG_FORMAT");
    expect(script).toContain("REPO_READER_LOG_FORMAT");
    expect(script).toContain("tunnel-client run");
    expect(script).toContain("Open ChatGPT connector settings");
    expect(script).not.toContain("REPO_READER_PUBLIC_PATH_TOKEN");
    expect(script).not.toContain("console.log(process.env.CONTROL_PLANE_API_KEY");

    const envExample = await readFile(join(process.cwd(), ".env.example"), "utf8");
    expect(envExample).toContain("CONTROL_PLANE_API_KEY=");
    expect(envExample).toContain("TUNNEL_CLIENT_BIN=");
    expect(envExample).toContain("example value is only a convention");
    expect(envExample).toContain("TUNNEL_CLIENT_PROFILE=gpt-repo-local");
    expect(envExample).toContain("GPT_REPO_CONFIG=./config.local.json");
    expect(envExample).toContain("GPT_REPO_LOG_FORMAT=pretty");
    expect(envExample).toContain("PORT=8787");

    const connectionOptions = await readFile(join(process.cwd(), "docs", "CONNECTION_OPTIONS.md"), "utf8");
    expect(connectionOptions).toContain("example local `tunnel-client` profile label");
    expect(connectionOptions).toContain("not a `repo_id`, GitHub repo, ChatGPT connector name, ngrok tunnel, or MCP server name");
    expect(connectionOptions).toContain("tunnel-client run --profile <profile>");
  });

  test("public hygiene script blocks historical docs and local-only artifacts", async () => {
    const script = await readFile(join(process.cwd(), "scripts", "check-public.mjs"), "utf8");

    expect(script).toContain("git");
    expect(script).toContain("ls-files");
    expect(script).toContain("MASTER_PROMPT.md");
    expect(script).toContain("docs/CHATGPT_DEV_MODE.md");
    expect(script).toContain("AGENTS.md");
    expect(script).toContain("config.local.json");
    expect(script).toContain(".gitignore");
    expect(script).toContain(".chatgpt/");
    expect(script).toContain(".agent-recorder/");
    expect(script).toContain(".agentbus/");
  });

  test("public hygiene script rejects any tracked .chatgpt artifact", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "gpt-repo-public-check-"));
    const scriptPath = join(process.cwd(), "scripts", "check-public.mjs");
    await run("git", ["init"], fixture);
    await mkdir(join(fixture, ".chatgpt", "plans"), { recursive: true });
    await writeFile(join(fixture, ".chatgpt", "plans", "private.md"), "# Private plan\n");
    await run("git", ["add", ".chatgpt/plans/private.md"], fixture);

    await expect(run(process.execPath, [scriptPath], fixture)).rejects.toMatchObject({
      stderr: expect.stringContaining(".chatgpt/plans/private.md")
    });
  });

  test("public hygiene script allows Promptiva only in LICENSE", async () => {
    const scriptPath = join(process.cwd(), "scripts", "check-public.mjs");

    const licenseFixture = await mkdtemp(join(tmpdir(), "gpt-repo-public-license-"));
    await run("git", ["init"], licenseFixture);
    await writeFile(join(licenseFixture, "LICENSE"), "MIT License\n\nCopyright (c) 2026 Promptiva AB\n");
    await run("git", ["add", "LICENSE"], licenseFixture);
    await expect(run(process.execPath, [scriptPath], licenseFixture)).resolves.toMatchObject({
      stdout: expect.stringContaining("Public hygiene check passed.")
    });

    const readmeFixture = await mkdtemp(join(tmpdir(), "gpt-repo-public-readme-"));
    await run("git", ["init"], readmeFixture);
    await writeFile(join(readmeFixture, "README.md"), "Built by Promptiva AB\n");
    await run("git", ["add", "README.md"], readmeFixture);
    await expect(run(process.execPath, [scriptPath], readmeFixture)).rejects.toMatchObject({
      stderr: expect.stringContaining("README.md: blocked public-release marker found: Promptiva")
    });
  });

  test("gitignore uses public-safe local artifact wording", async () => {
    const gitignore = await readFile(join(process.cwd(), ".gitignore"), "utf8");

    expect(gitignore).toContain("# Local agent artifacts");
    expect(gitignore).toContain(".chatgpt/");
    expect(gitignore).not.toContain("Agent Recorder");
  });

  test("setup docs explain ngrok installation from zero", async () => {
    const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
    const setup = await readFile(join(process.cwd(), "docs", "SETUP.md"), "utf8");
    const connectionOptions = await readFile(join(process.cwd(), "docs", "CONNECTION_OPTIONS.md"), "utf8");

    expect(readme).toContain("Install ngrok from zero");
    expect(setup).toContain("## Install ngrok from zero");
    expect(setup).toContain("brew install ngrok");
    expect(setup).toContain("sudo apt install ngrok");
    expect(setup).toContain("Windows");
    expect(setup).toContain("ngrok help");
    expect(setup).toContain("npm run connect");
    expect(connectionOptions).toContain("## ngrok prerequisites");
    expect(connectionOptions).toContain("SETUP.md#install-ngrok-from-zero");
  });

  test("setup docs explain the empty starter config flow", async () => {
    const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
    const setup = await readFile(join(process.cwd(), "docs", "SETUP.md"), "utf8");
    const workflows = await readFile(join(process.cwd(), "docs", "WRITE_WORKFLOWS.md"), "utf8");

    for (const doc of [readme, setup]) {
      expect(doc).toContain("cp config.example.json config.local.json");
      expect(doc).toContain("empty");
      expect(doc).toContain("npm run add -- /path/to/your/repo");
    }
    expect(setup).toContain("WARN config has no repositories");
    expect(workflows).toContain("Manual config remains supported");
    expect(workflows).toContain("\"root\": \"/absolute/path/to/repo\"");
  });

  test("ChatGPT connector docs reference sanitized local assets", async () => {
    const chatgptConnect = await readFile(join(process.cwd(), "docs", "CHATGPT_CONNECT.md"), "utf8");
    const assetsReadme = await readFile(join(process.cwd(), "docs", "assets", "README.md"), "utf8");

    expect(chatgptConnect).toContain("assets/chatgpt-server-url.png");
    expect(chatgptConnect).toContain("assets/chatgpt-tunnel-id.png");
    await expect(access(join(process.cwd(), "docs", "assets", "chatgpt-server-url.png"))).resolves.toBeUndefined();
    await expect(access(join(process.cwd(), "docs", "assets", "chatgpt-tunnel-id.png"))).resolves.toBeUndefined();
    expect(assetsReadme).toContain("sanitized source mockups");
    expect(assetsReadme).toContain("free of real tunnel URLs, tunnel ids, tokens, repo paths, account names, or other private data");
  });

  test("clone docs avoid Markdown table pipes inside command cells", async () => {
    const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
    const setup = await readFile(join(process.cwd(), "docs", "SETUP.md"), "utf8");

    for (const doc of [readme, setup]) {
      expect(doc).not.toContain("`npm run add -- <path> --mode read|write|ship`");
      expect(doc).toContain("`npm run add -- <path> --mode <mode>`");
      expect(doc).toContain("explicit `read`, `write`, or `ship` mode");
    }
  });
});

function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
