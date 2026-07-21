import { describe, expect, test } from "vitest";
import { parseGitHubRepository, readyCurrentPullRequest } from "../scripts/github-pr-ready.mjs";

const HEAD = "a".repeat(40);
const BRANCH = "feat/autonomous-operations";

function pullRequest(overrides = {}) {
  return {
    number: 5,
    state: "OPEN",
    isDraft: true,
    headRefName: BRANCH,
    headRefOid: HEAD,
    baseRefName: "main",
    url: "https://github.com/KLE902/gpt-repo-mcp/pull/5",
    statusCheckRollup: [],
    ...overrides
  };
}

function queuedRunner(outputs) {
  const calls = [];
  const queue = [...outputs];
  return {
    calls,
    run: async (command, args) => {
      calls.push({ command, args });
      if (queue.length === 0) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      const next = queue.shift();
      return typeof next === "function" ? next(command, args) : { stdout: next.stdout ?? "", stderr: next.stderr ?? "" };
    }
  };
}

describe("github-pr-ready", () => {
  test("parses supported GitHub remote forms and rejects other hosts", () => {
    expect(parseGitHubRepository("https://github.com/KLE902/gpt-repo-mcp.git")).toBe("KLE902/gpt-repo-mcp");
    expect(parseGitHubRepository("git@github.com:KLE902/gpt-repo-mcp.git")).toBe("KLE902/gpt-repo-mcp");
    expect(parseGitHubRepository("ssh://git@github.com/KLE902/gpt-repo-mcp.git")).toBe("KLE902/gpt-repo-mcp");
    expect(() => parseGitHubRepository("https://example.com/KLE902/gpt-repo-mcp.git")).toThrow(/GitHub\.com/);
    expect(() => parseGitHubRepository("http://github.com/KLE902/gpt-repo-mcp.git")).toThrow(/HTTPS or SSH/);
  });

  test("marks only the exact current draft PR ready and verifies the result", async () => {
    const ready = pullRequest({ isDraft: false, statusCheckRollup: [{ name: "CI", status: "QUEUED" }] });
    const runner = queuedRunner([
      { stdout: `${HEAD}\n` },
      { stdout: "" },
      { stdout: `${BRANCH}\n` },
      { stdout: "https://github.com/KLE902/gpt-repo-mcp.git\n" },
      { stdout: JSON.stringify(pullRequest()) },
      { stdout: "✓ Pull request KLE902/gpt-repo-mcp#5 is marked as ready for review\n" },
      { stdout: JSON.stringify(ready) },
      { stdout: `${HEAD}\n` },
      { stdout: "" }
    ]);

    const result = await readyCurrentPullRequest({
      cwd: "/repo",
      runCommand: runner.run,
      waitForChecksMs: 0
    });

    expect(result).toMatchObject({
      ok: true,
      action: "marked_ready",
      repository: "KLE902/gpt-repo-mcp",
      pull_number: 5,
      head_sha: HEAD,
      draft: false,
      checks_registered: true,
      warnings: []
    });
    expect(runner.calls).toContainEqual({
      command: "gh",
      args: ["pr", "ready", "5", "--repo", "KLE902/gpt-repo-mcp"]
    });
  });

  test("is idempotent when the exact pull request is already ready", async () => {
    const runner = queuedRunner([
      { stdout: `${HEAD}\n` },
      { stdout: "" },
      { stdout: `${BRANCH}\n` },
      { stdout: "git@github.com:KLE902/gpt-repo-mcp.git\n" },
      { stdout: JSON.stringify(pullRequest({ isDraft: false })) },
      { stdout: `${HEAD}\n` },
      { stdout: "" }
    ]);

    const result = await readyCurrentPullRequest({ cwd: "/repo", runCommand: runner.run, waitForChecksMs: 0 });
    expect(result).toMatchObject({ action: "unchanged", draft: false, checks_registered: false });
    expect(runner.calls.some((call) => call.command === "gh" && call.args[1] === "ready")).toBe(false);
  });

  test("fails closed before mutation when GitHub reports another head SHA", async () => {
    const runner = queuedRunner([
      { stdout: `${HEAD}\n` },
      { stdout: "" },
      { stdout: `${BRANCH}\n` },
      { stdout: "https://github.com/KLE902/gpt-repo-mcp.git\n" },
      { stdout: JSON.stringify(pullRequest({ headRefOid: "b".repeat(40) })) }
    ]);

    await expect(readyCurrentPullRequest({ cwd: "/repo", runCommand: runner.run, waitForChecksMs: 0 }))
      .rejects.toMatchObject({ code: "PULL_HEAD_MISMATCH" });
    expect(runner.calls.some((call) => call.command === "gh" && call.args[1] === "ready")).toBe(false);
  });

  test("rejects a dirty worktree before contacting GitHub", async () => {
    const runner = queuedRunner([
      { stdout: `${HEAD}\n` },
      { stdout: " M src/server.ts\n" }
    ]);

    await expect(readyCurrentPullRequest({ cwd: "/repo", runCommand: runner.run, waitForChecksMs: 0 }))
      .rejects.toMatchObject({ code: "WORKTREE_NOT_CLEAN" });
    expect(runner.calls.some((call) => call.command === "gh")).toBe(false);
  });
});
