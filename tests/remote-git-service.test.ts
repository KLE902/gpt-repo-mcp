import { describe, expect, test } from "vitest";
import { MergePullRequestInputSchema } from "../src/contracts/remote-git.contract.js";
import { RepoReaderError } from "../src/runtime/errors.js";
import { OperationsPolicy } from "../src/services/operations-policy.js";
import { RemoteGitService, parseGitHubRemote } from "../src/services/remote-git-service.js";

const HEAD = "1".repeat(40);

describe("RemoteGitService", () => {
  test("parses supported GitHub HTTPS and SSH remotes without credentials", () => {
    expect(parseGitHubRemote("https://github.com/acme/demo.git")).toEqual({
      owner: "acme",
      name: "demo",
      html_url: "https://github.com/acme/demo"
    });
    expect(parseGitHubRemote("git@github.com:acme/demo.git")).toEqual({
      owner: "acme",
      name: "demo",
      html_url: "https://github.com/acme/demo"
    });
    expectRepoError(() => parseGitHubRemote("https://user:secret@github.com/acme/demo.git"), "GIT_REMOTE_NOT_GITHUB");
    expectRepoError(() => parseGitHubRemote("https://git@github.com/acme/demo.git"), "GIT_REMOTE_NOT_GITHUB");
    expectRepoError(() => parseGitHubRemote("http://github.com/acme/demo.git"), "GIT_REMOTE_NOT_GITHUB");
    expectRepoError(() => parseGitHubRemote("https://example.com/acme/demo.git"), "GIT_REMOTE_NOT_GITHUB");
  });

  test("remote mutations remain disabled unless explicitly enabled", async () => {
    const service = new RemoteGitService("/repo", new OperationsPolicy(), {
      git_runner: async () => ""
    });

    await expect(service.push({
      repo_id: "fixture",
      remote: "origin",
      expected_branch: "feature/demo",
      expected_head_sha: HEAD,
      set_upstream: true,
      dry_run: true
    })).rejects.toMatchObject({ code: "OPERATIONS_DISABLED" });
  });

  test("feature-branch creation remains disabled unless explicitly enabled", async () => {
    const service = new RemoteGitService("/repo", new OperationsPolicy(), {
      git_runner: async () => ""
    });

    await expect(service.createBranch({
      repo_id: "fixture",
      branch: "feature/demo",
      expected_source_branch: "main",
      expected_head_sha: HEAD,
      dry_run: true
    })).rejects.toMatchObject({ code: "OPERATIONS_DISABLED" });
  });

  test("feature-branch creation requires its separate operation toggle", async () => {
    const service = new RemoteGitService("/repo", new OperationsPolicy({ enabled: true }), {
      git_runner: async () => ""
    });

    await expect(service.createBranch({
      repo_id: "fixture",
      branch: "feature/demo",
      expected_source_branch: "main",
      expected_head_sha: HEAD,
      dry_run: true
    })).rejects.toMatchObject({ code: "GIT_BRANCH_CREATE_DISABLED" });
  });

  test("creates only a new branch with fixed git switch arguments and carries dirty worktree state", async () => {
    const calls: string[][] = [];
    let branch = "main";
    const service = new RemoteGitService("/repo", branchPolicy(), {
      git_runner: async (args) => {
        calls.push(args);
        const command = args.join(" ");
        if (command === "rev-parse HEAD") return HEAD;
        if (command === "symbolic-ref --quiet --short HEAD") return branch;
        if (command === "status --porcelain=v1 --untracked-files=all") return " M src/app.ts";
        if (command === "check-ref-format --branch feature/remote-flow") return "feature/remote-flow";
        if (command === "show-ref --verify --hash refs/heads/feature/remote-flow") throw new Error("missing ref");
        if (command === "switch -c feature/remote-flow") {
          branch = "feature/remote-flow";
          return "";
        }
        throw new Error(`Unexpected git call: ${command}`);
      }
    });

    const result = await service.createBranch({
      repo_id: "fixture",
      branch: "feature/remote-flow",
      expected_source_branch: "main",
      expected_head_sha: HEAD,
      dry_run: false
    });

    expect(result).toEqual({
      ok: true,
      dry_run: false,
      source_branch: "main",
      branch: "feature/remote-flow",
      head_sha: HEAD,
      created: true,
      worktree_clean: false,
      warnings: ["WORKTREE_CHANGES_CARRIED_TO_NEW_BRANCH"]
    });
    expect(calls.filter((args) => args[0] === "switch")).toEqual([["switch", "-c", "feature/remote-flow"]]);
  });

  test("refuses to switch to an existing local branch", async () => {
    const calls: string[][] = [];
    const service = new RemoteGitService("/repo", branchPolicy(), {
      git_runner: async (args) => {
        calls.push(args);
        const command = args.join(" ");
        if (command === "rev-parse HEAD") return HEAD;
        if (command === "symbolic-ref --quiet --short HEAD") return "main";
        if (command === "status --porcelain=v1 --untracked-files=all") return "";
        if (command === "check-ref-format --branch feature/existing") return "feature/existing";
        if (command === "show-ref --verify --hash refs/heads/feature/existing") return HEAD;
        throw new Error(`Unexpected git call: ${command}`);
      }
    });

    await expect(service.createBranch({
      repo_id: "fixture",
      branch: "feature/existing",
      expected_source_branch: "main",
      expected_head_sha: HEAD,
      dry_run: false
    })).rejects.toMatchObject({ code: "GIT_BRANCH_EXISTS" });
    expect(calls.some((args) => args[0] === "switch")).toBe(false);
  });

  test("rejects any remote other than origin before invoking git", async () => {
    let invoked = false;
    const service = new RemoteGitService("/repo", pushPolicy(), {
      git_runner: async () => {
        invoked = true;
        return "";
      }
    });

    await expect(service.push({
      repo_id: "fixture",
      remote: "upstream",
      expected_branch: "feature/demo",
      expected_head_sha: HEAD,
      set_upstream: true,
      dry_run: true
    })).rejects.toMatchObject({ code: "GIT_REMOTE_NOT_ALLOWED" });
    expect(invoked).toBe(false);
  });

  test("blocks direct push to main and master", async () => {
    for (const branch of ["main", "master"]) {
      const service = new RemoteGitService("/repo", pushPolicy(), {
        git_runner: fakeLocalGit(branch)
      });

      await expect(service.push({
        repo_id: "fixture",
        remote: "origin",
        expected_branch: branch,
        expected_head_sha: HEAD,
        set_upstream: true,
        dry_run: true
      })).rejects.toMatchObject({ code: "GIT_DIRECT_BASE_PUSH_BLOCKED" });
    }
  });

  test("pushes only the exact reviewed feature branch with fixed non-force arguments", async () => {
    const calls: string[][] = [];
    let remoteReads = 0;
    const service = new RemoteGitService("/repo", pushPolicy(), {
      git_runner: async (args) => {
        calls.push(args);
        const command = args.join(" ");
        if (command === "rev-parse HEAD") return HEAD;
        if (command === "symbolic-ref --quiet --short HEAD") return "feature/demo";
        if (command === "status --porcelain=v1 --untracked-files=all") return "";
        if (command === "check-ref-format --branch feature/demo") return "feature/demo";
        if (command === "remote get-url origin") return "https://github.com/acme/demo.git";
        if (command === "ls-remote --heads origin refs/heads/feature/demo") {
          remoteReads += 1;
          return remoteReads === 1 ? "" : `${HEAD}\trefs/heads/feature/demo`;
        }
        if (command === "push --porcelain --set-upstream origin refs/heads/feature/demo:refs/heads/feature/demo") return "ok";
        throw new Error(`Unexpected git call: ${command}`);
      }
    });

    const result = await service.push({
      repo_id: "fixture",
      remote: "origin",
      expected_branch: "feature/demo",
      expected_head_sha: HEAD,
      set_upstream: true,
      dry_run: false
    });

    expect(result).toMatchObject({
      pushed: true,
      branch: "feature/demo",
      head_sha: HEAD,
      remote_head_sha: HEAD,
      upstream: "origin/feature/demo"
    });
    const push = calls.find((args) => args[0] === "push");
    expect(push).toEqual([
      "push",
      "--porcelain",
      "--set-upstream",
      "origin",
      "refs/heads/feature/demo:refs/heads/feature/demo"
    ]);
    expect(push).not.toContain("--force");
    expect(push).not.toContain("--force-with-lease");
  });

  test("finds an existing head pull request and updates its base instead of creating a duplicate", async () => {
    const baseSha = "2".repeat(40);
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const service = new RemoteGitService("/repo", new OperationsPolicy({
      enabled: true,
      github_pull_request_enabled: true
    }), {
      env: { GPT_REPO_GITHUB_TOKEN: ["runtime", "fixture"].join("-") },
      git_runner: async (args) => {
        const command = args.join(" ");
        if (command === "rev-parse HEAD") return HEAD;
        if (command === "symbolic-ref --quiet --short HEAD") return "feature/demo";
        if (command === "status --porcelain=v1 --untracked-files=all") return "";
        if (command === "check-ref-format --branch feature/demo") return "feature/demo";
        if (command === "check-ref-format --branch main") return "main";
        if (command === "remote get-url origin") return "https://github.com/acme/demo.git";
        if (command === "ls-remote --heads origin refs/heads/feature/demo") return `${HEAD}\trefs/heads/feature/demo`;
        throw new Error(`Unexpected git call: ${command}`);
      },
      fetch_impl: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ url, method, ...(body === undefined ? {} : { body }) });
        if (method === "GET") {
          return jsonResponse([pullFixture({ title: "Old title", base: "develop", baseSha })]);
        }
        if (method === "PATCH") {
          return jsonResponse(pullFixture({ title: "New title", base: "main", baseSha }));
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      }
    });

    const result = await service.pullRequest({
      repo_id: "fixture",
      remote: "origin",
      expected_branch: "feature/demo",
      expected_head_sha: HEAD,
      base: "main",
      title: "New title",
      draft: false,
      dry_run: false
    });

    expect(result).toMatchObject({
      action: "updated",
      pull_request: { base_ref: "main" }
    });
    expect(requests[0]?.url).toContain("head=acme%3Afeature%2Fdemo");
    expect(requests[0]?.url).not.toContain("base=main");
    expect(requests[1]).toMatchObject({
      method: "PATCH",
      body: { title: "New title", base: "main" }
    });
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  test("rejects a changed pull request head before checks or merge are requested", async () => {
    const reviewedHead = "3".repeat(40);
    const actualHead = "4".repeat(40);
    let requestCount = 0;
    const service = new RemoteGitService("/repo", new OperationsPolicy({
      enabled: true,
      github_merge_enabled: true
    }), {
      env: { GPT_REPO_GITHUB_TOKEN: ["runtime", "fixture"].join("-") },
      git_runner: async (args) => {
        const command = args.join(" ");
        if (command === "rev-parse HEAD") return HEAD;
        if (command === "symbolic-ref --quiet --short HEAD") return "feature/demo";
        if (command === "status --porcelain=v1 --untracked-files=all") return "";
        if (command === "remote get-url origin") return "https://github.com/acme/demo.git";
        throw new Error(`Unexpected git call: ${command}`);
      },
      fetch_impl: async () => {
        requestCount += 1;
        return jsonResponse(pullFixture({ headSha: actualHead }));
      }
    });

    await expect(service.mergePullRequest({
      repo_id: "fixture",
      remote: "origin",
      pull_number: 7,
      expected_head_sha: HEAD,
      expected_pull_head_sha: reviewedHead,
      owner_approved: true,
      merge_method: "squash",
      require_checks_passed: true,
      sync_local_base: true,
      dry_run: false
    })).rejects.toMatchObject({ code: "GITHUB_PR_HEAD_MISMATCH" });
    expect(requestCount).toBe(1);
  });

  test("fails closed when one GitHub check source cannot be read", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const service = new RemoteGitService("/repo", new OperationsPolicy({
      enabled: true,
      github_merge_enabled: true
    }), {
      env: { GPT_REPO_GITHUB_TOKEN: ["runtime", "fixture"].join("-") },
      git_runner: async (args) => {
        const command = args.join(" ");
        if (command === "rev-parse HEAD") return HEAD;
        if (command === "symbolic-ref --quiet --short HEAD") return "feature/demo";
        if (command === "status --porcelain=v1 --untracked-files=all") return "";
        if (command === "remote get-url origin") return "https://github.com/acme/demo.git";
        throw new Error(`Unexpected git call: ${command}`);
      },
      fetch_impl: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({ url, method });
        if (url.endsWith("/pulls/7")) return jsonResponse(pullFixture());
        if (url.includes("/check-runs")) {
          return new Response(JSON.stringify({ message: "Resource not accessible" }), {
            status: 403,
            headers: { "content-type": "application/json" }
          });
        }
        if (url.includes("/status")) {
          return jsonResponse({
            state: "success",
            statuses: [{ context: "legacy-ci", state: "success", target_url: null }]
          });
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      }
    });

    await expect(service.mergePullRequest({
      repo_id: "fixture",
      remote: "origin",
      pull_number: 7,
      expected_head_sha: HEAD,
      expected_pull_head_sha: HEAD,
      owner_approved: true,
      merge_method: "squash",
      require_checks_passed: true,
      sync_local_base: true,
      dry_run: false
    })).rejects.toMatchObject({ code: "GITHUB_CHECKS_NOT_PASSED" });
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });

  test("merge input requires explicit owner approval", () => {
    const withoutApproval = MergePullRequestInputSchema.safeParse({
      repo_id: "fixture",
      pull_number: 12,
      expected_head_sha: HEAD,
      expected_pull_head_sha: HEAD
    });
    expect(withoutApproval.success).toBe(false);

    const approved = MergePullRequestInputSchema.safeParse({
      repo_id: "fixture",
      pull_number: 12,
      expected_head_sha: HEAD,
      expected_pull_head_sha: HEAD,
      owner_approved: true
    });
    expect(approved.success).toBe(true);
  });
});

function pullFixture(options: { title?: string; base?: string; baseSha?: string; headSha?: string } = {}) {
  return {
    number: 7,
    title: options.title ?? "Fixture PR",
    state: "open",
    draft: false,
    html_url: "https://github.com/acme/demo/pull/7",
    head: { ref: "feature/demo", sha: options.headSha ?? HEAD },
    base: { ref: options.base ?? "main", sha: options.baseSha ?? "2".repeat(40) },
    mergeable: true,
    mergeable_state: "clean",
    merged: false,
    body: null
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function expectRepoError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

function branchPolicy(): OperationsPolicy {
  return new OperationsPolicy({ enabled: true, git_branch_enabled: true });
}

function pushPolicy(): OperationsPolicy {
  return new OperationsPolicy({ enabled: true, git_push_enabled: true });
}

function fakeLocalGit(branch: string) {
  return async (args: string[]): Promise<string> => {
    const command = args.join(" ");
    if (command === "rev-parse HEAD") return HEAD;
    if (command === "symbolic-ref --quiet --short HEAD") return branch;
    if (command === "status --porcelain=v1 --untracked-files=all") return "";
    throw new RepoReaderError("GIT_ERROR", `Unexpected git call: ${command}`);
  };
}
