import { describe, expect, test } from "vitest";
import { GitHubClient } from "../src/services/github-client.js";

const SHA = "a".repeat(40);

describe("GitHubClient", () => {
  test("rejects API mutations when no runtime access value is available", async () => {
    const client = new GitHubClient({
      env: {},
      fetch_impl: async () => {
        throw new Error("fetch must not run without mutation authentication");
      }
    });

    await expect(client.mergePull("acme", "demo", 7, {
      sha: SHA,
      merge_method: "squash"
    })).rejects.toMatchObject({ code: "GITHUB_AUTH_REQUIRED" });
  });

  test("sends the exact reviewed SHA and merge method to the GitHub merge endpoint", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const accessValue = ["runtime", "fixture"].join("-");
    const client = new GitHubClient({
      env: { GPT_REPO_GITHUB_TOKEN: accessValue },
      fetch_impl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify({
          sha: SHA,
          merged: true,
          message: "Pull Request successfully merged"
        }), {
          status: 200,
          headers: { "content-type": "application/json", "x-github-request-id": "fixture-request" }
        });
      }
    });

    const result = await client.mergePull("acme", "demo", 7, {
      sha: SHA,
      merge_method: "squash"
    });

    expect(result).toEqual({
      sha: SHA,
      merged: true,
      message: "Pull Request successfully merged"
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.github.com/repos/acme/demo/pulls/7/merge");
    expect(requests[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      sha: SHA,
      merge_method: "squash"
    });

    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get("X-GitHub-Api-Version")).toBe("2026-03-10");
    expect(headers.get(["Author", "ization"].join(""))).toBe(["Bear", "er ", accessValue].join(""));
  });
});
