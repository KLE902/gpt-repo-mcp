import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  buildClaudeEnvironment,
  executeCommand,
  redactAgentOutput,
  resolveCliCommand
} from "./agent-cli-probe.mjs";

export const PROFILE = Object.freeze({
  runId: "ato-001-pkr-004",
  branch: "master",
  head: "6036e56fb54ca332824fa9f26c48a82ae56110dd",
  taskSha256: "65a9986da526db3c1c5900f5a7129b8dd6ce9e2cbda13aebd21aba223ed48b16",
  contextAggregateSha256: "b749c7e2edc96895cce837f6f80faec14abe05bb72cb33a7adeb29c76545b65e",
  expectedOrigin: "https://github.com/KLE902/Premium-Komga-Reader.git",
  timeoutMs: 600_000,
  maxOutputBytes: 262_144,
  context: [
    ["AGENTS.md", "d0cc1ad61a9f6c4d8164c4cff34b4ba8e7197090dc16e58fbdf0aba794d1ff55"],
    ["PROJECT_STATE.md", "ce2f270f82da565bab1493b045c77e6a01becd23ef1cffc1c5c861950dff1e82"],
    ["DEVELOPMENT_BACKLOG.md", "65dabb5fda836d598616db51b5ea693126f46b93872f377bccb969fe58ecd0d2"],
    ["FEATURES.md", "95cbb1b9580c2226773074dde5f7dd05099e46aa5e9eba0559647b0044a26246"],
    ["premium-komga-reader-designspec.md", "b377f8f99b236c1f37f39ca76b6943ce6b35ef64d95a39b947e241d3c88475c2"],
    ["docs/premium-reference/wp-p0-baseline.md", "8effe266c43383a844bcf09e13a22cb0a00ea1ee7933c57b96ae26ef682491ff"],
    ["docs/premium-reference/wp-p1-parking-lot.md", "8e5cfde56df9efe7b7b19d626a83d371868932be691b0daab80d75e3bcfeece3"],
    ["app/src/main/java/com/premiumkomgareader/app/library/GlobalSearch.kt", "20913f3610ee8ea4c60ffbb354cf8345a9a72e47baee253b438b4bd8582ffd24"],
    ["app/src/main/java/com/premiumkomgareader/app/library/GlobalSearchScreen.kt", "00dc30deb523bac26dbdf94187c2dd0c78e1bcd1fb49ea0f9cb2ab89e883cb54"],
    ["app/src/main/java/com/premiumkomgareader/app/komga/KomgaGlobalSearchClient.kt", "7e0f5cd027ce4512d701b33f4eaebdd7787b769deb7762bd2958709bf88697ab"]
  ]
});

const SemanticResultSchema = z.object({
  framing_challenge: z.string().min(1).max(12_000),
  recommended_product_contract: z.string().min(1).max(12_000),
  recommended_ui_contract: z.string().min(1).max(12_000),
  preservation_notes: z.array(z.string().min(1).max(2_000)).min(1).max(20),
  assumptions: z.array(z.string().min(1).max(2_000)).max(20),
  evidence_gaps: z.array(z.string().min(1).max(2_000)).max(20),
  owner_judgments: z.array(z.string().min(1).max(2_000)).max(20),
  exclusions_confirmed: z.object({
    no_file_edits: z.literal(true),
    no_cross_source_deduplication: z.literal(true),
    no_production_implementation_plan: z.literal(true)
  }).strict()
}).strict();

const RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["framing_challenge", "recommended_product_contract", "recommended_ui_contract", "preservation_notes", "assumptions", "evidence_gaps", "owner_judgments", "exclusions_confirmed"],
  properties: {
    framing_challenge: { type: "string", minLength: 1 },
    recommended_product_contract: { type: "string", minLength: 1 },
    recommended_ui_contract: { type: "string", minLength: 1 },
    preservation_notes: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    assumptions: { type: "array", items: { type: "string", minLength: 1 } },
    evidence_gaps: { type: "array", items: { type: "string", minLength: 1 } },
    owner_judgments: { type: "array", items: { type: "string", minLength: 1 } },
    exclusions_confirmed: {
      type: "object",
      additionalProperties: false,
      required: ["no_file_edits", "no_cross_source_deduplication", "no_production_implementation_plan"],
      properties: {
        no_file_edits: { const: true },
        no_cross_source_deduplication: { const: true },
        no_production_implementation_plan: { const: true }
      }
    }
  }
};

export async function runAto001ClaudeRunner(options, dependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const runCommand = dependencies.runCommand ?? executeCommand;
  const verifyRepository = dependencies.verifyRepository ?? (() => verifyPinnedRepository(options.repoRoot, runCommand));
  const resolveCli = dependencies.resolveCli ?? (() => resolveCliCommand("claude", runCommand, process.platform));
  const statePath = join(options.artifactDirectory, "execution.json");
  const outputPath = join(options.artifactDirectory, "provider-output.json");
  const resultPath = join(options.artifactDirectory, "validated-result.json");
  let state = JSON.parse(await readFile(statePath, "utf8"));
  const metadata = JSON.parse(await readFile(join(options.artifactDirectory, "metadata.json"), "utf8"));
  const expectedClaudeVersion = String(metadata?.invocation?.version ?? "");
  if (expectedClaudeVersion.length < 1 || expectedClaudeVersion.length > 128 || /[\r\n]/.test(expectedClaudeVersion)) {
    throw new Error("The start-verified Claude version identity is missing or invalid.");
  }
  const startedAt = now();

  try {
    await verifyRepository();
    const task = await readFile(options.taskPath);
    if (sha256(task) !== PROFILE.taskSha256 || task.includes(0) || task.at(-1) === 0x0a || task.at(-1) === 0x0d) {
      throw classified("unverifiable_read_boundary", "ATO001_TASK_IDENTITY_INVALID", "The fixed task bytes are not the ratified ATO-001 identity.");
    }
    const executable = await resolveCli();
    const cli = await verifyCli(executable, runCommand, expectedClaudeVersion);
    state = {
      ...state,
      status: "running",
      terminal: false,
      started_at: startedAt.toISOString(),
      updated_at: now().toISOString(),
      runner_pid: process.pid,
      process_pid: null,
      boundary: {
        ...state.boundary,
        repository: true,
        branch: true,
        head: true,
        clean: true,
        origin_synchronized: true,
        task_identity: true,
        context_hashes: true,
        context_aggregate: true,
        cli_resolution: true,
        cli_version: true,
        authentication: true,
        capabilities: true,
        read_only_invocation: true
      }
    };
    await writeJsonAtomic(statePath, state);

    const args = buildArgs(cli.noSessionPersistence);
    const commandResult = await runCommand(executable, args, {
      cwd: options.repoRoot,
      input: task.toString("utf8"),
      env: dependencies.environment ?? buildClaudeEnvironment(),
      timeoutMs: PROFILE.timeoutMs,
      maxOutputBytes: PROFILE.maxOutputBytes
    });
    const providerRuntimeMs = Math.max(0, now().getTime() - startedAt.getTime());
    await writeJsonAtomic(outputPath, {
      schema_version: 1,
      exit_code: commandResult.exitCode,
      timed_out: Boolean(commandResult.timedOut),
      complete: commandResult.complete === true,
      truncated: Boolean(commandResult.truncated),
      stdout: redactAgentOutput(commandResult.stdout),
      stderr: redactAgentOutput(commandResult.stderr)
    });

    if (commandResult.timedOut) throw classified("timed_out", "ATO001_PROVIDER_TIMEOUT", "Claude exceeded the fixed runtime bound.", { providerRuntimeMs });
    if (commandResult.truncated || commandResult.complete !== true) throw classified("truncated", "ATO001_OUTPUT_INCOMPLETE", "Claude output exceeded the fixed complete-output bound.", { providerRuntimeMs });
    if (commandResult.exitCode !== 0) throw classified("provider_failed", "ATO001_PROVIDER_FAILED", "Claude returned a nonzero exit code.", { providerRuntimeMs });

    const envelope = parseEnvelope(commandResult.stdout);
    const semantic = parseSemanticResult(envelope);
    await verifyRepository();
    await writeJsonAtomic(resultPath, {
      schema_version: 1,
      valid_for_pkr_intake: true,
      result: semantic
    });
    const resultHash = sha256(Buffer.from(JSON.stringify(semantic), "utf8"));
    state = terminalState(state, "completed", null, null, now(), {
      valid_for_pkr_intake: true,
      diagnostic_only: false,
      exit_code: commandResult.exitCode,
      provider_runtime_ms: providerRuntimeMs,
      output_complete: true,
      result_sha256: resultHash,
      provider_usage: recordOrNull(envelope.usage),
      provider_cost_usd: numberOrNull(envelope.total_cost_usd ?? envelope.cost_usd),
      provider_turns: integerOrNull(envelope.num_turns ?? envelope.turns),
      boundary: { ...state.boundary, complete_output: true, result_schema: true }
    });
  } catch (error) {
    const failure = normalizeFailure(error);
    const diagnosticOnly = failure.status !== "running";
    state = terminalState(state, failure.status, failure.code, failure.message, now(), {
      valid_for_pkr_intake: false,
      diagnostic_only: diagnosticOnly,
      provider_runtime_ms: failure.providerRuntimeMs ?? Math.max(0, now().getTime() - startedAt.getTime()),
      timed_out: failure.status === "timed_out",
      output_truncated: failure.status === "truncated",
      output_complete: false,
      process_tree_termination_outcome: ["timed_out", "truncated"].includes(failure.status) ? "requested_unverified" : "not_required"
    });
    await writeJsonAtomic(resultPath, {
      schema_version: 1,
      valid_for_pkr_intake: false,
      invalidation_reason: failure.code,
      result: null
    });
  }
  await writeJsonAtomic(statePath, state);
  return state;
}

function buildArgs(noSessionPersistence) {
  const args = [
    "-p",
    "--output-format", "json",
    "--max-turns", "1",
    "--permission-mode", "plan",
    "--tools", "Read,Glob,Grep",
    "--disallowedTools", "Bash,Edit,Write,NotebookEdit",
    "--json-schema", JSON.stringify(RESULT_JSON_SCHEMA)
  ];
  if (noSessionPersistence) args.push("--no-session-persistence");
  return args;
}

async function verifyCli(executable, runCommand, expectedVersion) {
  const version = await runCommand(executable, ["--version"], { timeoutMs: 30_000, maxOutputBytes: 65_536 });
  assertCommand(version, "ATO001_CLAUDE_VERSION_UNVERIFIED");
  const actualVersion = version.stdout.trim().split(/\r?\n/, 1)[0]?.replace(/^claude\s+/i, "") ?? "";
  if (actualVersion !== expectedVersion) {
    throw classified("unverifiable_read_boundary", "ATO001_CLAUDE_VERSION_MISMATCH", "Claude version changed after start verification.");
  }
  const help = await runCommand(executable, ["--help"], { timeoutMs: 30_000, maxOutputBytes: 131_072 });
  assertCommand(help, "ATO001_CLAUDE_CAPABILITY_UNVERIFIED");
  for (const flag of ["--output-format", "--max-turns", "--permission-mode", "--tools", "--disallowedTools", "--json-schema"]) {
    if (!help.stdout.includes(flag)) throw classified("unverifiable_read_boundary", "ATO001_CLAUDE_CAPABILITY_UNVERIFIED", `Required Claude flag unavailable: ${flag}`);
  }
  const auth = await runCommand(executable, ["auth", "status", "--json"], { timeoutMs: 30_000, maxOutputBytes: 65_536 });
  assertCommand(auth, "ATO001_CLAUDE_AUTHENTICATION_FAILED");
  let status;
  try { status = JSON.parse(auth.stdout); } catch { status = null; }
  if (!(status?.loggedIn === true || status?.authenticated === true || status?.isAuthenticated === true || ["logged_in", "authenticated"].includes(String(status?.status ?? "").toLowerCase()))) {
    throw classified("unverifiable_read_boundary", "ATO001_CLAUDE_AUTHENTICATION_FAILED", "Claude authentication could not be verified.");
  }
  return { noSessionPersistence: help.stdout.includes("--no-session-persistence") };
}

export async function verifyPinnedRepository(repoRoot, runCommand = executeCommand) {
  const git = async (args) => {
    const result = await runCommand("git", args, { cwd: repoRoot, timeoutMs: 30_000, maxOutputBytes: 1_048_576 });
    assertCommand(result, "ATO001_GIT_VERIFICATION_FAILED");
    return result.stdout.trim();
  };
  if (resolve(await git(["rev-parse", "--show-toplevel"])).toLowerCase() !== resolve(repoRoot).toLowerCase()) {
    throw classified("repository_drift", "ATO001_REPOSITORY_DRIFT", "Repository root changed.");
  }
  if (await git(["symbolic-ref", "--quiet", "--short", "HEAD"]) !== PROFILE.branch) throw classified("repository_drift", "ATO001_REPOSITORY_DRIFT", "Branch changed.");
  if (await git(["rev-parse", "HEAD"]) !== PROFILE.head) throw classified("repository_drift", "ATO001_REPOSITORY_DRIFT", "HEAD changed.");
  if (await git(["status", "--porcelain=v1", "--untracked-files=normal"]) !== "") throw classified("repository_drift", "ATO001_REPOSITORY_DRIFT", "Index or worktree changed.");
  if (await git(["rev-parse", "refs/remotes/origin/master"]) !== PROFILE.head) throw classified("repository_drift", "ATO001_REPOSITORY_DRIFT", "origin/master changed.");
  const origin = (await git(["remote", "get-url", "origin"])).trim().replace(/\.git$/i, "").replace(/^git@github\.com:/i, "https://github.com/").toLowerCase();
  if (origin !== PROFILE.expectedOrigin.replace(/\.git$/i, "").toLowerCase()) throw classified("repository_drift", "ATO001_REPOSITORY_DRIFT", "Repository origin changed.");
  for (const [path, expected] of PROFILE.context) {
    let bytes;
    try { bytes = await readFile(join(repoRoot, ...path.split("/"))); } catch { throw classified("context_drift", "ATO001_CONTEXT_DRIFT", `Missing context: ${path}`); }
    if (sha256(bytes) !== expected) throw classified("context_drift", "ATO001_CONTEXT_DRIFT", `Context changed: ${path}`);
  }
  const aggregate = sha256(Buffer.from(PROFILE.context.map(([path, hash]) => `${path}\0${hash}\n`).join(""), "utf8"));
  if (aggregate !== PROFILE.contextAggregateSha256) throw classified("context_drift", "ATO001_CONTEXT_DRIFT", "Context aggregate changed.");
}

export function parseEnvelope(stdout) {
  let envelope;
  try { envelope = JSON.parse(String(stdout).trim()); } catch { throw classified("output_contract_failed", "ATO001_OUTPUT_ENVELOPE_INVALID", "Claude output was not one complete JSON envelope."); }
  if (!envelope || typeof envelope !== "object" || envelope.type !== "result" || envelope.is_error === true || String(envelope.subtype ?? "").startsWith("error")) {
    throw classified("output_contract_failed", "ATO001_OUTPUT_ENVELOPE_INVALID", "Claude output did not contain a successful result envelope.");
  }
  return envelope;
}

export function parseSemanticResult(envelope) {
  let candidate = envelope.structured_output ?? envelope.result;
  if (typeof candidate === "string") {
    try { candidate = JSON.parse(candidate); } catch { throw classified("output_contract_failed", "ATO001_RESULT_SCHEMA_INVALID", "Claude result was not semantic JSON."); }
  }
  const parsed = SemanticResultSchema.safeParse(candidate);
  if (!parsed.success) throw classified("output_contract_failed", "ATO001_RESULT_SCHEMA_INVALID", "Claude result did not match the fixed PKR-004 semantic schema.");
  return parsed.data;
}

function assertCommand(result, code) {
  if (result?.exitCode !== 0 || result?.timedOut || result?.truncated || result?.complete !== true) {
    throw classified("unverifiable_read_boundary", code, "A fixed verification command failed closed.");
  }
}

function terminalState(state, status, code, diagnostic, now, overrides = {}) {
  const timestamp = now.toISOString();
  return {
    ...state,
    status,
    terminal: true,
    updated_at: timestamp,
    ended_at: timestamp,
    terminal_classification: code ?? "transport_success",
    diagnostic,
    ...overrides
  };
}

function classified(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

function normalizeFailure(error) {
  return {
    status: error?.status ?? "unverifiable_read_boundary",
    code: error?.code ?? "ATO001_RUNNER_INTERNAL_FAILURE",
    message: String(error?.message ?? error).slice(0, 4096),
    providerRuntimeMs: error?.providerRuntimeMs
  };
}

function recordOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Invalid fixed ATO-001 runner arguments.");
    result[key.slice(2)] = value;
  }
  if (!result["repo-root"] || !result["task-path"] || !result["artifact-directory"]) throw new Error("Missing fixed ATO-001 runner paths.");
  return {
    repoRoot: resolve(result["repo-root"]),
    taskPath: resolve(result["task-path"]),
    artifactDirectory: resolve(result["artifact-directory"])
  };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  runAto001ClaudeRunner(parseArgs(process.argv.slice(2))).then(
    (state) => { process.exitCode = state.status === "completed" ? 0 : 1; },
    () => { process.exitCode = 1; }
  );
}
