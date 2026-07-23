import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildClaudeEnvironment,
  executeCommand,
  resolveCliCommand
} from "./agent-cli-probe.mjs";

const RUN_ID = "2026-07-23T023346Z-pkr-003-keyboard-context-actions-executor-r2";
const BRANCH = "feat/pkr-003-multiagent-pilot";
const BASE_SHA = "08e5c5eaa631beca05b2df6e82e2286443c162f3";
const START_SHA = "2fddc4ea5ccfe4058c4998c9cd9114c8a62a832e";
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const PROMPT_RELATIVE = `.chatgpt/codex-runs/${RUN_ID}/PROMPT.md`;
const RESULT_RELATIVE = `.chatgpt/codex-runs/${RUN_ID}/RESULT.md`;
const LOCAL_RUN_RELATIVE = `.pkr-runs/pkr-003-multiagent-pilot/${RUN_ID}`;
const MAX_DIFF_BYTES = 1_048_576;

export function isAllowedPkrPath(input) {
  const value = String(input ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!value || value.startsWith("/") || value.includes("../") || value.includes("\0")) return false;
  if ([
    "docs/premium-reference/capability-accessibility-matrix.md",
    "docs/multiagent-workflow/README.md",
    "docs/multiagent-workflow/pilots/PKR-003.md",
    "DEVELOPMENT_BACKLOG.md",
    "FEATURES.md",
    "CHANGELOG.md",
    "PROJECT_STATE.md"
  ].includes(value)) return true;
  return [
    "app/src/main/",
    "app/src/test/",
    "app/src/testDebug/",
    "app/src/androidTest/"
  ].some((prefix) => value.startsWith(prefix)) && value.endsWith(".kt");
}

export function isAllowedCandidateCommitCount(count) {
  return Number.isInteger(count) && count >= 1 && count <= 3;
}

export function parseCodexResult(markdown) {
  const text = String(markdown ?? "");
  if (!text.includes("# CODEX_RESULT")) {
    throw pilotError("CODEX_RESULT_INVALID", "Codex RESULT.md is missing the CODEX_RESULT header.");
  }
  const readField = (name) => {
    const match = text.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m"));
    return match?.[1]?.trim() ?? null;
  };
  const parsed = {
    status: readField("status"),
    pilot_start_sha: readField("pilot_start_sha")?.toLowerCase() ?? null,
    candidate_sha: readField("candidate_sha")?.toLowerCase() ?? null,
    branch: readField("branch"),
    worktree_clean: readField("worktree_clean")
  };
  if (!parsed.status || !parsed.candidate_sha || !parsed.branch || !parsed.worktree_clean) {
    throw pilotError("CODEX_RESULT_INVALID", "Codex RESULT.md is missing required identity fields.");
  }
  return parsed;
}

export function reviewSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "status",
      "review_sha",
      "summary",
      "route",
      "findings",
      "acceptance_criteria",
      "worktree_assessment"
    ],
    properties: {
      status: { enum: ["ACCEPTED", "REWORK_REQUIRED", "BLOCKED"] },
      review_sha: { type: "string", pattern: "^[a-f0-9]{40}$" },
      summary: { type: "string", minLength: 1 },
      route: { type: "string", minLength: 1 },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["classification", "title", "evidence", "required_action"],
          properties: {
            classification: {
              enum: ["blocking_defect", "non_blocking_defect", "risk", "optional_improvement"]
            },
            title: { type: "string", minLength: 1 },
            evidence: { type: "string", minLength: 1 },
            required_action: { type: "string", minLength: 1 }
          }
        }
      },
      acceptance_criteria: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterion", "assessment", "evidence"],
          properties: {
            criterion: { type: "string", minLength: 1 },
            assessment: { enum: ["pass", "fail", "not_verified"] },
            evidence: { type: "string", minLength: 1 }
          }
        }
      },
      worktree_assessment: {
        type: "object",
        additionalProperties: false,
        required: ["head_verified", "read_only_observed", "notes"],
        properties: {
          head_verified: { type: "boolean" },
          read_only_observed: { type: "boolean" },
          notes: { type: "string", minLength: 1 }
        }
      }
    }
  };
}

export function extractClaudeStructuredResult(stdout) {
  let outer;
  try {
    outer = JSON.parse(String(stdout ?? "").trim());
  } catch {
    throw pilotError("CLAUDE_OUTPUT_INVALID", "Claude returned invalid outer JSON.");
  }
  if (outer?.is_error === true || String(outer?.subtype ?? "").startsWith("error")) {
    throw pilotError("CLAUDE_PROVIDER_ERROR", "Claude returned a provider error result.");
  }
  if (outer?.structured_output && typeof outer.structured_output === "object") return outer.structured_output;
  if (outer?.result && typeof outer.result === "object") return outer.result;
  const raw = String(outer?.result ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!raw) throw pilotError("CLAUDE_OUTPUT_MISSING", "Claude returned no structured review result.");
  try {
    return JSON.parse(raw);
  } catch {
    throw pilotError("CLAUDE_OUTPUT_INVALID", "Claude result did not contain valid structured JSON.");
  }
}

export function validateReviewResult(result, expectedSha) {
  if (!result || typeof result !== "object") {
    throw pilotError("CLAUDE_REVIEW_INVALID", "Claude review result is not an object.");
  }
  if (!["ACCEPTED", "REWORK_REQUIRED", "BLOCKED"].includes(result.status)) {
    throw pilotError("CLAUDE_REVIEW_INVALID", "Claude review status is invalid.");
  }
  if (String(result.review_sha ?? "").toLowerCase() !== expectedSha) {
    throw pilotError("CLAUDE_REVIEW_SHA_MISMATCH", "Claude review is not tied to the exact candidate SHA.");
  }
  if (!Array.isArray(result.findings) || !Array.isArray(result.acceptance_criteria)) {
    throw pilotError("CLAUDE_REVIEW_INVALID", "Claude review is missing findings or acceptance criteria arrays.");
  }
  return result;
}

async function runGit(cwd, args, options = {}) {
  const result = await executeCommand("git", args, {
    cwd,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxOutputBytes: options.maxOutputBytes ?? 262_144
  });
  requireSuccess(result, "GIT_COMMAND_FAILED", `git ${args[0]} failed.`);
  return String(result.stdout ?? "");
}

async function readRepositoryState(cwd) {
  const root = resolve((await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim());
  if (root.toLowerCase() !== resolve(cwd).toLowerCase()) {
    throw pilotError("REPOSITORY_ROOT_MISMATCH", "Pilot runner must execute from the exact repository root.");
  }
  const head = (await runGit(cwd, ["rev-parse", "HEAD"])).trim().toLowerCase();
  const branch = (await runGit(cwd, ["branch", "--show-current"])).trim();
  const status = (await runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=normal"], {
    maxOutputBytes: 524_288
  })).trim();
  if (!SHA_PATTERN.test(head)) throw pilotError("HEAD_INVALID", "Git returned an invalid HEAD SHA.");
  return { root, head, branch, status, clean: status === "" };
}

async function readRemoteHead(cwd) {
  const output = (await runGit(cwd, ["ls-remote", "--heads", "origin", `refs/heads/${BRANCH}`], {
    timeoutMs: 60_000
  })).trim();
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw pilotError("REMOTE_BRANCH_INVALID", "Expected one exact remote pilot branch.");
  const sha = lines[0].split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!SHA_PATTERN.test(sha)) throw pilotError("REMOTE_HEAD_INVALID", "Remote pilot branch returned an invalid SHA.");
  return sha;
}

async function changedPaths(cwd, fromSha, toSha) {
  const output = await runGit(cwd, ["diff", "--name-only", `${fromSha}..${toSha}`], {
    maxOutputBytes: 524_288
  });
  return output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

async function validateCandidate(cwd, candidateSha) {
  if (!SHA_PATTERN.test(candidateSha)) throw pilotError("CANDIDATE_SHA_INVALID", "Candidate SHA is invalid.");
  const ancestry = await executeCommand("git", ["merge-base", "--is-ancestor", START_SHA, candidateSha], {
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 65_536
  });
  if (ancestry.exitCode !== 0 || ancestry.timedOut || ancestry.truncated || ancestry.complete === false) {
    throw pilotError("CANDIDATE_ANCESTRY_INVALID", "Candidate is not an append-only descendant of the exact pilot start SHA.");
  }
  const count = Number((await runGit(cwd, ["rev-list", "--count", `${START_SHA}..${candidateSha}`])).trim());
  if (!isAllowedCandidateCommitCount(count)) {
    throw pilotError("CANDIDATE_COMMIT_COUNT_INVALID", "Pilot candidate must contain one to three append-only commits.", { count });
  }
  const paths = await changedPaths(cwd, START_SHA, candidateSha);
  if (paths.length === 0) throw pilotError("CANDIDATE_DIFF_EMPTY", "Candidate commit contains no tracked changes.");
  const disallowed = paths.filter((value) => !isAllowedPkrPath(value));
  if (disallowed.length > 0) {
    throw pilotError("CANDIDATE_PATH_OUT_OF_SCOPE", "Candidate commit changed paths outside the fixed pilot allowlist.", {
      paths: disallowed.slice(0, 30)
    });
  }
  return paths;
}

async function runExecutor(cwd) {
  const before = await readRepositoryState(cwd);
  if (before.branch !== BRANCH || before.head !== START_SHA || !before.clean) {
    throw pilotError("EXECUTOR_PREFLIGHT_FAILED", "Executor requires the exact clean pilot branch and start SHA.", before);
  }
  const remoteBefore = await readRemoteHead(cwd);
  if (remoteBefore !== START_SHA) {
    throw pilotError("REMOTE_START_MISMATCH", "Remote pilot branch does not match the exact executor start SHA.");
  }

  const promptPath = join(cwd, PROMPT_RELATIVE);
  const resultPath = join(cwd, RESULT_RELATIVE);
  if (!existsSync(promptPath)) throw pilotError("PROMPT_MISSING", "The fixed executor prompt is missing.");
  if (existsSync(resultPath)) throw pilotError("RESULT_ALREADY_EXISTS", "Executor result already exists; refusing ambiguous rerun.");
  const prompt = await readFile(promptPath, "utf8");
  if (!prompt.includes(RUN_ID) || !prompt.includes(START_SHA)) {
    throw pilotError("PROMPT_IDENTITY_INVALID", "Executor prompt does not match the fixed run identity.");
  }

  const localDir = join(cwd, LOCAL_RUN_RELATIVE, "executor");
  await mkdir(localDir, { recursive: true });
  const codex = await resolveCliCommand("codex", executeCommand, globalThis.process.platform);
  const help = await executeCommand(codex, ["exec", "--help"], {
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 262_144
  });
  requireSuccess(help, "CODEX_HELP_FAILED", "Codex exec help failed.");
  const helpText = String(help.stdout ?? "");
  const cdFlag = helpText.includes("--cd") ? "--cd" : /(^|\s)-C([,\s]|$)/m.test(helpText) ? "-C" : null;
  if (!cdFlag || !helpText.includes("--json") || !helpText.includes("--sandbox")) {
    throw pilotError("CODEX_CAPABILITY_MISSING", "Codex is missing required fixed executor capabilities.");
  }
  const args = ["exec", "--json", "--sandbox", "workspace-write", cdFlag, cwd];
  if (helpText.includes("--output-last-message")) {
    args.push("--output-last-message", join(localDir, "last-message.txt"));
  }
  args.push("-");

  const execution = await executeCommand(codex, args, {
    cwd,
    input: prompt,
    timeoutMs: 5_400_000,
    maxOutputBytes: 16_777_216
  });
  await writeFile(join(localDir, "stdout.jsonl"), String(execution.stdout ?? ""), "utf8");
  await writeFile(join(localDir, "stderr.log"), String(execution.stderr ?? ""), "utf8");
  requireSuccess(execution, "CODEX_EXECUTION_FAILED", "Codex executor did not complete cleanly.");

  const after = await readRepositoryState(cwd);
  if (after.branch !== BRANCH || !after.clean) {
    throw pilotError("EXECUTOR_POSTFLIGHT_FAILED", "Executor changed branch or left tracked worktree changes.", after);
  }
  if (after.head === START_SHA) throw pilotError("CANDIDATE_COMMIT_MISSING", "Codex did not create a candidate commit.");
  const paths = await validateCandidate(cwd, after.head);
  const remoteAfter = await readRemoteHead(cwd);
  if (remoteAfter !== remoteBefore) {
    throw pilotError("UNAUTHORIZED_REMOTE_MUTATION", "Remote pilot branch changed during executor run.");
  }
  if (!existsSync(resultPath)) throw pilotError("CODEX_RESULT_MISSING", "Codex did not write the required RESULT.md.");
  const result = parseCodexResult(await readFile(resultPath, "utf8"));
  if (result.status !== "ready_for_review" || result.pilot_start_sha !== START_SHA || result.candidate_sha !== after.head || result.branch !== BRANCH || result.worktree_clean !== "true") {
    throw pilotError("CODEX_RESULT_IDENTITY_MISMATCH", "Codex RESULT.md does not match verified Git state.", result);
  }

  return {
    ok: true,
    mode: "executor",
    run_id: RUN_ID,
    start_sha: START_SHA,
    candidate_sha: after.head,
    changed_paths: paths,
    remote_unchanged: true,
    worktree_clean: true,
    output_complete: execution.complete && !execution.truncated
  };
}

function buildReviewPrompt(candidateSha, paths, executorResult, diff) {
  return [
    "You are the independent read-only reviewer for the owner-approved PKR-003 controlled pilot.",
    `Review only candidate SHA ${candidateSha}, which is an append-only descendant of pilot start SHA ${START_SHA}.`,
    `The product baseline is ${BASE_SHA}.`,
    "Attempt to falsify the candidate against docs/multiagent-workflow/pilots/PKR-003.md, AGENTS.md, the actual code, tests, and the supplied executor evidence.",
    "Do not modify files. Do not run shell commands. Use only read/search tools. Do not create commits, branches, comments, or external effects.",
    "Classify each finding as blocking_defect, non_blocking_defect, risk, or optional_improvement.",
    "Return ACCEPTED only when no blocking or material actionable defect remains. Return REWORK_REQUIRED for bounded actionable findings. Return BLOCKED when review identity or evidence is unreliable.",
    "Every finding must cite exact file/behavior/test evidence. A zero-finding review is valid.",
    "",
    "Changed paths:",
    ...paths.map((value) => `- ${value}`),
    "",
    "Executor RESULT.md:",
    executorResult.slice(0, 65_536),
    "",
    `Verified diff ${START_SHA}..${candidateSha}:`,
    diff
  ].join("\n");
}

async function runReviewer(cwd) {
  const executorState = await readRepositoryState(cwd);
  if (executorState.branch !== BRANCH || !executorState.clean || executorState.head === START_SHA) {
    throw pilotError("REVIEW_PREFLIGHT_FAILED", "Reviewer requires the clean executor branch at a candidate commit.", executorState);
  }
  const resultPath = join(cwd, RESULT_RELATIVE);
  if (!existsSync(resultPath)) throw pilotError("CODEX_RESULT_MISSING", "Reviewer requires the executor RESULT.md.");
  const executorResultText = await readFile(resultPath, "utf8");
  const executorResult = parseCodexResult(executorResultText);
  if (executorResult.status !== "ready_for_review" || executorResult.candidate_sha !== executorState.head) {
    throw pilotError("REVIEW_IDENTITY_MISMATCH", "Executor result does not identify the current exact candidate SHA.");
  }
  const candidateSha = executorState.head;
  const paths = await validateCandidate(cwd, candidateSha);
  const diffResult = await executeCommand("git", ["diff", "--no-ext-diff", "--unified=80", `${START_SHA}..${candidateSha}`], {
    cwd,
    timeoutMs: 60_000,
    maxOutputBytes: MAX_DIFF_BYTES
  });
  requireSuccess(diffResult, "REVIEW_DIFF_FAILED", "Could not create bounded candidate diff for review.");

  const localDir = join(cwd, LOCAL_RUN_RELATIVE, "review", candidateSha);
  await mkdir(localDir, { recursive: true });
  const reviewRoot = await mkdtemp(join(tmpdir(), "pkr-003-review-"));
  const reviewWorktree = join(reviewRoot, "worktree");
  let worktreeAdded = false;
  try {
    await runGit(cwd, ["worktree", "add", "--detach", reviewWorktree, candidateSha], {
      timeoutMs: 120_000,
      maxOutputBytes: 524_288
    });
    worktreeAdded = true;
    const before = await readRepositoryState(reviewWorktree);
    if (before.head !== candidateSha || before.branch !== "" || !before.clean) {
      throw pilotError("REVIEW_WORKTREE_INVALID", "Detached reviewer worktree preflight failed.", before);
    }

    const claude = await resolveCliCommand("claude", executeCommand, globalThis.process.platform);
    const schema = JSON.stringify(reviewSchema());
    const args = [
      "-p",
      "--output-format", "json",
      "--json-schema", schema,
      "--max-turns", "25",
      "--max-budget-usd", "8",
      "--permission-mode", "plan",
      "--tools", "Read,Glob,Grep",
      "--disallowedTools", "Bash,Edit,Write,NotebookEdit",
      "--no-session-persistence"
    ];
    const prompt = buildReviewPrompt(candidateSha, paths, executorResultText, String(diffResult.stdout ?? ""));
    const reviewRun = await executeCommand(claude, args, {
      cwd: reviewWorktree,
      input: prompt,
      env: buildClaudeEnvironment(),
      timeoutMs: 2_700_000,
      maxOutputBytes: 8_388_608
    });
    await writeFile(join(localDir, "stdout.json"), String(reviewRun.stdout ?? ""), "utf8");
    await writeFile(join(localDir, "stderr.log"), String(reviewRun.stderr ?? ""), "utf8");
    requireSuccess(reviewRun, "CLAUDE_REVIEW_FAILED", "Claude reviewer did not complete cleanly.");
    const structured = validateReviewResult(extractClaudeStructuredResult(reviewRun.stdout), candidateSha);

    const after = await readRepositoryState(reviewWorktree);
    if (after.head !== candidateSha || after.branch !== "" || !after.clean) {
      throw pilotError("REVIEW_WORKTREE_MUTATED", "Claude review changed the detached reviewer worktree.", after);
    }
    await writeFile(join(localDir, "review.json"), `${JSON.stringify(structured, null, 2)}\n`, "utf8");

    return {
      ok: true,
      mode: "reviewer",
      run_id: RUN_ID,
      review_sha: candidateSha,
      status: structured.status,
      findings: structured.findings.length,
      worktree_clean_before: true,
      worktree_clean_after: true,
      output_complete: reviewRun.complete && !reviewRun.truncated,
      report_path: `${LOCAL_RUN_RELATIVE}/review/${candidateSha}/review.json`
    };
  } finally {
    if (worktreeAdded) {
      const removal = await executeCommand("git", ["worktree", "remove", "--force", reviewWorktree], {
        cwd,
        timeoutMs: 120_000,
        maxOutputBytes: 524_288
      });
      if (removal.exitCode !== 0) {
        globalThis.console.error("Reviewer worktree cleanup failed; manual bounded cleanup is required.");
      }
    }
    await rm(reviewRoot, { recursive: true, force: true });
  }
}

function requireSuccess(result, code, message) {
  if (result?.timedOut) throw pilotError(code, `${message} The command timed out.`);
  if (result?.truncated || result?.complete === false) throw pilotError(code, `${message} Output was incomplete.`);
  if (result?.exitCode !== 0) {
    throw pilotError(code, message, {
      exit_code: result?.exitCode ?? null,
      stdout: String(result?.stdout ?? "").slice(-4096),
      stderr: String(result?.stderr ?? "").slice(-4096)
    });
  }
}

function pilotError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

async function main() {
  const mode = String(globalThis.process.argv[2] ?? "").trim().toLowerCase();
  const cwd = resolve(globalThis.process.cwd());
  const result = mode === "executor"
    ? await runExecutor(cwd)
    : mode === "reviewer"
      ? await runReviewer(cwd)
      : (() => { throw pilotError("MODE_INVALID", "Mode must be executor or reviewer."); })();
  globalThis.console.log(JSON.stringify(result));
}

const invokedPath = globalThis.process.argv[1] ? pathToFileURL(resolve(globalThis.process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    globalThis.console.error(JSON.stringify({
      ok: false,
      error: {
        code: typeof error?.code === "string" ? error.code : "UNEXPECTED_ERROR",
        message: error instanceof Error ? error.message : "Unexpected PKR-003 pilot runner failure.",
        ...(error?.details === undefined ? {} : { details: error.details })
      }
    }));
    globalThis.process.exitCode = 1;
  });
}
