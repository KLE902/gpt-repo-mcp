import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_GIT_AUTHOR_NAME = "GPT Repo MCP";
const DEFAULT_GIT_AUTHOR_EMAIL = "gpt-repo-mcp@local.invalid";

export function normalizeRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  fallbackRoot: string = environment.LOCALAPPDATA ?? tmpdir()
): void {
  if (platform !== "win32") return;

  const candidateHome = environment.HOME
    ?? environment.USERPROFILE
    ?? (environment.HOMEDRIVE && environment.HOMEPATH
      ? `${environment.HOMEDRIVE}${environment.HOMEPATH}`
      : undefined);

  if (candidateHome && hasGitIdentity(candidateHome, environment)) {
    environment.HOME = candidateHome;
    return;
  }

  const runtimeHome = join(fallbackRoot, "gpt-repo-mcp", "git-home");
  mkdirSync(runtimeHome, { recursive: true });
  const authorName = normalizedIdentityValue(environment.GPT_REPO_GIT_AUTHOR_NAME)
    ?? DEFAULT_GIT_AUTHOR_NAME;
  const authorEmail = normalizedIdentityValue(environment.GPT_REPO_GIT_AUTHOR_EMAIL)
    ?? DEFAULT_GIT_AUTHOR_EMAIL;
  writeFileSync(
    join(runtimeHome, ".gitconfig"),
    `[user]\n\tname = ${quoteGitConfigValue(authorName)}\n\temail = ${quoteGitConfigValue(authorEmail)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  environment.HOME = runtimeHome;
}

function hasGitIdentity(home: string, environment: NodeJS.ProcessEnv): boolean {
  const gitEnvironment: NodeJS.ProcessEnv = {
    PATH: environment.PATH ?? process.env.PATH ?? "",
    HOME: home,
    ...(environment.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: environment.XDG_CONFIG_HOME } : {})
  };
  try {
    const name = execFileSync("git", ["config", "--global", "--get", "user.name"], {
      encoding: "utf8",
      env: gitEnvironment,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const email = execFileSync("git", ["config", "--global", "--get", "user.email"], {
      encoding: "utf8",
      env: gitEnvironment,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return Boolean(normalizedIdentityValue(name) && normalizedIdentityValue(email));
  } catch {
    return false;
  }
}

function normalizedIdentityValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && !/[\0\r\n]/.test(normalized) ? normalized : undefined;
}

function quoteGitConfigValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
