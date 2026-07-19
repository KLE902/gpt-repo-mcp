import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { normalizeRuntimeEnvironment } from "../src/runtime/environment.js";

describe("normalizeRuntimeEnvironment", () => {
  test("uses USERPROFILE as HOME on Windows when it contains a complete Git identity", async () => {
    const home = await createGitHome("Fixture User", "fixture@example.com");
    const fallbackRoot = await mkdtemp(join(tmpdir(), "repo-reader-runtime-fallback-"));
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      USERPROFILE: home
    };

    normalizeRuntimeEnvironment(environment, "win32", fallbackRoot);

    expect(environment.HOME).toBe(home);
  });

  test("preserves an explicitly configured HOME when it contains a complete Git identity", async () => {
    const home = await createGitHome("Portable User", "portable@example.com");
    const fallbackRoot = await mkdtemp(join(tmpdir(), "repo-reader-runtime-fallback-"));
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: "C:\\Users\\Fixture"
    };

    normalizeRuntimeEnvironment(environment, "win32", fallbackRoot);

    expect(environment.HOME).toBe(home);
  });

  test("creates an isolated fallback Git identity when user-level identity is missing", async () => {
    const emptyHome = await mkdtemp(join(tmpdir(), "repo-reader-empty-home-"));
    const fallbackRoot = await mkdtemp(join(tmpdir(), "repo-reader-runtime-fallback-"));
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: emptyHome,
      GPT_REPO_GIT_AUTHOR_NAME: "Fixture Agent",
      GPT_REPO_GIT_AUTHOR_EMAIL: "fixture-agent@example.invalid"
    };

    normalizeRuntimeEnvironment(environment, "win32", fallbackRoot);

    const expectedHome = join(fallbackRoot, "gpt-repo-mcp", "git-home");
    expect(environment.HOME).toBe(expectedHome);
    await expect(readFile(join(expectedHome, ".gitconfig"), "utf8")).resolves.toBe(
      "[user]\n\tname = \"Fixture Agent\"\n\temail = \"fixture-agent@example.invalid\"\n"
    );
    const gitEnvironment = { PATH: process.env.PATH ?? "", HOME: expectedHome };
    expect(execFileSync("git", ["config", "--global", "--get", "user.name"], { encoding: "utf8", env: gitEnvironment }).trim()).toBe("Fixture Agent");
    expect(execFileSync("git", ["config", "--global", "--get", "user.email"], { encoding: "utf8", env: gitEnvironment }).trim()).toBe("fixture-agent@example.invalid");
  });

  test("uses deterministic fallback values when runtime overrides are absent", async () => {
    const emptyHome = await mkdtemp(join(tmpdir(), "repo-reader-empty-home-"));
    const fallbackRoot = await mkdtemp(join(tmpdir(), "repo-reader-runtime-fallback-"));
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: emptyHome
    };

    normalizeRuntimeEnvironment(environment, "win32", fallbackRoot);

    const config = await readFile(join(environment.HOME!, ".gitconfig"), "utf8");
    expect(config).toContain("name = \"GPT Repo MCP\"");
    expect(config).toContain("email = \"gpt-repo-mcp@local.invalid\"");
  });

  test("does not synthesize HOME on non-Windows platforms", async () => {
    const fallbackRoot = await mkdtemp(join(tmpdir(), "repo-reader-runtime-fallback-"));
    const environment: NodeJS.ProcessEnv = {
      USERPROFILE: "C:\\Users\\Fixture"
    };

    normalizeRuntimeEnvironment(environment, "linux", fallbackRoot);

    expect(environment.HOME).toBeUndefined();
  });
});

async function createGitHome(name: string, email: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "repo-reader-git-home-"));
  await mkdir(home, { recursive: true });
  await writeFile(join(home, ".gitconfig"), `[user]\n\tname = ${name}\n\temail = ${email}\n`);
  return home;
}
