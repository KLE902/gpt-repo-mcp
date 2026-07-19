import { spawnSync } from "node:child_process";

const ACCESS_ENV_NAMES = ["GPT_REPO_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

export function ensureGitHubRuntimeAccess(options = {}) {
  const env = options.env ?? process.env;
  const runGh = options.runGh ?? defaultRunGh;

  for (const name of ACCESS_ENV_NAMES) {
    const current = env[name];
    if (typeof current === "string" && current.trim() !== "") {
      return { available: true, source: "environment", envName: name };
    }
  }

  const result = runGh();
  const accessValue = result?.status === 0 && typeof result.stdout === "string"
    ? result.stdout.trim()
    : "";

  if (!accessValue) {
    return { available: false, source: "unavailable" };
  }

  env[ACCESS_ENV_NAMES[0]] = accessValue;
  return { available: true, source: "gh-cli", envName: ACCESS_ENV_NAMES[0] };
}

function defaultRunGh() {
  return spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  });
}
