import { ensureGitHubRuntimeAccess } from "./github-runtime-access.mjs";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "secure") {
  globalThis.console.error("Usage: node scripts/preload-github-runtime-access.mjs <dev|secure>");
  process.exit(1);
}

const access = ensureGitHubRuntimeAccess();
if (access.source === "gh-cli") {
  globalThis.console.log("GitHub API access loaded from the authenticated GitHub CLI session.");
} else if (access.available) {
  globalThis.console.log(`GitHub API access loaded from ${access.envName}.`);
} else {
  globalThis.console.log(
    "GitHub API access is unavailable. Push can still use Git credentials, but PR, check, and merge operations require gh auth login or a token environment variable."
  );
}

await import(mode === "secure" ? "./connect-secure.mjs" : "./connect-dev.mjs");
