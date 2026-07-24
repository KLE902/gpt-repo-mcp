# Agent Task Orchestration Baseline Evidence

Status: **verified evidence supporting proposed ratification**.

Verified on: **2026-07-24**.

## 1. Purpose and evidence boundary

This file records mechanically checkable facts that the proposed architecture depends on. It distinguishes repository and GitHub evidence from host-local operational claims that must be re-probed before implementation.

The proposed architecture documents remain design authority only after owner ratification. This evidence file does not claim that provider-neutral tasks, durable Claude execution, or multi-agent delivery already exist.

## 2. GPT Repo MCP repository baseline

Verified base state before PR #20:

- repository: `KLE902/gpt-repo-mcp`;
- base branch: `main`;
- local and `origin/main`: `d154702e2d0c5ca812b967e45c0e1e92667e918a`;
- worktree was clean before the documentation branch was created.

Merged capability pull requests:

| PR | Capability | Reviewed head | GitHub checks |
| --- | --- | --- | --- |
| #17 | Reusable agent CLI capability foundation | `f1226a5d84879c15513dfe5ca99d982dc384383b` | Node 20, Node 22, Windows desktop launcher: success |
| #18 | Durable Codex task execution | `3b0ce80fea77165532db3fb1bc575bbe7221c23a` | Node 20, Node 22, Windows desktop launcher: success |
| #19 | Fail-closed Codex sandbox boundary enforcement | `176b91ae9a690f459dc738c4074f1242d2a6f47f` | Node 20, Node 22, Windows desktop launcher: success |

All three pull requests are merged and closed against `main`.

## 3. Implemented Codex contract evidence

The current repository contains a Codex-specific durable lifecycle, not the proposed provider-neutral lifecycle.

Implemented contract and service evidence includes:

- `src/contracts/codex-task.contract.ts` — schema-v2 immutable task manifest, execution-state schema, exact run identity, prompt hash, branch and HEAD guards, bounded start contract, and review result contract;
- `src/services/codex-task-service.ts` — task rendering, immutable run creation, prompt hashing, allowed and forbidden paths, and refusal to reuse an existing run;
- `src/services/codex-execution-service.ts` — policy opt-in, exact branch and HEAD preflight, clean worktree, task integrity, CLI verification, durable state, detached runner start, and single-writer lock;
- `scripts/codex-task-runner.mjs` and `scripts/codex-execution-boundary.mjs` — bounded execution, terminal classification, timeout handling, sandbox failure detection, and positive write-provenance requirements;
- `repo_write_codex_task`, `repo_start_codex_task`, and `repo_codex_review` — separate create, narrow start, and review tools.

Current start callers cannot supply arbitrary command text, executable, model, reasoning level, sandbox, timeout, environment, working directory, verification commands, or Git delivery behavior.

## 4. Regression-test evidence

Current test coverage includes:

### Durable execution service

`tests/codex-execution-service.test.ts` covers, among other cases:

- fixed server-owned Codex invocation;
- durable starting and running state;
- dry-run validation without execution artifacts;
- disabled-by-default execution policy;
- exact repository, branch, and HEAD identity;
- rejection of base-branch and dirty-worktree execution;
- prompt and task-manifest integrity;
- non-empty bounded allowed paths;
- refusal to reuse result, execution, stdout, or stderr artifacts;
- gitignored run-artifact requirements;
- single-writer locking and stale-lock handling;
- startup timeout and process-tree failure handling;
- schema-v2 task writer behavior.

### Execution-boundary classification

`tests/codex-execution-boundary.test.mjs` covers:

- verified sandbox bootstrap plus positive built-in operation provenance;
- built-in file-change and command events;
- known Windows sandbox and helper-launch failures;
- external MCP and Node REPL boundary violations;
- unknown write provenance;
- malformed or missing boundary evidence;
- bounded non-blocking warning classification.

### Agent CLI capability probe

`tests/agent-cli-probe.test.mjs` covers:

- bounded Codex and Claude read-only invocation construction;
- Windows Claude CLI candidate resolution;
- npm-installed Claude package resolution;
- verified Git Bash requirements for native Windows Claude;
- unchanged Git state before and after probe execution;
- workspace-write probe cleanup;
- fail-closed dirty-worktree and provider-failure behavior;
- structured provider markers and malformed output rejection;
- explicit environment inheritance allowlists.

### MCP contracts

`tests/mcp-contract.test.ts` and `tests/tool-contracts.test.ts` cover registration and schema discipline for the Codex task tools.

The proposed generalization must preserve these protections or replace them with equivalent or stronger regression coverage.

## 5. Host-local operational evidence

The following was operationally verified during the completed post-merge workstream:

- Claude Code was installed and authenticated;
- a bounded non-interactive Claude read-only JSON probe passed;
- durable Codex execution passed a repository-local workspace-write smoke test;
- the Codex smoke artifact and run directory were cleaned up;
- normal repository policy was restored with `codex_task_run_enabled: false`.

These facts depend on the current Windows host, installed CLI versions, authentication, and local configuration. Before the Phase 0.5 spike or Phase 1 implementation, the exact host must re-run the relevant capability probes and record current versions and outcomes. Repository tests alone do not prove current host readiness.

## 6. PKR pilot and project-state evidence

The Premium-Komga-Reader repository confirms that the former pilot is complete rather than active:

- PR #8, `Deliver PKR-003 keyboard context actions and close pilot`, is merged; reviewed head `54d1afe790c45116e8e940c9aeeb92c1664ae6f6`;
- PR #9, `Update project state after PKR-003 merge`, is merged; reviewed head `c86a4734e220c281ee575a89288e5bb7be2ae819`;
- PR #10, `Stabilize PROJECT_STATE baseline ownership`, is merged; reviewed head `0095a71a5093f86c72cd52b95f79d8d8b1cbbb2b`;
- `PROJECT_STATE.md` states that PKR-003 is delivered, technically accepted, and closed;
- `PROJECT_STATE.md` states that no second pilot, permanent coder-reviewer-closure pipeline, or general multiagent rollout is active;
- `docs/multiagent-workflow/` remains historical evidence and is not current workflow authority.

The new orchestration foundation is therefore a separate capability initiative driven by manual transport cost, not a continuation of the retired PKR-003 rollout proposal.

## 7. Evidence still required before Phase 1

Ratification of the design direction does not waive these implementation-time checks:

- current Claude and Codex CLI versions and authentication;
- actual `--bare`, permission, tool-exposure, structured-output, turn, timeout, and cost behavior on the installed Claude version;
- end-to-end unchanged repository and context verification for read-only runs;
- measured owner transport frequency and effort;
- successful Phase 0.5 direct transport spike;
- exact regression comparison showing no weakening of durable Codex execution.

Any failed or unverifiable boundary blocks progression rather than being converted to a warning.
