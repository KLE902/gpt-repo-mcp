import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { AllowedScriptInput } from "../contracts/autonomous-operations.contract.js";
import { RepoReaderError } from "../runtime/errors.js";
import { redactSensitiveText } from "../runtime/result-envelope.js";
import { OperationsPolicy, type AllowedScriptConfig } from "./operations-policy.js";
import { SecretScanner } from "./secret-scanner.js";

export type AllowedScriptProcessResult = {
export type AllowedScriptProcessRunner = (root: string, script: AllowedScriptConfig, env: NodeJS.ProcessEnv) => Promise<AllowedScriptProcessResult>;
export type AllowedScriptHeadReader = (root: string) => Promise<string>;

  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  complete: boolean;
  truncated: boolean;
};

export class AllowedScriptService {
  private readonly scanner = new SecretScanner();

  constructor(
    private readonly root: string,
    private readonly policy: OperationsPolicy,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly processRunner: AllowedScriptProcessRunner = execute,
    private readonly headReader: AllowedScriptHeadReader = readHead
  ) {}

  async run(input: AllowedScriptInput) {
    const script = this.policy.getAllowedScript(input.script_id);
    const head = await this.headReader(this.root);
    if (head !== input.expected_head_sha) {
      throw new RepoReaderError("GIT_HEAD_MISMATCH", "Repository HEAD changed before the allowlisted script could run.", {
        diagnostics: { expected_head_sha: input.expected_head_sha, actual_head_sha: head }
      });
    }
    if (input.dry_run) {
      return envelope(input.script_id, true, false, emptyResult(), 0);
    }

    const started = performance.now();
    const raw = await this.processRunner(this.root, script, environmentFor(script, this.env));
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    return envelope(input.script_id, false, true, sanitize(raw, this.scanner, script.max_output_bytes), durationMs);
  }
}

function execute(root: string, script: AllowedScriptConfig, env: NodeJS.ProcessEnv): Promise<AllowedScriptProcessResult> {
  return new Promise((resolve) => {
    const child = execFile(script.command, script.args, {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: script.timeout_ms,
      maxBuffer: script.max_output_bytes,
      windowsHide: true,
      shell: false
    }, (error, stdout, stderr) => {
      const detail = error as (NodeJS.ErrnoException & { killed?: boolean; code?: string | number | null }) | null;
      const timedOut = Boolean(detail?.killed) || detail?.code === "ETIMEDOUT";
      const maxBufferExceeded = detail?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      const exitCode = timedOut ? null : typeof detail?.code === "number" ? detail.code : error ? 1 : 0;
      resolve({
        exitCode,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        timedOut,
        complete: !timedOut && !maxBufferExceeded,
        truncated: Boolean(maxBufferExceeded)
      });
    });
    child.stdin?.end();
  });
}

function environmentFor(script: AllowedScriptConfig, source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const baseline = process.platform === "win32"
    ? ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]
    : ["PATH", "HOME", "TMPDIR", "LANG"];
  for (const name of [...baseline, ...script.inherit_env]) {
    if (source[name] !== undefined) result[name] = source[name];
  }
  return result;
}

function sanitize(result: AllowedScriptProcessResult, scanner: SecretScanner, limit: number): AllowedScriptProcessResult {
  const clean = (value: string) => redactSensitiveText(scanner.redact(value)).slice(0, limit);
  const stdout = clean(result.stdout);
  const stderr = clean(result.stderr);
  const sliced = stdout.length < result.stdout.length || stderr.length < result.stderr.length;
  return {
    ...result,
    stdout,
    stderr,
    truncated: result.truncated || sliced,
    complete: result.complete && !sliced
  };
}

function emptyResult(): AllowedScriptProcessResult {
  return { exitCode: null, stdout: "", stderr: "", timedOut: false, complete: true, truncated: false };
}

function envelope(scriptId: string, dryRun: boolean, executed: boolean, result: AllowedScriptProcessResult, durationMs: number) {
  const succeeded = executed && result.exitCode === 0 && !result.timedOut && result.complete;
  return {
    ok: true as const,
    dry_run: dryRun,
    script_id: scriptId,
    executed,
    succeeded,
    exit_code: result.exitCode,
    timed_out: result.timedOut,
    complete: result.complete,
    output_truncated: result.truncated,
    duration_ms: durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    warnings: [
      ...(result.timedOut ? ["SCRIPT_TIMED_OUT"] : []),
      ...(result.truncated ? ["SCRIPT_OUTPUT_TRUNCATED"] : []),
      ...(executed && result.exitCode !== 0 && result.exitCode !== null ? ["SCRIPT_EXIT_NONZERO"] : [])
    ]
  };
}

async function readHead(root: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true, shell: false }, (error, stdout) => {
      if (error) {
        reject(new RepoReaderError("GIT_ERROR", "Could not verify repository HEAD before script execution."));
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}
