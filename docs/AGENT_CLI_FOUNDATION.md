# Agent CLI foundation

## Purpose

The repository contains a small reusable foundation for verifying locally installed agent CLIs through fixed, policy-owned boundaries. It supports capability and authentication probes for Codex CLI and Claude Code plus durable execution of an already created, verified Codex task. It is not an orchestration platform, provider router, broker, queue, or general command runner.

## Capability, authentication, and sandbox verification

`scripts/agent-cli-probe.mjs` supports fixed Codex CLI and Claude Code probes through `repo_run_allowed_script`. A local allowlist entry chooses the provider and repository; the MCP caller supplies only the configured `script_id` and exact HEAD guard.

Every probe requires a clean worktree, records the installed CLI version, detects required non-interactive and structured-output capabilities, runs a minimal read-only authentication check, and verifies unchanged branch, HEAD, index, and worktree state.

Codex has an additional mandatory verification. CLI help containing `--sandbox` does not prove that the requested sandbox can start. After authentication, the probe invokes fixed `codex exec --json --sandbox workspace-write --cd <repo-root> -` and asks Codex to create one exact marker file under an isolated `.chatgpt/sandbox-probes/<probe-id>/` directory. Success requires all of the following:

- complete valid JSONL within the bounded timeout and output limit;
- no structured or defensive-text sandbox failure marker;
- a successful built-in Codex command or file-change event;
- the exact expected file content;
- no external MCP, Node REPL, JavaScript REPL, or unknown write path;
- cleanup of the probe directory;
- unchanged branch, HEAD, index, and worktree after cleanup.

Probe output separates CLI capability, authentication, sandbox bootstrap, and sandboxed-operation verification. Missing evidence is never interpreted as success. The probe returns bounded structured status without returning prompts, credentials, raw environment values, or unredacted diagnostics.

The Codex probe fails closed for a missing CLI or capability, authentication failure, nonzero exit, timeout, truncation, incomplete or malformed output, marker mismatch, sandbox-helper failure, unverified write provenance, changed repository state, or failed cleanup. Claude retains its read-only capability and authentication probe; this change does not add Claude execution.

## Durable Codex task execution

`repo_start_codex_task` is a dedicated start boundary for an existing `repo_write_codex_task` run. It is disabled by default through `codex_task_run_enabled` and accepts only repository/run identity, exact branch and HEAD guards, `dry_run`, and an audit reason. Prompt text, command, arguments, model, reasoning level, sandbox, timeout, environment, working directory, verification commands, and Git delivery instructions are not caller inputs.

Before creating execution state, the service verifies:

- a clean non-base feature branch and exact HEAD;
- the exact run directory, manifest identity, paths, and prompt SHA-256;
- a non-empty bounded allowed-path scope;
- absence of prior result, execution, stdout, or stderr artifacts;
- gitignored execution artifacts;
- single-writer ownership for the repository;
- Codex CLI capability and read-only authentication;
- a real isolated `workspace-write` sandbox operation;
- unchanged branch, HEAD, index, and worktree after that operation is cleaned up.

The MCP request starts a separate bounded runner and returns only after the runner has confirmed `running` or reached a terminal state. Durable local artifacts remain under the exact run directory:

- `execution.json`
- `stdout.jsonl`
- `stderr.log`
- `RESULT.md`

The state model is `starting`, `running`, `completed`, `blocked`, `failed`, or `timed_out`. Successful `completed` or `blocked` state requires positive execution-boundary evidence. Older execution state without the boundary fields remains readable, but missing evidence is classified as unverified rather than migrated to success.

## Execution-boundary model

The runner records the requested sandbox, verified bootstrap, detected sandbox failure and code, execution-boundary result, fallback-tool violations, and safe warnings. It analyzes structured JSONL events first and uses known bounded stderr/output markers only as defensive fallback.

A successful built-in `command_execution` or `file_change` event after verified bootstrap is accepted as positive Codex operation provenance. Tool names alone are not proof that a shell, patch, or file operation was sandboxed. External MCP tool calls cannot establish the required boundary. Node REPL, JavaScript REPL, and equivalent raw host paths are control-boundary violations when used for filesystem or Git operations. A material Git change with no positive built-in operation provenance fails closed as `unknown_write_provenance`.

Current Codex JSONL identifies operation classes but does not expose a separate cryptographic or per-operation sandbox-attestation field. The boundary therefore combines a real preflight sandbox operation, structured event classification, absence of sandbox failures, and positive built-in operation provenance. If a future Codex contract exposes stronger structured provenance, the classifier should consume it instead of weakening this rule.

Known terminal sandbox markers include:

- `orchestrator_helper_launch_failed`
- missing or unspawnable `codex-windows-sandbox-setup.exe`
- `windows sandbox failed`
- `setup refresh failed`
- equivalent structured sandbox failure codes

The model-cache warning `missing field supports_reasoning_summaries` is non-blocking when JSONL remains valid and execution provenance is complete. It must not hide or outrank a sandbox failure. If it causes malformed or incomplete output, the existing fail-closed output rules apply.

## Terminal classification

The runner classifies terminal state in this conceptual order:

1. timeout;
2. output truncation or malformed output;
3. process-start or sandbox-bootstrap failure;
4. unsandboxed fallback or unknown write provenance;
5. nonzero process exit;
6. invalid or manipulated result;
7. branch, HEAD, index, run-artifact, Git-ref, forbidden-path, or allowed-scope violation;
8. only then `completed` or `blocked`.

An exit code of zero, a valid `RESULT.md`, or a correct in-scope Git diff cannot override an earlier execution-boundary failure. Evidence is preserved and no automatic restore occurs.

## Process and Windows boundaries

The process layer uses fixed executable and argument arrays, `shell: false`, `windowsHide`, bounded and redacted output, server-owned timeouts, process-tree termination, and explicit environment allowlists. The detached runner receives the verified prompt through stdin and invokes Codex with fixed non-interactive JSONL output, `workspace-write`, and the exact repository root.

On Windows, executable resolution follows the verified npm/platform paths from the shared CLI foundation. Execution-state replacement handles Windows rename semantics without exposing a caller-selected command interpreter. Timeout terminates the complete Codex process tree and never retries automatically.

## Review and recovery

`repo_codex_review` shows the requested sandbox, bootstrap result, sandbox failure and code, fallback-tool findings, execution-boundary result, and a safe classification reason alongside the existing Git review and recovery payloads. A reviewer does not need to inspect raw logs to understand why a run failed despite a correct diff.

Legacy manually produced `RESULT.md` remains compatible when no `execution.json` exists. Durable execution state with missing boundary evidence is different: it is explicitly unverified and cannot be accepted as a successful durable run.

## Deliberate non-goals

This foundation does not provide Claude execution, automatic Claude review, a provider router, multiple simultaneous agents, a queue, broker, dashboard, central job database, general status or cancel platform, session resume, automatic retry, automatic review loops, automatic recovery, or automatic commit, push, pull request, or merge.
