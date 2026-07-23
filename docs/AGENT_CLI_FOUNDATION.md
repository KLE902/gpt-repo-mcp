# Agent CLI foundation

## Purpose

The repository contains a small, reusable foundation for verifying locally installed agent CLIs through the existing `repo_run_allowed_script` boundary. It is capability-detection and process-safety infrastructure, not an orchestration platform or a general task runner.

## Capability probe

`scripts/agent-cli-probe.mjs` supports fixed Codex CLI and Claude Code capability probes. A local allowlist entry chooses the provider and repository; the MCP caller supplies only the configured `script_id` and exact HEAD guard.

Each probe:

- requires an exactly clean worktree before execution;
- records the installed CLI version;
- detects required local non-interactive and structured-output capabilities;
- runs one minimal read-only authentication check;
- requires an exact provider-neutral completion marker;
- checks that HEAD and the worktree remain unchanged after success or failure;
- returns bounded structured status without returning prompts, credentials, or raw environment values.

The probe fails closed for a missing CLI, missing capability, authentication or provider failure, nonzero exit, timeout, truncated or incomplete output, malformed structured output, marker mismatch, changed HEAD, or a changed worktree.

## Process and Windows boundaries

The process layer uses fixed executable and argument arrays, `shell: false`, `windowsHide`, bounded output, timeouts, process-tree termination on Windows, redacted diagnostics, and explicit environment allowlists. It does not accept caller-supplied commands or arguments.

On Windows, Claude resolution prefers the verified native npm platform executable and otherwise uses the verified package entry through Node, avoiding uncertain `cmd.exe` interpretation where possible. Claude Code also requires a verified Git Bash executable. Other command shims are accepted only through the bounded fixed-argument fallback.

## Claude authentication launcher

`scripts/start-claude-login.ps1` and `scripts/start-claude-login.mjs` provide a visible, bounded Windows login path for Claude Code. The launcher resolves a verified native `claude.exe`, opens a separate visible PowerShell process, starts the official `claude auth login` flow, and returns immediately to MCP with `CLAUDE_AUTH_LOGIN_STARTED`.

The interactive child verifies `claude auth status` before closing. The launcher does not read, store, print, or return OAuth tokens or API keys, and it does not keep the MCP request open while browser authorization is in progress. Authentication is confirmed afterward by rerunning the read-only capability probe.

## Deliberate non-goals

This foundation does not provide a generic agent task runner, provider router, broker, queue, persistent job store, dashboard, result retrieval API, automatic review loop, or dynamic tool contract. Those capabilities require separate product decisions and implementation work.
