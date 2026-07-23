# Architecture

GPT Repo MCP (`gpt-repo-mcp`) is a tool-only MCP server. There is no widget in v1. The server exposes a Streamable HTTP `/mcp` endpoint plus a local health route.

## Boundaries

- `src/server.ts` owns the HTTP server, `/mcp` transport, and `/health`.
- `src/instructions.ts` contains server-wide MCP instructions for cross-tool workflows.
- `src/register.ts` creates the MCP server and registers tools.
- `src/contracts/*` contains Zod input and output contracts.
- `src/tools/contracts.ts` is the single tool-name to contract map.
- `src/tools/catalog.ts` is metadata plus handler wiring only.
- `src/tools/define-tool.ts` converts contract objects to MCP SDK schemas and registers metadata.
- `src/tools/handlers.ts` contains thin adapters from tool input to services.
- `src/services/*` contains filesystem, git, search, tree, read, write, project, task, decision, durable Codex execution/review, and advisory planning logic.
- `src/policies/*` contains shared limits, excludes, write defaults, and secret patterns.
- `src/runtime/*` contains context, structured errors, result envelopes, and audit logging.
- `scripts/runtime-supervisor.mjs` is the optional out-of-process Windows lifecycle owner for the compiled MCP server and ngrok.
- `scripts/runtime-control.mjs` writes validated user-local fixed-action requests; it is not a process runner.

## Tool Registration Flow

The intended flow is:

```text
contracts -> toolContracts -> catalog -> define-tool -> handlers -> services
```

Contracts define schemas. `toolContracts` assigns exactly one input and output contract to each tool. `catalog` adds titles, descriptions, annotations, and handlers. `define-tool` is the only layer that turns Zod objects into MCP SDK `inputSchema` and `outputSchema` shapes. Handlers resolve approved repos and call services.

This keeps `catalog` metadata-only and prevents inline schema drift.

## Data Flow

ChatGPT calls a tool with `repo_id` and repo-relative POSIX paths or globs. The handler resolves `repo_id` through `RootRegistry`, creates the required services, and returns a result envelope.

Read filesystem access goes through shared safety layers:

```text
PathSandbox -> IgnoreEngine -> FileClassifier -> SecretScanner/FileReader
```

Write filesystem access stays separate from read services:

```text
PathSandbox -> WritePolicy -> FileWriter
                         \-> WriteChangesService -> FileWriter
write handlers -> OperationReceiptService
```

`repo_write_file` has its own contract, write annotations, repo-level policy, and service. The handler only resolves `repo_id`, builds the sandbox and write policy, and delegates to `FileWriter`.

`repo_write_changes` is the multi-file writer and edit-pack applier. It has its own contract and handler, applies ordered changes through `FileWriter`, and inherits the same repo-local path validation, write policy, symlink, unsupported file type, UTF-8 edit target, hard-risk secret path, resulting-content secret scan, and atomic per-file write guardrails. Grouped same-file edits read one existing file, apply exact-match nested edits in memory, and write once only after every nested edit succeeds. It does not stage, commit, restore, reset, or run shell commands; Git review and recovery workflows are the safety layer after a successful edit pack.

`OperationReceiptService` writes lightweight local receipt metadata after successful actual changed write operations and reads it through `repo_last_write`. Receipts live at `.chatgpt/operations/last-write.json`, are ignored by Git, and contain only safe metadata such as repo-relative paths, counts, timestamps, best-effort HEAD SHAs, and summaries. They do not store contents, snippets, diffs, prompts, command output, secrets, or absolute paths.

Read-only local Git status and diff operations are owned by `GitService`. Safe local mutations remain separate opt-in tools. `RemoteGitService` owns the bounded delivery layer: exact-guarded branch creation and switching, branch inspection, standalone branch ancestry/PR audit, exact owner-approved standalone branch retirement, remote status, bounded PR listing, feature-branch push, PR create/update, owner-approved PR retirement or merge, verified post-merge finalization, workflow dispatch, and fast-forward base synchronization. `GitHubClient` owns explicit GitHub REST operations plus runtime token authentication. `GitHubCliService` owns the fixed structured `gh pr list`, `gh pr view`, and `gh pr close` invocations used by PR listing and retirement; it accepts no caller-supplied commands or flags. `AllowedScriptService` runs only locally configured script ids with fixed commands, arguments, environment inheritance, timeout, output, and HEAD guards. Advisory services call existing factual services where practical instead of bypassing repository policy.

Git recovery is separate from write tools. `repo_write_file` and `repo_write_changes` write files only. `repo_write_recover` is the reviewed composite recovery helper: after `expected_head_sha` verification it can unstage explicit paths, restore explicit tracked worktree paths, and clean explicit generated artifacts through cleanup policy in one approved call. `repo_git_restore_paths` remains the granular worktree-only restore tool with fixed `git restore -- <paths>` arguments; it does not unstage, stage, commit, reset, checkout, clean, stash, restore the whole repo, or run shell commands.

`repo_git_review` remains read-only, but it is the workflow hub after write operations. It classifies changed paths and returns ready-to-run payloads for composite `repo_write_stage_commit` and `repo_write_recover` workflows, plus granular explicit worktree restore, cleanup-eligible generated untracked paths, unstage, stage, and commit operations without executing any of them. When staged paths exist, it adds guidance that granular restore is worktree-only while `repo_write_recover` can explicitly unstage and restore the same reviewed path in one approved call.

The preferred high-level mutation flow is `repo_git_review` followed by the review-provided `repo_write_stage_commit` or `repo_write_recover` payload within the already authorized implementation or recovery task. Granular tools remain available for specific requested operations, staged-only commits, troubleshooting, or cases where composite payloads are absent.

When work starts on a base branch, the reviewed delivery continuation begins with `repo_write_create_branch`, which creates a new branch from the exact current source branch and HEAD and may carry reviewed index/worktree state. Existing clean branches can be inspected with `repo_git_branches` and opened with `repo_write_switch_branch` under separate branch-management policy. After local review and commit, delivery continues through `repo_write_push` → `repo_write_pull_request` → `repo_remote_status`. `repo_remote_pull_requests` provides bounded repository-wide PR listing through fixed structured GitHub CLI arguments. Draft-ready remains a fixed allowlisted GitHub CLI wrapper. An explicitly owner-approved open, unmerged PR can be closed with `repo_write_retire_pull_request`; the tool verifies the exact PR head SHA, confirms no other open PR uses the head branch, invokes `gh pr close` without `--delete-branch`, verifies closure, and then delegates exact local and origin ref cleanup to the existing guarded Git layer. The normal merge flow stops for explicit owner approval before `repo_write_merge_pull_request`. After GitHub confirms the merge, `repo_write_finalize_pull_request` can synchronize and switch to the base and delete only refs proven to match the exact merged PR head. Remote state changes use exact local, branch, ref, and pull-request head guards. `repo_write_dispatch_workflow` and `repo_run_allowed_script` provide bounded remote and local validation without accepting caller-supplied commands.

## Durable Codex execution

The Codex path is deliberately split into task creation, bounded start, detached execution, and read-only review:

```text
repo_write_codex_task
  -> PROMPT.md + schema-v2 run.json
repo_start_codex_task
  -> CodexExecutionService preflight
  -> execution.json starting
  -> detached scripts/codex-task-runner.mjs
repo_codex_review
  -> CodexReviewService
  -> execution state + legacy result reader + GitReviewService
```

`CodexExecutionService` owns caller-facing preflight. It verifies exact branch and HEAD, clean non-base state, exact run paths and manifest identity, prompt SHA-256, non-empty allowed paths, absent prior execution/result/output artifacts, gitignored local artifacts, and single-writer ownership. It then verifies CLI capability and read-only authentication plus one real isolated `workspace-write` operation. The probe artifact is removed and branch, HEAD, index, and worktree are rechecked before durable execution state is created. CLI flag detection alone is not a sandbox guarantee. The caller supplies no command, arguments, prompt, model, sandbox, runtime, environment, working directory, or delivery behavior.

The service writes a durable `starting` state and launches `scripts/codex-task-runner.mjs` as a detached Node process. The MCP request returns after the runner records `running` or a terminal state; the complete Codex lifetime is not coupled to one connector request. A repository has at most one active Codex writer through `.chatgpt/codex-runs/.active-codex.lock`. A stale lock is replaceable only after process absence is verified. There is no central registry, queue, broker, or database.

Each run owns local gitignored artifacts under its exact directory: `execution.json`, `stdout.jsonl`, `stderr.log`, and `RESULT.md`. State transitions are safe and bounded. Execution state carries versioned evidence for the requested sandbox, bootstrap verification, detected sandbox failure and code, execution-boundary result, fallback-tool violations, and safe warnings. Older state remains parseable through defaults, but missing evidence is unverified.

The runner uses the shared verified CLI resolution and process layer, fixed non-interactive JSONL arguments, `workspace-write`, the exact repository root, prompt input via stdin, a restricted environment, bounded redacted output, and complete process-tree termination at timeout. `scripts/codex-execution-boundary.mjs` classifies structured JSONL plus known bounded diagnostic markers. A successful built-in `command_execution` or `file_change` event after verified bootstrap is positive operation provenance. External MCP tools, Node/JavaScript REPL filesystem or Git operations, and material changes without positive built-in provenance fail closed.

Terminal classification is deliberately ordered so control-boundary failures cannot be masked by later success signals: timeout; truncation or malformed output; process-start or sandbox-bootstrap failure; unsandboxed fallback or unknown write provenance; nonzero exit; invalid result; branch, HEAD, index, Git-ref, run-artifact, forbidden-path, or allowed-scope violation; and only then `completed` or `blocked`. A correct Git diff, zero exit code, or valid `RESULT.md` cannot override an earlier boundary failure. The runner records evidence and never restores, stages, commits, pushes, branches, merges, retries, or starts another run automatically.

`CodexReviewService` composes durable execution state with the existing manual result parser and `GitReviewService`. Active and terminal durable runs expose the requested sandbox, bootstrap result, sandbox failure and code, fallback-tool violations, execution-boundary result, and a safe classification reason. Verified terminal success returns parsed result plus Git review. A `completed` or `blocked` state without positive boundary evidence is not trusted, including older durable state where the new evidence is absent. Failure and timeout return safe diagnostics and the same guarded recovery payloads as normal change review. Runs without `execution.json` continue through the separate legacy manual result path.

Current Codex JSONL identifies built-in command/file-change and MCP tool event classes but does not expose a separate per-operation sandbox-attestation field. The architecture therefore combines a real isolated sandbox bootstrap, structured event classification, known failure detection, and positive built-in operation provenance. A future stronger structured provenance contract should replace this limitation without loosening fail-closed behavior. The model-cache warning `missing field supports_reasoning_summaries` is a safe non-blocking warning only while JSONL and provenance remain complete; malformed or incomplete output still fails closed.

## Runtime Supervision

The optional Windows runtime deliberately lives outside `src/server.ts`. A process that handles MCP requests cannot provide reliable crash recovery or safely replace itself while returning the request that initiated the replacement.

`runtime-supervisor.mjs` is started by a current-user Task Scheduler task. It owns the compiled `dist/server.js` child and either reuses an active ngrok agent or owns an ngrok child. MCP and tunnel failures are isolated and restarted independently. Heartbeat, lock, log, and control documents live under user-local application data rather than the repository.

`runtime-control.mjs` supports only versioned fixed actions. The allowlisted ChatGPT path exposes status and delayed MCP-only restart. It accepts no executable, command text, argument, path, or environment override from the caller. A delayed request lets the current MCP tool response complete before the supervisor replaces the server child. The tunnel remains active during ordinary MCP reloads.

## Advisory Planning Workflows

The advisory tools are read-only:

- Onboarding/daily planning: `repo_project_brief` -> `repo_task_inventory` -> `repo_next_action`
- Project memory: `repo_decision_memory`
- Implementation/refactor/debug planning: `repo_decision_memory` when conventions matter -> `repo_change_plan` -> targeted `repo_search`/`repo_fetch_file`/`repo_read_many`
- Current-change review: `repo_git_status` -> `repo_git_diff`
- Broad or ambiguous review: `repo_plan_review` before broad reading

`repo_next_action` recommends next work; it does not execute tests. `repo_change_plan` proposes implementation steps; it does not write files.

## Adding a Tool

Add a new tool by following the contract-first path:

1. Add input and output Zod objects under `src/contracts/*`.
2. Add the tool entry to `src/tools/contracts.ts`.
3. Add a concise `Use this when...` description in `src/tools/descriptions.ts`.
4. Add metadata and the handler reference in `src/tools/catalog.ts`.
5. Add a thin handler in `src/tools/handlers.ts`.
6. Put real logic in a service under `src/services/*`.
7. Add service tests, MCP contract coverage, tool contract discipline tests, and golden prompts when routing changes.

Do not duplicate path validation, ignore handling, secret scanning, schema definitions, or result envelope logic inside individual tools.

## Mutating Tools

Mutating tools are disabled by default per repository and must be enabled through explicit repo-local policy. `repo_write_file` can write or exact-match edit one file inside configured allowed globs and outside configured denied globs. `repo_write_changes` applies the same write/edit semantics to an ordered multi-file edit pack and supports grouped same-file exact-match edits without allowing duplicate top-level paths.

Mutating tools must stay separate from read tools. Do not loosen read services to support mutation, do not add shell execution, and do not add broad git automation. Safe git tools stage explicit paths, unstage explicit paths, restore explicit worktree paths, or create a local commit from an exact staged path list only after policy and HEAD checks. Cleanup tools remove only explicit generated artifacts allowed by cleanup policy.
