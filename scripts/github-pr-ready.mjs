import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const PR_FIELDS = "number,state,isDraft,headRefName,headRefOid,baseRefName,url,statusCheckRollup";

export async function readyCurrentPullRequest(options = {}) {
  const cwd = options.cwd ?? globalThis.process.cwd();
  const runCommand = options.runCommand ?? executeFile;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolveSleep) => globalThis.setTimeout(resolveSleep, milliseconds)));
  const waitForChecksMs = options.waitForChecksMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;

  const head = outputOf(await runCommand("git", ["rev-parse", "HEAD"], { cwd })).toLowerCase();
  if (!SHA_PATTERN.test(head)) {
    throw operationError("INVALID_LOCAL_HEAD", "Git did not return an exact 40-character HEAD SHA.");
  }

  const initialStatus = outputOf(await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=normal"], { cwd }));
  if (initialStatus !== "") {
    throw operationError("WORKTREE_NOT_CLEAN", "The worktree must be clean before a pull request can be marked ready.");
  }

  const branch = outputOf(await runCommand("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd }));
  if (!branch) {
    throw operationError("DETACHED_HEAD", "A named feature branch is required.");
  }
  if (branch === "main" || branch === "master") {
    throw operationError("BASE_BRANCH_NOT_ALLOWED", "A base branch cannot be marked ready for review.");
  }

  const remoteUrl = outputOf(await runCommand("git", ["remote", "get-url", "origin"], { cwd }));
  const repository = parseGitHubRepository(remoteUrl);
  let pullRequest = await readPullRequest(runCommand, cwd, repository, branch);
  validatePullRequest(pullRequest, branch, head);

  const wasDraft = pullRequest.isDraft;
  if (wasDraft) {
    await runCommand("gh", ["pr", "ready", String(pullRequest.number), "--repo", repository], { cwd });
    pullRequest = await readPullRequest(runCommand, cwd, repository, String(pullRequest.number));
    validatePullRequest(pullRequest, branch, head);
    if (pullRequest.isDraft) {
      throw operationError("PULL_READY_VERIFICATION_FAILED", "GitHub still reports the pull request as draft after gh pr ready completed.");
    }
  }

  if (wasDraft && checkCount(pullRequest) === 0 && waitForChecksMs > 0) {
    const deadline = Date.now() + waitForChecksMs;
    while (checkCount(pullRequest) === 0 && Date.now() < deadline) {
      await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
      pullRequest = await readPullRequest(runCommand, cwd, repository, String(pullRequest.number));
      validatePullRequest(pullRequest, branch, head);
      if (pullRequest.isDraft) {
        throw operationError("PULL_READY_VERIFICATION_FAILED", "GitHub reverted or retained the pull request draft state.");
      }
    }
  }

  const finalHead = outputOf(await runCommand("git", ["rev-parse", "HEAD"], { cwd })).toLowerCase();
  if (finalHead !== head) {
    throw operationError("LOCAL_HEAD_CHANGED", "Repository HEAD changed while the pull request was being marked ready.");
  }
  const finalStatus = outputOf(await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=normal"], { cwd }));
  if (finalStatus !== "") {
    throw operationError("WORKTREE_CHANGED", "The worktree changed while the pull request was being marked ready.");
  }

  const checksTotal = checkCount(pullRequest);
  return {
    ok: true,
    action: wasDraft ? "marked_ready" : "unchanged",
    repository,
    pull_number: pullRequest.number,
    pull_url: pullRequest.url,
    branch,
    base_branch: pullRequest.baseRefName,
    head_sha: head,
    state: pullRequest.state,
    draft: pullRequest.isDraft,
    checks_total: checksTotal,
    checks_registered: checksTotal > 0,
    warnings: checksTotal > 0 ? [] : ["NO_CHECKS_REGISTERED_YET"]
  };
}

export function parseGitHubRepository(remoteUrl) {
  const value = String(remoteUrl ?? "").trim();
  const scpMatch = /^git@github\.com:([^/]+)\/(.+)$/i.exec(value);
  if (scpMatch) {
    return normalizeRepository(scpMatch[1], scpMatch[2]);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw operationError("GITHUB_REMOTE_REQUIRED", "The origin remote must be a GitHub.com HTTPS or SSH URL.");
  }
  if (parsed.hostname.toLowerCase() !== "github.com") {
    throw operationError("GITHUB_REMOTE_REQUIRED", "The origin remote must target GitHub.com.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") {
    throw operationError("GITHUB_REMOTE_REQUIRED", "The origin remote must use GitHub HTTPS or SSH.");
  }
  if (parsed.password || (parsed.username && !(parsed.protocol === "ssh:" && parsed.username === "git"))) {
    throw operationError("GITHUB_REMOTE_CREDENTIALS_REJECTED", "Embedded remote credentials are not allowed.");
  }
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.length !== 2) {
    throw operationError("GITHUB_REMOTE_REQUIRED", "The origin remote must identify one GitHub owner and repository.");
  }
  return normalizeRepository(segments[0], segments[1]);
}

async function readPullRequest(runCommand, cwd, repository, selector) {
  const result = await runCommand("gh", ["pr", "view", selector, "--repo", repository, "--json", PR_FIELDS], { cwd });
  let value;
  try {
    value = JSON.parse(String(result.stdout ?? ""));
  } catch {
    throw operationError("PULL_RESPONSE_INVALID", "GitHub CLI returned invalid pull-request JSON.");
  }
  if (!value || typeof value !== "object" || !Number.isInteger(value.number) || value.number <= 0) {
    throw operationError("PULL_RESPONSE_INVALID", "GitHub CLI returned an incomplete pull-request response.");
  }
  return {
    number: value.number,
    state: String(value.state ?? "").toUpperCase(),
    isDraft: Boolean(value.isDraft),
    headRefName: String(value.headRefName ?? ""),
    headRefOid: String(value.headRefOid ?? "").toLowerCase(),
    baseRefName: String(value.baseRefName ?? ""),
    url: String(value.url ?? ""),
    statusCheckRollup: Array.isArray(value.statusCheckRollup) ? value.statusCheckRollup : []
  };
}

function validatePullRequest(pullRequest, branch, head) {
  if (pullRequest.state !== "OPEN") {
    throw operationError("PULL_NOT_OPEN", "The current branch pull request is not open.");
  }
  if (pullRequest.headRefName !== branch) {
    throw operationError("PULL_BRANCH_MISMATCH", "GitHub pull-request head branch does not match the current local branch.");
  }
  if (pullRequest.headRefOid !== head) {
    throw operationError("PULL_HEAD_MISMATCH", "GitHub pull-request head SHA does not match the current local HEAD.");
  }
}

function normalizeRepository(owner, name) {
  const normalizedOwner = String(owner).trim();
  const normalizedName = String(name).trim().replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9-]+$/.test(normalizedOwner) || !/^[A-Za-z0-9._-]+$/.test(normalizedName)) {
    throw operationError("GITHUB_REMOTE_REQUIRED", "The origin remote contains an invalid GitHub owner or repository name.");
  }
  return `${normalizedOwner}/${normalizedName}`;
}

function checkCount(pullRequest) {
  return Array.isArray(pullRequest.statusCheckRollup) ? pullRequest.statusCheckRollup.length : 0;
}

function outputOf(result) {
  return String(result?.stdout ?? "").trim();
}

function executeFile(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1_048_576,
      windowsHide: true,
      shell: false
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = error;
        rejectCommand(operationError("COMMAND_FAILED", `${command} failed.`, {
          exit_code: typeof detail.code === "number" ? detail.code : null,
          stderr: String(stderr ?? "").slice(-4096)
        }));
        return;
      }
      resolveCommand({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function operationError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

const invokedPath = globalThis.process.argv[1]
  ? pathToFileURL(resolve(globalThis.process.argv[1])).href
  : "";

if (import.meta.url === invokedPath) {
  readyCurrentPullRequest()
    .then((result) => {
      globalThis.console.log(JSON.stringify(result));
    })
    .catch((error) => {
      globalThis.console.error(JSON.stringify({
        ok: false,
        error: {
          code: typeof error?.code === "string" ? error.code : "UNEXPECTED_ERROR",
          message: error instanceof Error ? error.message : "Unexpected failure while marking the pull request ready.",
          ...(error?.details === undefined ? {} : { details: error.details })
        }
      }));
      globalThis.process.exitCode = 1;
    });
}
