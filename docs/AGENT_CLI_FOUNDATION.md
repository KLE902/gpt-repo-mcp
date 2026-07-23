# Agent CLI foundation

## Purpose

The repository contains a small reusable foundation for verifying and invoking locally installed agent CLIs through fixed, policy-owned boundaries. It supports capability probes for Codex CLI and Claude Code plus durable execution of an already created, verified Codex task. It is not an orchestration platform, provider router, broker, queue, or general command runner.

## Capability probes

`scripts/agent-cli-probe.mjs` supports fixed Codex CLI and Claude Code capability probes through `repo_run_allowed_script`. A local allowlist entry chooses the provider and repository; the MCP caller supplies only the configured `script_id` and exact HEAD guard.

Each probe:

- requires an exactly clean worktree;
- records the installed CLI version;
- detects required non-interactive and structured-output capabilities;
- runs one minimal read-only authentication check;
- requires an exact provider-neutral completion marker;
- verifies that HEAD and the worktree remain unchanged;
- returns bounded structured status without returning prompts, credentials, or raw environment values.

The probe fails closed for a missing CLI, missing capability, authentication or provider failure, nonzero exit, timeout, truncated or incomplete output, malformed structured output, marker mismatch, changed HEAD, or a changed worktree.

## Durable Codex task execution

`repo_start_codex_task` is a dedicated start boundary for an existing `repo_write_codex_task` run. It is disabled by default through `codex_task_run_enabled` and accepts only repository/run identity, exact branch and HEAD guards, `dry_run`, and an audit reason. Prompt text, command, arguments, model, reasoning level, sandbox, timeout, environment, working directory, verification commands, and Git delivery instructions are not caller inputs.

Before start, the service verifies:

- a clean non-base feature branch and exact HEAD;
- the exact run directory, manifest identity, paths, and prompt SHA-256;
- a non-empty bounded allowed-path scope;
- absence of prior result, execution, stdout, or stderr artifacts;
- gitignored execution artifacts;
- single-writer ownership for the repository;
- required Codex CLI non-interactive, JSONL, sandbox, and repository-root capabilities.

The MCP request starts a separate bounded runner and returns only after the runner has confirmed `running` or reached a terminal state. Durable local artifacts remain under the exact run directory:

- `execution.json`
- `stdout.jsonl`
- `stderr.log`
- `RESULT.md`

The state model is `starting`, `running`, `completed`, `blocked`, `failed`, or `timed_out`. `repo_codex_review` reads that state, checks current process activity, and combines terminal results with the normal Git review. A later ChatGPT turn can reread a long-running task without prompt copying or terminal relay.

## Process and Windows boundaries

The process layer uses fixed executable and argument arrays, `shell: false`, `windowsHide`, bounded and redacted output, server-owned timeouts, process-tree termination, and explicit environment allowlists. The detached runner receives the verified prompt through stdin and invokes Codex with fixed non-interactive JSONL output, `workspace-write`, and the exact repository root.

On Windows, executable resolution follows the verified npm/platform paths from the shared CLI foundation. Execution-state replacement handles Windows rename semantics without exposing a caller-selected command interpreter. Timeout terminates the complete Codex process tree and never retries automatically.

## Postflight integrity

After Codex exits, the runner verifies the original branch and HEAD, the actual changed paths, forbidden paths, the integrity of other run directories, UTF-8 `RESULT.md`, result status, and output completeness. Only `completed` and `blocked` are valid successful terminal results.

A branch, HEAD, forbidden-path, or out-of-scope change produces `failed`. The runner preserves evidence and does not restore, reset, stage, commit, push, create or switch branches, merge, or retry. ChatGPT reviews the actual diff and may use the normal guarded recovery and delivery tools afterward.

## Deliberate non-goals

This foundation does not provide Claude execution, automatic Claude review, a provider router, multiple simultaneous agents, a queue, broker, dashboard, central job database, general status or cancel platform, session resume, automatic retry, automatic review loops, or automatic commit, push, pull request, or merge.
