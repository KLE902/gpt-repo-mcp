import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { RepoReaderError } from "../runtime/errors.js";

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const PR_FIELDS = "number,title,state,isDraft,url,headRefName,headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus,mergedAt,body";

type CommandRunner = (args: string[]) => Promise<string>;

const GhPullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.string(),
  isDraft: z.boolean().default(false),
  url: z.string().url(),
  headRefName: z.string().min(1),
  headRefOid: z.string().regex(SHA_PATTERN),
  baseRefName: z.string().min(1),
  baseRefOid: z.string().regex(SHA_PATTERN),
  mergeable: z.string().optional().default("UNKNOWN"),
  mergeStateStatus: z.string().optional().default("UNKNOWN"),
  mergedAt: z.string().datetime().nullable().optional().default(null),
  body: z.string().nullable().optional().default(null)
});

export type GitHubCliPull = z.infer<typeof GhPullSchema>;

export class GitHubCliService {
  private readonly runCommand: CommandRunner;

  constructor(private readonly root: string, runCommand?: CommandRunner) {
    this.runCommand = runCommand ?? (async (args) => {
      try {
        const result = await execFileAsync("gh", args, {
          cwd: this.root,
          env: process.env,
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          timeout: 30_000,
          windowsHide: true
        });
        return String(result.stdout);
      } catch (error) {
        const detail = error as { code?: string | number };
        throw new RepoReaderError("GITHUB_CLI_ERROR", "GitHub CLI operation failed.", {
          retryable: detail.code === "ETIMEDOUT" || detail.code === "ECONNRESET"
        });
      }
    });
  }

  async listPulls(repository: string, input: { state: "open" | "closed" | "all"; head?: string; base?: string; limit: number }): Promise<GitHubCliPull[]> {
    const args = ["pr", "list", "--repo", repository, "--state", input.state, "--limit", String(input.limit), "--json", PR_FIELDS];
    if (input.head) args.push("--head", input.head);
    if (input.base) args.push("--base", input.base);
    const value = parseJson(await this.runCommand(args), "GitHub CLI returned invalid pull-request list JSON.");
    return z.array(GhPullSchema).parse(value);
  }

  async viewPull(repository: string, pullNumber: number): Promise<GitHubCliPull> {
    const value = parseJson(
      await this.runCommand(["pr", "view", String(pullNumber), "--repo", repository, "--json", PR_FIELDS]),
      "GitHub CLI returned invalid pull-request JSON."
    );
    return GhPullSchema.parse(value);
  }

  async closePull(repository: string, pullNumber: number, comment?: string): Promise<void> {
    const args = ["pr", "close", String(pullNumber), "--repo", repository];
    if (comment) args.push("--comment", comment);
    await this.runCommand(args);
  }
}

function parseJson(raw: string, message: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new RepoReaderError("GITHUB_CLI_RESPONSE_INVALID", message);
  }
}
