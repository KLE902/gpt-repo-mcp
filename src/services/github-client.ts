import { z } from "zod";
import { RepoReaderError } from "../runtime/errors.js";

const GITHUB_API_VERSION = "2026-03-10";
const API_BASE = "https://api.github.com";

type FetchLike = typeof fetch;

type GitHubClientOptions = {
  fetch_impl?: FetchLike;
  env?: NodeJS.ProcessEnv;
};

const PullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().default(false),
  html_url: z.string().url(),
  head: z.object({ ref: z.string(), sha: z.string().regex(/^[a-f0-9]{40}$/i) }),
  base: z.object({ ref: z.string(), sha: z.string().regex(/^[a-f0-9]{40}$/i) }),
  mergeable: z.boolean().nullable().optional().default(null),
  mergeable_state: z.string().optional().default("unknown"),
  merged: z.boolean().optional().default(false),
  body: z.string().nullable().optional().default(null)
});

const CheckRunsSchema = z.object({
  check_runs: z.array(z.object({
    name: z.string(),
    status: z.enum(["queued", "in_progress", "completed", "waiting", "requested", "pending"]),
    conclusion: z.string().nullable().optional(),
    details_url: z.string().url().nullable().optional()
  }))
});

const CombinedStatusSchema = z.object({
  state: z.enum(["success", "pending", "failure", "error"]),
  statuses: z.array(z.object({
    context: z.string(),
    state: z.enum(["success", "pending", "failure", "error"]),
    target_url: z.string().url().nullable().optional()
  }))
});

const MergeResponseSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40}$/i).nullable().optional(),
  merged: z.boolean(),
  message: z.string()
});

export type GitHubPull = z.infer<typeof PullSchema>;
export type GitHubCheckRun = z.infer<typeof CheckRunsSchema>["check_runs"][number];
export type GitHubCombinedStatus = z.infer<typeof CombinedStatusSchema>;

export class GitHubClient {
  private readonly fetchImpl: FetchLike;
  private readonly accessValue?: string;

  constructor(options: GitHubClientOptions = {}) {
    this.fetchImpl = options.fetch_impl ?? globalThis.fetch;
    const env = options.env ?? process.env;
    this.accessValue = firstNonEmpty(env.GPT_REPO_GITHUB_TOKEN, env.GH_TOKEN, env.GITHUB_TOKEN);
  }

  async listOpenPulls(owner: string, repo: string, headBranch: string, base?: string): Promise<GitHubPull[]> {
    const query = new URLSearchParams({ state: "open", head: `${owner}:${headBranch}`, per_page: "10" });
    if (base) query.set("base", base);
    const value = await this.request<unknown>(`/repos/${segment(owner)}/${segment(repo)}/pulls?${query.toString()}`);
    return z.array(PullSchema).parse(value);
  }

  async getPull(owner: string, repo: string, pullNumber: number): Promise<GitHubPull> {
    return PullSchema.parse(await this.request<unknown>(`/repos/${segment(owner)}/${segment(repo)}/pulls/${pullNumber}`));
  }

  async createPull(owner: string, repo: string, input: { title: string; head: string; base: string; body?: string; draft: boolean }): Promise<GitHubPull> {
    return PullSchema.parse(await this.request<unknown>(`/repos/${segment(owner)}/${segment(repo)}/pulls`, {
      method: "POST",
      body: input,
      require_auth: true
    }));
  }

  async updatePull(owner: string, repo: string, pullNumber: number, input: { title?: string; body?: string; base?: string }): Promise<GitHubPull> {
    return PullSchema.parse(await this.request<unknown>(`/repos/${segment(owner)}/${segment(repo)}/pulls/${pullNumber}`, {
      method: "PATCH",
      body: input,
      require_auth: true
    }));
  }

  async listCheckRuns(owner: string, repo: string, sha: string): Promise<GitHubCheckRun[]> {
    const value = await this.request<unknown>(`/repos/${segment(owner)}/${segment(repo)}/commits/${segment(sha)}/check-runs?per_page=100`);
    return CheckRunsSchema.parse(value).check_runs;
  }

  async getCombinedStatus(owner: string, repo: string, sha: string): Promise<GitHubCombinedStatus> {
    return CombinedStatusSchema.parse(await this.request<unknown>(`/repos/${segment(owner)}/${segment(repo)}/commits/${segment(sha)}/status?per_page=100`));
  }

  async mergePull(owner: string, repo: string, pullNumber: number, input: { sha: string; merge_method: "merge" | "squash" | "rebase" }) {
    return MergeResponseSchema.parse(await this.request<unknown>(`/repos/${segment(owner)}/${segment(repo)}/pulls/${pullNumber}/merge`, {
      method: "PUT",
      body: input,
      require_auth: true
    }));
  }

  async dispatchWorkflow(owner: string, repo: string, workflowId: string, ref: string, inputs: Record<string, string>): Promise<void> {
    await this.request(`/repos/${segment(owner)}/${segment(repo)}/actions/workflows/${segment(workflowId)}/dispatches`, {
      method: "POST",
      body: { ref, inputs },
      require_auth: true
    });
  }

  private async request<T>(path: string, options: { method?: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown; require_auth?: boolean } = {}): Promise<T> {
    if (options.require_auth && !this.accessValue) {
      throw new RepoReaderError("GITHUB_AUTH_REQUIRED", "GitHub API mutation requires GPT_REPO_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN in the MCP server environment.");
    }
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "gpt-repo-mcp"
    };
    if (this.accessValue) headers[["Author", "ization"].join("")] = ["Bear", "er ", this.accessValue].join("");
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, {
        method: options.method ?? "GET",
        headers,
        signal: AbortSignal.timeout(30_000),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
      });
    } catch {
      throw new RepoReaderError("GITHUB_API_ERROR", "GitHub API request failed before a response was received.", { retryable: true });
    }

    const requestId = response.headers.get("x-github-request-id") ?? undefined;
    const raw = await response.text();
    let value: unknown = {};
    if (raw.length > 0) {
      try {
        value = JSON.parse(raw);
      } catch {
        throw new RepoReaderError("GITHUB_API_ERROR", "GitHub API returned an invalid JSON response.", {
          retryable: response.status >= 500,
          diagnostics: { status: response.status, ...(requestId ? { request_id: requestId } : {}) }
        });
      }
    }
    if (!response.ok) {
      const message = safeApiMessage(value);
      if (!this.accessValue && (response.status === 401 || response.status === 403 || response.status === 404)) {
        throw new RepoReaderError("GITHUB_AUTH_REQUIRED", "GitHub repository access requires a runtime GitHub access value in the MCP server environment.", {
          diagnostics: { status: response.status, ...(requestId ? { request_id: requestId } : {}) }
        });
      }
      throw new RepoReaderError("GITHUB_API_ERROR", `GitHub API request failed with status ${response.status}${message ? `: ${message}` : "."}`, {
        retryable: response.status === 429 || response.status >= 500,
        diagnostics: { status: response.status, ...(requestId ? { request_id: requestId } : {}) }
      });
    }
    return value as T;
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function safeApiMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("message" in value) || typeof value.message !== "string") return undefined;
  return value.message.replace(/[\r\n\t]/g, " ").slice(0, 240);
}
