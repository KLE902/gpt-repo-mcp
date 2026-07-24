# Agent Task Orchestration (ATO) Architecture

Status: **proposed; owner ratification pending**.

## 1. Architectural objective

Provide one durable, policy-controlled task lifecycle for Claude Code and Codex without turning GPT Repo MCP into a general command runner or orchestration platform.

The architecture must support the current read-only architecture need first and remain additive if future work introduces independent review, provider write adapters, isolated parallel activities, and integrated delivery verification.

## 2. Three assurance layers

The system keeps three distinct questions separate.

### Execution boundary

Did the provider run against the intended repository, branch, HEAD, context, access profile, and server-owned CLI boundary?

### Acceptance verification

Do repository state and run artifacts support the provider's completion claims?

### Semantic review

Is the result correct, coherent, maintainable, and consistent with product and architecture authority?

The first layer is mandatory for every durable run. The second and third are separate gates. A zero exit code, a valid result file, green CI, or a second model's agreement cannot substitute for the other layers.

## 3. Primary components

```text
ChatGPT coordinator / integrator
        |
        v
repo_write_agent_task
        |
        v
immutable task package + context snapshot
        |
        v
repo_start_agent_task
        |
        v
AgentTaskExecutionService
        |
        +--> CodexReadOnlyAdapter
        +--> CodexWorkspaceWriteAdapter
        +--> ClaudeReadOnlyAdapter
        +--> ClaudeWorkspaceWriteAdapter       # deferred
        |
        v
durable state, logs, result wrapper
        |
        v
repo_agent_review
        |
        v
ChatGPT synthesis / owner decision
```

The future names above describe the target surface. Existing Codex-specific tools remain authoritative until migration is implemented and may remain as compatibility aliases.

## 4. Task lifecycle

### Create

`repo_write_agent_task` writes a new immutable task package. It owns task rendering, context selection, manifest creation, prompt hashing, result contract selection, path validation, and policy checks.

### Verify and start

`repo_start_agent_task` starts only an existing verified task package. Its caller supplies only stable identity and stale-state guards, for example:

```text
repo_id
run_id
expected_branch
expected_head_sha
dry_run
reason
```

The caller does not supply executable, command, arguments, provider flags, prompt text, tool permissions, environment, working directory, timeout, model, sandbox, or Git delivery behavior at start time. Those values come from the verified manifest, implementation, and local policy.

### Execute

A provider adapter runs through a server-owned process boundary with bounded input, output, environment, timeout, process-tree termination, and provider-specific validation.

### Review

`repo_agent_review` reads durable state, validated structured result, safe diagnostics, context identity, boundary evidence, and applicable Git review. It does not accept the provider's narrative as repository truth.

## 5. Task package

Proposed repo-local layout:

```text
.chatgpt/agent-runs/<run-id>/
  TASK.md
  run.json
  execution.json
  stdout.jsonl
  stderr.log
  RESULT.json
  RESULT.md
```

`TASK.md` is the human-readable contract. `run.json` is the immutable machine contract. `RESULT.json` is the validated structured result. `RESULT.md` is an optional human-readable rendering and must not outrank `RESULT.json`, execution evidence, or Git state.

An `ATO-nnn` capability work package is distinct from this durable task package. The work package, when used, is the owner-ratified semantic authority for one bounded capability delivery. The durable task package binds to the exact work-package path, commit SHA, and blob identity and adds provider, repository, context, access, runtime, and result-envelope details. It must not semantically rewrite the approved outcome, scope, exclusions, or acceptance criteria.

This reference should be added under a new schema version only when the generic lifecycle consumes a real work package. It is not retrofitted into the current Codex manifest merely to reserve fields.

## 6. Minimal versioned manifest seam

The initial provider-neutral manifest should stay small:

```json
{
  "schema_version": 1,
  "repo_id": "premium-komga-reader",
  "run_id": "...",
  "provider": "claude",
  "task_kind": "architecture_position",
  "access_profile": "read_only",
  "orchestration": "architecture_review",
  "title": "...",
  "objective": "...",
  "branch": "master",
  "head_sha": "<40-char-sha>",
  "prompt_path": ".chatgpt/agent-runs/.../TASK.md",
  "prompt_sha256": "<sha256>",
  "context_snapshot": {
    "schema_version": 1,
    "authority_files": [],
    "task_files": [],
    "file_hashes": {}
  },
  "result_schema_version": 1,
  "created_at": "..."
}
```

Task semantics, access, and orchestration are separate axes:

- `provider`: which adapter executes the task;
- `task_kind`: what intellectual or implementation product is requested;
- `access_profile`: what the provider may do;
- `orchestration`: how this task relates to a wider workflow.

No provider is permanently assigned to drafting, architecture, implementation, or review.

## 7. Context snapshots and read consistency

A context snapshot binds the task to exact project authority rather than embedding uncontrolled or stale copies in the caller's prompt.

The snapshot records:

- repository and exact HEAD;
- authority files selected for the task;
- task-specific files or bounded globs;
- content hashes or an equivalent exact identity mechanism;
- exclusions and maximum context limits.

The provider reads the actual repository files. The manifest proves which material was intended.

For every read-only run, MCP must verify repository identity, branch, HEAD, clean state, and every declared context hash immediately before provider start and again when collecting the result. Any mismatch is classified fail-closed as `context_drifted`. Logs and provider output are retained for diagnosis, but the structured result is invalid for synthesis, review, or decision ratification.

Start-and-result verification is the minimum initial implementation. It does not detect a file that changes temporarily during execution and is restored before result collection. The preferred stable design is therefore an immutable read snapshot pinned to the exact commit, such as a server-owned detached worktree or equivalent materialized snapshot.

A live-worktree implementation must:

- document the residual race;
- prevent known concurrent MCP writers while the read lease is active;
- verify branch, HEAD, index, worktree, and context hashes at start and collection;
- fail closed rather than downgrade drift to a warning.

For PKR, typical authority may include `AGENTS.md`, `PROJECT_STATE.md`, `FEATURES.md`, the design specification, the active backlog item, relevant architecture decisions, and targeted implementation files. Selection remains task-specific; every task does not automatically receive the whole repository.

## 8. Result wrapper

The durable result wrapper is part of the stable seam:

```json
{
  "schema_version": 1,
  "run_id": "...",
  "provider": "claude",
  "task_kind": "architecture_position",
  "status": "completed",
  "session_id": "...",
  "started_at": "...",
  "finished_at": "...",
  "usage": {},
  "warnings": [],
  "raw_log_ref": "stdout.jsonl",
  "structured_result": {}
}
```

`structured_result` is explicitly versioned by task kind and may begin with a small schema. Architecture positions, specification critiques, code reviews, and implementation reports do not need one premature universal payload.

Provider-supported schema output may be used, but MCP parses and validates every result independently. Provider enforcement is not the trust boundary.

A terminal process state and a valid payload are not sufficient when the context or execution boundary is invalid. The durable review surface must expose both the provider status and the boundary classification.

## 9. Provider adapters

### Shared responsibilities

Every adapter must provide:

- verified CLI resolution and version reporting;
- non-interactive authentication verification;
- fixed server-owned invocation;
- explicit repository or immutable-snapshot working directory;
- bounded and redacted output;
- timeout and complete process-tree termination;
- structured-output parsing;
- MCP-owned schema validation;
- safe error classification;
- unchanged repository and context verification for read-only tasks;
- invalidation on any context drift.

### Codex adapters

The current durable Codex workspace-write runner remains the first concrete implementation. Its sandbox and provenance guarantees must not be weakened during generalization.

A Codex read-only adapter may share process and structured-event infrastructure but has a different access contract from workspace-write execution.

### Claude read-only adapter

The first Claude adapter is read-only and intended for architecture positions, specification critique, and independent review.

Its exact invocation must be established through implementation-time capability verification. Candidate controls include:

- headless print mode;
- structured JSON output and a provider schema where supported;
- explicit tool exposure or denial;
- bounded turns, timeout, and cost when supported;
- no Edit, Write, NotebookEdit, or unrestricted Bash;
- unchanged branch, HEAD, index, worktree, and context hashes after execution.

`--bare`, permission modes, tool allowlists, authentication behavior, and repository access must be verified together. No individual Claude flag is assumed to be a complete read-only sandbox.

### Claude workspace-write adapter

Deferred. It requires a separate threat model and empirical verification of Windows behavior, tool permissions, filesystem and Git provenance, subprocess behavior, and fail-closed detection. It is not implemented by renaming the Codex adapter.

## 10. Orchestration ownership

ChatGPT creates, starts, reads, and synthesizes explicit tasks. MCP does not hide multiple providers behind one opaque multiagent call.

For an Architecture Review (AR), ChatGPT creates independent tasks with the same decision brief and context snapshot, starts them separately, reads the results, and produces a synthesis. A targeted rebuttal is a new visible task, not an invisible recursive loop. AR is a workflow with temporary roles, not a permanent model group.

MCP owns durable facts:

- task identity;
- context identity;
- state transitions;
- provider and access profile;
- process and boundary evidence;
- parent and delivery relations when later introduced.

Conversation memory is not the only store of a multi-task delivery.

## 11. Future coordination extension

The initial read-only lifecycle does not require a dependency graph. The provider-neutral manifest may later gain an optional, separately versioned extension:

```json
{
  "coordination": {
    "schema_version": 1,
    "delivery_id": "...",
    "orchestration_id": "...",
    "parent_run_id": null,
    "depends_on": [],
    "integration_of": []
  }
}
```

These fields support future work without making the initial runner a scheduler:

- `delivery_id` groups activities contributing to one deliverable;
- `orchestration_id` groups tasks in one AR or coordinated workflow;
- `parent_run_id` records refinement or repair lineage;
- `depends_on` represents explicit prerequisites;
- `integration_of` identifies component runs combined by an integration task.

The extension should be added when a real workflow consumes it. It should not be retrofitted as unused top-level fields in the current Codex schema.

## 12. Future multi-agent write delivery

A later multi-agent delivery may use:

```text
one delivery
  -> multiple task packages
  -> one isolated branch/worktree per writer
  -> explicit dependencies
  -> integration task
  -> integrated HEAD verification
  -> semantic review
  -> owner-controlled delivery
```

Component completion does not imply delivery completion. The integrated HEAD becomes a separate verification target:

```text
component_tasks_completed
integration_completed
integrated_head_verified
semantic_review_accepted
validation_passed
delivery_ready
```

Overlapping allowed paths, lockfiles, generated files, migrations, and dependency updates require explicit conflict and integration policy.

## 13. Security invariants

The architecture must preserve:

- no arbitrary caller-supplied executable or command;
- no prompt, provider flags, tool permissions, or environment supplied at start time;
- exact repository, branch, and HEAD guards;
- start-and-result context verification with fail-closed `context_drifted` classification;
- immutable task identity and prompt hash;
- server-owned provider invocation and environment allowlist;
- read-only verification for read-only tasks;
- one active writer per worktree;
- separate provider-specific write boundaries;
- bounded runtime, output, turns, and cost where available;
- no automatic retry, repair, commit, push, merge, or owner decision;
- fail-closed classification when required boundary evidence is missing.

## 14. Migration strategy

1. Preserve existing Codex behavior and tests.
2. Extract only lifecycle components needed by both durable Codex and the first Claude read-only adapter.
3. Introduce generic contracts under new schema versions.
4. Keep existing Codex tool names as compatibility aliases until users and documentation migrate.
5. Do not migrate old run artifacts in place. Review them through legacy compatibility; create new tasks under the new format.
6. Add richer result and coordination schemas only from observed task types and workflows.
