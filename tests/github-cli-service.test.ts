import { describe, expect, test } from "vitest";
import { GitHubCliService } from "../src/services/github-cli-service.js";

const HEAD = "1".repeat(40);
const BASE = "2".repeat(40);

function pull(overrides: Record<string, unknown> = {}) {
  return {
    number: 5,
    title: "Superseded work",
    state: "OPEN",
    isDraft: false,
    url: "https://github.com/acme/demo/pull/5",
    headRefName: "feature/old",
    headRefOid: HEAD,
    baseRefName: "main",
    baseRefOid: BASE,
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
    mergedAt: null,
    body: null,
    ...overrides
  };
}

describe("GitHubCliService", () => {
  test("lists pull requests with fixed structured gh arguments and bounded filters", async () => {
    const calls: string[][] = [];
    const service = new GitHubCliService("/repo", async (args) => {
      calls.push(args);
      return JSON.stringify([pull()]);
    });

    const result = await service.listPulls("acme/demo", {
      state: "all",
      head: "feature/old",
      base: "main",
      limit: 31
    });

    expect(result).toHaveLength(1);
    expect(calls).toEqual([[
      "pr", "list", "--repo", "acme/demo", "--state", "all", "--limit", "31", "--json",
      "number,title,state,isDraft,url,headRefName,headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus,mergedAt,body",
      "--head", "feature/old", "--base", "main"
    ]]);
  });

  test("closes through gh without delegating branch deletion", async () => {
    const calls: string[][] = [];
    const service = new GitHubCliService("/repo", async (args) => {
      calls.push(args);
      return "";
    });

    await service.closePull("acme/demo", 5, "Superseded by #6.");

    expect(calls).toEqual([[
      "pr", "close", "5", "--repo", "acme/demo", "--comment", "Superseded by #6."
    ]]);
    expect(calls[0]).not.toContain("--delete-branch");
  });

  test("fails closed on invalid GitHub CLI JSON", async () => {
    const service = new GitHubCliService("/repo", async () => "not-json");
    await expect(service.viewPull("acme/demo", 5)).rejects.toMatchObject({
      code: "GITHUB_CLI_RESPONSE_INVALID"
    });
  });
});
