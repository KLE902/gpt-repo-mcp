# Agent Task Orchestration Foundation

Status: **proposed; owner ratification pending**.

## Purpose

This initiative removes the owner from the manual prompt-and-result relay between ChatGPT, Claude Code, and Codex while preserving GPT Repo MCP's fail-closed repository and execution boundaries.

The long-term goal is not a generic multiagent platform. It is a small, durable task lifecycle that can support:

- read-only architecture positions and reviews from Claude or Codex;
- sequential specification drafting and critique;
- one-agent implementation followed by independent review;
- later, multiple isolated implementation activities contributing to one delivery.

The design is transport-first. It stabilizes how a verified task enters a provider and how a durable result returns. Rich claim, evidence, verdict, routing, and orchestration semantics are added only when real use justifies them.

## Verified baseline

As of July 2026:

- durable Codex workspace-write execution is implemented, merged, and smoke-tested;
- Codex execution uses an immutable repo-local task, narrow start boundary, exact repository/branch/HEAD guards, single-writer ownership, bounded output and runtime, and fail-closed sandbox evidence;
- Claude Code is locally installed and authenticated;
- the Claude CLI supports a bounded non-interactive read-only capability probe with structured output;
- durable Claude tasks, provider-neutral task packages, automated architecture deliberation, and multi-agent write delivery are not implemented.

The mechanical evidence behind these statements is recorded in [`BASELINE_EVIDENCE.md`](BASELINE_EVIDENCE.md). Host-local capability claims must be re-probed before implementation because installed versions, authentication, and runtime configuration may change.

Current capability remains defined by the implemented tools and effective local policy. This proposal does not claim that future capabilities already exist.

## Decision summary

The proposed direction is:

1. Generalize the existing create → verify → start → review lifecycle, not the caller-facing command surface.
2. Keep task creation separate from task start. A start call references an existing immutable task by repository, run id, branch, and exact HEAD; it does not supply arbitrary prompt text, commands, tools, provider flags, environment, or sandbox settings.
3. Put provider-specific CLI behavior behind adapters.
4. Keep `provider`, `task_kind`, `access_profile`, and `orchestration` as separate concepts.
5. Bind each task to an exact context snapshot of repository authority files and task-specific files.
6. Treat the decision brief itself as reviewable input. Independent providers must challenge framing, missing alternatives, and context selection before answering.
7. Let ChatGPT coordinate visible tasks and synthesize results. MCP owns transport, durable state, policy, and execution boundaries; it is not a hidden multiagent engine.
8. Use one writer per worktree. Read-only tasks may run independently; concurrent writers require separate worktrees and later integration verification.
9. Fail closed when repository or context identity changes during a read-only run. Prefer an immutable read snapshot pinned to an exact commit when the implementation can support it.
10. End architecture work in a proposed decision record. The owner ratifies the decision before authoritative project documentation changes.
11. Fix only a small, versioned result wrapper initially. Let task-specific structured payloads evolve from real use.
12. Prove direct Claude transport with a bounded spike before committing to the full provider-neutral lifecycle refactor.
13. Add deterministic claim verification only when observed false-completion risk, delivery scale, or multi-agent integration makes it worthwhile.

## Project success criterion

The first implementation phase succeeds only when a real PKR architecture or specification question can be sent to Claude and Codex, returned, and synthesized without the owner copying prompts or results between tools.

An elegant manifest or adapter abstraction is not sufficient evidence of success.

## Relationship to the completed PKR-003 pilot

The completed PKR-003 pilot remains historical evidence in the Premium-Komga-Reader repository. It did not establish a permanent Codex-coder/Claude-reviewer pipeline or a general multiagent rollout.

This initiative is a new capability project with a different trigger:

- the old pilot tested a bounded product-delivery workflow;
- this project removes manual agent transport and establishes a reusable task seam;
- it does not reactivate Pilot #2, fixed vendor roles, parallel writing, a broker, queue, dashboard, or general orchestration roadmap.

The PKR repository remains the consumer and dogfooding environment. GPT Repo MCP owns the execution and transport architecture.

## Document map

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — target boundaries, task lifecycle, manifests, adapters, context snapshots, security invariants, and future multi-agent extension points.
- [`OPERATING_MODEL.md`](OPERATING_MODEL.md) — roles, specification refinement, independent architecture deliberation, implementation review, decision records, and stop rules.
- [`DELIVERY_PLAN.md`](DELIVERY_PLAN.md) — phased implementation, transport spike, exit criteria, measured gates, and deferred capabilities.
- [`BASELINE_EVIDENCE.md`](BASELINE_EVIDENCE.md) — mechanically checkable repository, pull-request, test, and PKR-state evidence that supports ratification.

## Permanent non-goals

Unless a later owner-ratified decision replaces them, this initiative does not provide:

- free-form agent chat rooms;
- a caller-supplied command runner;
- permanent provider-to-role assignment;
- mandatory multiagent review for every change;
- automatic consensus as a quality guarantee;
- multiple writers in one worktree;
- unlimited repair or debate loops;
- a generic provider router, broker, queue, dashboard, or central job database;
- automatic commit, push, pull request, merge, or decision ratification;
- product-delivery work that displaces PKR development without measured benefit.

## Ratification

Owner ratification should confirm or amend:

- the common task lifecycle;
- the separation of task semantics, access, and orchestration;
- read-only Claude and Codex as the first durable delivery slice;
- open ChatGPT coordination instead of hidden MCP orchestration;
- mandatory provider challenge of decision-brief framing;
- fail-closed context-drift handling and the preferred immutable read-snapshot direction;
- a bounded transport spike before the full provider-neutral lifecycle build;
- context snapshots and proposed decision records;
- the phase gates, evidence baseline, and non-goals in this document set.
