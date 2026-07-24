import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { RepoReaderError } from "../runtime/errors.js";
import {
  ATO001_BRANCH,
  ATO001_CONTEXT,
  ATO001_CONTEXT_AGGREGATE_SHA256,
  ATO001_HEAD,
  ato001ContextIdentityText
} from "./ato-001-claude-profile.js";

const execFileAsync = promisify(execFile);
const EXPECTED_ORIGIN = "https://github.com/KLE902/Premium-Komga-Reader.git";

export type Ato001RepositoryEvidence = {
  repository_root: string;
  origin: string;
  branch: string;
  head: string;
  clean: true;
  origin_synchronized: true;
  context: Array<{ path: string; sha256: string }>;
  context_aggregate_sha256: string;
};

export type Ato001RepositoryVerifierDependencies = {
  git?: (args: string[]) => Promise<string>;
  readBytes?: (absolutePath: string) => Promise<Buffer>;
  canonicalize?: (path: string) => Promise<string>;
  hashBytes?: (bytes: Buffer) => string;
};

export class Ato001RepositoryVerifier {
  private readonly git: (args: string[]) => Promise<string>;
  private readonly readBytes: (absolutePath: string) => Promise<Buffer>;
  private readonly canonicalize: (path: string) => Promise<string>;
  private readonly hashBytes: (bytes: Buffer) => string;

  constructor(
    private readonly repoRoot: string,
    dependencies: Ato001RepositoryVerifierDependencies = {}
  ) {
    this.git = dependencies.git ?? ((args) => runGit(repoRoot, args));
    this.readBytes = dependencies.readBytes ?? readFile;
    this.canonicalize = dependencies.canonicalize ?? realpath;
    this.hashBytes = dependencies.hashBytes ?? ((bytes) => createHash("sha256").update(bytes).digest("hex"));
  }

  async verify(): Promise<Ato001RepositoryEvidence> {
    const [configuredRoot, gitRoot] = await Promise.all([
      this.canonicalize(this.repoRoot),
      this.git(["rev-parse", "--show-toplevel"]).then((value) => this.canonicalize(value))
    ]);
    if (normalizePath(configuredRoot) !== normalizePath(gitRoot) || basename(configuredRoot).toLowerCase() !== "premium-komga-reader") {
      throw new RepoReaderError("ATO001_REPOSITORY_MISMATCH", "The approved premium-komga-reader repository identity could not be verified.");
    }

    const origin = await this.git(["remote", "get-url", "origin"]);
    if (normalizeOrigin(origin) !== normalizeOrigin(EXPECTED_ORIGIN)) {
      throw new RepoReaderError("ATO001_REPOSITORY_MISMATCH", "The PKR origin does not match the fixed ATO-001 repository identity.");
    }
    const branch = await this.git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (branch !== ATO001_BRANCH) {
      throw new RepoReaderError("ATO001_REPOSITORY_DRIFT", `ATO-001 requires branch ${ATO001_BRANCH}.`);
    }
    const head = await this.git(["rev-parse", "HEAD"]);
    if (head !== ATO001_HEAD) {
      throw new RepoReaderError("ATO001_REPOSITORY_DRIFT", "PKR HEAD does not match the fixed ATO-001 commit.");
    }
    const status = await this.git(["status", "--porcelain=v1", "--untracked-files=normal"]);
    if (status !== "") {
      throw new RepoReaderError("ATO001_REPOSITORY_DRIFT", "ATO-001 requires a clean PKR index and worktree.");
    }
    const originHead = await this.git(["rev-parse", `refs/remotes/origin/${ATO001_BRANCH}`]);
    if (originHead !== ATO001_HEAD) {
      throw new RepoReaderError("ATO001_ORIGIN_DIVERGED", "The locally available origin/master identity is not synchronized with the fixed ATO-001 HEAD.");
    }

    const context = [];
    for (const [path, expected] of ATO001_CONTEXT) {
      let bytes: Buffer;
      try {
        bytes = await this.readBytes(resolve(configuredRoot, ...path.split("/")));
      } catch {
        throw new RepoReaderError("ATO001_CONTEXT_DRIFT", `Required ATO-001 context file is missing: ${path}`);
      }
      const actual = this.hashBytes(bytes);
      if (actual !== expected) {
        throw new RepoReaderError("ATO001_CONTEXT_DRIFT", `ATO-001 context hash mismatch: ${path}`);
      }
      context.push({ path, sha256: actual });
    }
    const aggregate = createHash("sha256").update(ato001ContextIdentityText()).digest("hex");
    if (aggregate !== ATO001_CONTEXT_AGGREGATE_SHA256) {
      throw new RepoReaderError("ATO001_CONTEXT_IDENTITY_INVALID", "The MCP-owned aggregate ATO-001 context identity is invalid.");
    }
    return {
      repository_root: configuredRoot,
      origin,
      branch,
      head,
      clean: true,
      origin_synchronized: true,
      context,
      context_aggregate_sha256: aggregate
    };
  }
}

async function runGit(root: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: root,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1_048_576,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" }
    });
    return result.stdout.trim();
  } catch {
    throw new RepoReaderError("ATO001_GIT_VERIFICATION_FAILED", "A fixed ATO-001 Git verification command failed.");
  }
}

function normalizePath(value: string): string {
  return resolve(value).replaceAll("\\", "/").toLowerCase();
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\.git$/i, "").replace(/^git@github\.com:/i, "https://github.com/").toLowerCase();
}
