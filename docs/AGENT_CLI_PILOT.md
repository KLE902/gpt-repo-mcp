# Agent CLI pilot bridge

This document owns the bounded local implementation used to prepare the PKR-003 multiagent pilot. It is not a general agent platform.

## Purpose

Use the official Codex CLI and Claude Code CLI through the existing `repo_run_allowed_script` security boundary so ChatGPT can perform the first controlled pilot without the owner copying prompts or terminal commands between products.

The first slice is `scripts/agent-cli-probe.mjs`. It:

- requires an exact clean Git worktree before execution;
- discovers the configured provider CLI from `PATH`;
- records the installed version and locally advertised non-interactive capabilities;
- invokes one minimal read-only structured-output request;
- verifies a provider-specific completion marker;
- verifies exact unchanged `HEAD` and a clean worktree after execution;
- fails closed on a missing CLI, missing capability, nonzero exit, timeout, incomplete output, malformed output, missing marker, changed `HEAD`, or dirty worktree.

No prompt, executable, argument list, working directory, timeout, output limit, or environment name is supplied by the model. Those values are owned by the script and local allowlist configuration.

## Local allowlist

The private `config.local.json` for `premium-komga-reader` may configure these fixed IDs:

- `pkr.agent.codex.probe`
- `pkr.agent.claude.probe`

Each entry runs the same probe script with a fixed provider argument. The configuration remains local and is not committed because it contains machine-specific absolute paths.

Only the environment variables required for the selected local authentication method should be inherited. Stored CLI login state normally uses the existing user-profile environment. API-key authentication, when intentionally used, may additionally inherit `OPENAI_API_KEY` for Codex or `ANTHROPIC_API_KEY` for Claude.

## One-time Claude authentication

The read-only Claude capability probe fails closed when the terminal CLI has no credentials. `scripts/start-claude-login.ps1` is the bounded one-time recovery path on Windows. It opens a visible PowerShell child, runs the official `claude auth login` flow, and returns only the marker `CLAUDE_AUTH_LOGIN_STARTED` to the MCP caller. The child verifies `claude auth status` before it closes; ChatGPT independently reruns the read-only capability probe after the owner completes browser authorization.

The launcher does not keep the MCP request open while the owner interacts with Anthropic, because connector timeouts are shorter than an OAuth login. It never reads, prints, stores, or returns an OAuth token or API key. Account authorization remains a direct owner-to-Anthropic action; it is not prompt or command relaying between ChatGPT and an agent.

## Non-goals before PKR-003

The first pilot does not introduce:

- a generic agent broker;
- a background queue or persistent job database;
- provider-neutral dynamic arguments;
- a dashboard, message bus, status API, cancel API, or resume API;
- parallel writers;
- automatic recursive review loops.

After both probes pass, the next slice adds exactly two fixed pilot wrappers: one Codex executor and one detached-worktree Claude reviewer. Any richer lifecycle support requires evidence from the completed pilot.
