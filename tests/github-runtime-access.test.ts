import { describe, expect, test, vi } from "vitest";
// @ts-ignore The startup helper is intentionally plain JavaScript and loaded directly by Node.
import { ensureGitHubRuntimeAccess } from "../scripts/github-runtime-access.mjs";

describe("GitHub runtime access", () => {
  test("preserves an explicit access environment variable without invoking gh", () => {
    const existingAccess = ["existing", "fixture"].join("-");
    const env = { GH_TOKEN: existingAccess };
    const runGh = vi.fn();

    expect(ensureGitHubRuntimeAccess({ env, runGh })).toEqual({
      available: true,
      source: "environment",
      envName: "GH_TOKEN"
    });
    expect(runGh).not.toHaveBeenCalled();
    expect(env).toEqual({ GH_TOKEN: existingAccess });
  });

  test("loads authenticated GitHub CLI access into the child-process environment", () => {
    const cliAccess = ["runtime", "fixture"].join("-");
    const env: Record<string, string> = {};
    const result = ensureGitHubRuntimeAccess({
      env,
      runGh: () => ({ status: 0, stdout: `${cliAccess}\n` })
    });

    expect(result).toEqual({
      available: true,
      source: "gh-cli",
      envName: "GPT_REPO_GITHUB_TOKEN"
    });
    expect(result).not.toHaveProperty("accessValue");
    expect(env.GPT_REPO_GITHUB_TOKEN).toBe(cliAccess);
  });

  test("stays unavailable when GitHub CLI authentication is missing", () => {
    const env: Record<string, string> = {};

    expect(ensureGitHubRuntimeAccess({
      env,
      runGh: () => ({ status: 1, stdout: "" })
    })).toEqual({ available: false, source: "unavailable" });
    expect(env).toEqual({});
  });
});
