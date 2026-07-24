# Agent Task Orchestration (ATO) Delivery Plan

Status: **ratified by owner 2026-07-24**.

## 1. Delivery objective

Remove manual ChatGPT ↔ Claude ↔ Codex prompt transport for real PKR architecture and specification work, while establishing an additive foundation for future independent review and multi-agent delivery.

Implementation belongs in GPT Repo MCP. PKR supplies real decision and delivery cases for dogfooding but does not carry the orchestration infrastructure as product code.

## 2. Governing delivery principles

- Prove value on a real workflow before expanding the control plane.
- Preserve current Codex security and durable-run behavior during refactoring.
- Build read-only provider support before new write boundaries.
- Generalize from two concrete providers, not from imagined future providers.
- Stabilize task lifecycle and result wrapper; defer rich semantic schemas.
- Keep orchestration visible in ChatGPT and durable facts in MCP.
- Treat the decision brief as reviewable input.
- Fail closed on repository or context drift.
- Do not make PKR product delivery wait for optional orchestration sophistication.

## 3. Phase 0 — Ratify the foundation

### Scope

- Review and ratify this document set and its mechanical baseline evidence.
- Record a bounded estimate of how often manual ChatGPT ↔ Claude ↔ Codex transport occurs and how much owner effort it consumes.
- Record the architectural decision that the project uses a common durable task lifecycle with provider adapters.
- Confirm `provider`, `task_kind`, `access_profile`, and `orchestration` as separate axes.
- Confirm context snapshots, provider framing challenge, open ChatGPT coordination, owner-ratified decision records, one writer per worktree, and bounded rounds.
- Confirm the permanent non-goals.

### Deliverables

- ratified architecture direction;
- verified baseline evidence for current Codex, Claude-probe, pull-request, and PKR-state claims;
- documented frequency and effort estimate for the current transport problem;
- explicit success metric for the transport spike and Phase 1;
- bounded first dogfooding question;
- list of current Codex behaviors that must remain unchanged.

### Exit criteria

- no unresolved disagreement about the create/start/review seam;
- no hidden requirement for a general inline dispatch or command runner;
- the current baseline is mechanically verified;
- the transport problem is frequent or costly enough to justify at least the bounded spike;
- the first durable implementation slice remains limited to read-only tasks.

### Timebox

This is a decision batch, not a prolonged design programme. It ends when implementation constraints are clear enough for the bounded transport spike.

### Work-package naming

`ATO-nnn` identifies a bounded capability work package within this project and remains separate from `PKR-nnn` product needs. A work package is the owner-ratified semantic delivery authority; a durable task package is an executable instance that binds to the exact work-package path, commit, and blob identity and adds the current operational envelope without changing the approved outcome, scope, exclusions, or acceptance criteria.

The first expected work package is `ATO-001 — Bounded Claude transport spike`. A permanent work-package template or generalized requirement process is deferred until actual use shows which fields are necessary.

## 3.5. Phase 0.5 — Bounded transport spike (expected ATO-001)

### Purpose

Test the user value and host boundary of direct Claude transport before committing to the full provider-neutral lifecycle refactor.

### Scope

- use one fixed read-only task file against an exact repository and HEAD;
- start Claude through a server-owned allowlisted wrapper or equally bounded temporary MCP path;
- collect structured output into a deterministic local result artifact;
- return that result to ChatGPT through MCP without owner copy-paste;
- verify unchanged branch, HEAD, index, worktree, and declared context hashes;
- timebox the spike and treat its code as disposable unless it cleanly fits the later lifecycle.

The spike is not a second permanent Claude runner, a generic dispatch tool, or a substitute for the Phase 1 contracts.

### Exit criteria

- ChatGPT starts one real Claude analysis without the owner relaying the prompt;
- ChatGPT receives the result without the owner relaying the response;
- the read-only and context boundaries either pass or fail with an explicit classification;
- owner effort, elapsed time, and residual manual steps are recorded;
- the owner decides whether the measured value justifies Phase 1.

A spike that still requires manual result transport does not satisfy the purpose.

## 4. Phase 1 — Common durable read-only task lifecycle

### Scope

- introduce a provider-neutral task package and result wrapper under new schema versions;
- extract only lifecycle services shared by current Codex execution and read-only providers;
- implement `ClaudeReadOnlyAdapter` and `CodexReadOnlyAdapter`;
- bind tasks to exact repository, branch, HEAD, and context snapshot;
- add server-owned structured-output validation;
- expose narrow create, start, and review operations;
- preserve existing Codex-specific tool behavior through compatibility or unchanged paths.

### Claude verification work

Before relying on the adapter, verify on the actual Windows host:

- CLI resolution and authentication in the intended runtime environment;
- headless output completeness;
- structured output behavior and MCP-side validation;
- effects of `--bare` on authentication and configuration;
- permission modes and exact tool exposure;
- no repository or Git mutation;
- timeout, turn, usage, and available cost boundaries.

No single flag is accepted as a complete read-only boundary without an end-to-end probe.

### Exit criteria

A real PKR architecture question is dispatched independently to Claude and Codex and returned to ChatGPT without manual copy-paste.

The run must demonstrate:

- the same verified decision brief and context snapshot;
- mandatory brief-framing challenge in each independent position;
- separate durable run identities;
- complete, validated results;
- unchanged repository state and context hashes at result collection;
- fail-closed `context_drifted` classification when pinned input changes;
- bounded usage and runtime;
- readable failure classification;
- no regression to durable Codex execution.

If manual relay is still required, Phase 1 has failed regardless of code quality.

## 5. Phase 2 — Architecture Review (AR) pilot

### Scope

- select one material, genuinely uncertain PKR architecture decision as a bounded AR;
- produce a decision brief and decision criteria;
- require both providers to challenge the brief framing before answering;
- run blind independent Claude and Codex positions;
- synthesize framing objections, agreement, assumptions, conflicts, evidence gaps, and owner decisions;
- use at most one targeted rebuttal round;
- produce a proposed decision record for owner ratification.

### Objective observations

- manual transport steps eliminated;
- owner time spent on transport and coordination;
- number of provider runs, elapsed time, tokens, and reported cost;
- new material considerations discovered;
- false or unsupported findings;
- whether independent first positions were preserved;
- whether a rebuttal round was needed.

### Owner assessment

The owner records a separate subjective judgment:

- whether the synthesis was useful;
- whether the decision felt better supported;
- whether the additional perspective justified the cost;
- whether the workflow should be repeated, simplified, or rejected.

This assessment is decision input, not a controlled counterfactual measurement against an unknowable one-model outcome.

### Exit decision

- **Adopt:** measurable reduction in owner transport with useful independent analysis.
- **Adopt with changes:** transport succeeds but context, result, brief, or synthesis contract needs bounded correction.
- **Reject or simplify:** the workflow adds cost without sufficient owner-assessed value.

Do not build convergence engines, automatic recursive debate, or a deliberation database as part of this pilot.

## 6. Phase 3 — Sequential specification refinement

### Scope

- add `spec_draft` and `spec_critique` task kinds;
- allow the critique task to reference the draft task explicitly;
- generate a final implementation contract through ChatGPT synthesis;
- dogfood on one real PKR product batch.

### Exit criteria

- owner no longer relays the draft to the critic manually;
- final task contract is more precise than the initial draft;
- scope, acceptance criteria, validation, exclusions, and owner decisions are explicit;
- no permanent provider-to-role assignment is introduced.

## 7. Phase 4 — Deterministic completion claims, conditionally

### Trigger

Start this phase only when at least one condition is true:

- a false completion claim materially escapes current review;
- manual reconciliation of completion reports becomes a recurring cost;
- multi-agent integration requires machine-verifiable component and integrated state;
- delivery policy needs a reproducible acceptance layer before review.

### Initial scope

Implement only inexpensive deterministic claim types:

- file created, changed, or deleted;
- working tree, staged, feature HEAD, PR diff, or integrated HEAD target;
- allowed and forbidden scope;
- exact branch and commit identity;
- configured command or test receipt;
- generated artifact existence and hash where applicable.

Classify each claim as supported, contradicted, unverifiable, or human review required. Do not pretend architectural quality or UX correctness is deterministic.

### Exit criteria

The layer catches a real or intentionally reproduced false-completion class without displacing semantic review or existing validation.

## 8. Phase 5 — Write-provider and multi-agent delivery foundation

### Preconditions

- read-only lifecycle is stable and valuable;
- a real delivery benefits from decomposition;
- separate worktrees and integration justify the added control surface;
- Claude workspace-write security has been independently researched and verified if Claude will write.

### Scope

- optional `coordination` manifest extension;
- delivery, parent, dependency, and integration relations;
- safe worktree creation, ownership, and cleanup;
- one writer per worktree;
- explicit write scopes and overlap detection;
- provider-specific workspace-write adapters;
- integration task and integrated HEAD verification;
- durable delivery status.

### Non-scope

- automatic task decomposition;
- unrestricted parallel agents;
- generic scheduler or queue;
- automatic conflict resolution;
- automatic merge or owner approval;
- replacing GitHub as the delivery record.

### Exit criteria

One bounded delivery with multiple activities is integrated and validated without shared-worktree writes, hidden task state, or manual prompt transport. The integrated HEAD—not merely the component branches—is the reviewed delivery candidate.

## 9. Phase 6 — Optional orchestration state

Consider a persistent dependency scheduler or richer orchestration store only when actual deliveries repeatedly exceed what explicit ChatGPT coordination can manage safely, for example several concurrent tasks with non-trivial dependencies and resume requirements.

Evidence must show that the missing store—not poor decomposition—is the bottleneck.

## 10. Workstream boundaries

### GPT Repo MCP owns

- task and result contracts;
- provider adapters;
- durable state and logs;
- context identity;
- execution and access boundaries;
- coordination metadata when implemented;
- tool and policy surface.

### PKR owns

- product and architecture authority;
- real dogfooding decisions and tasks;
- validation requirements;
- owner ratification;
- product delivery priorities.

The infrastructure work must not silently reorder PKR's backlog.

Before ATO automation exists, PKR product needs continue through the existing backlog, design-specification, and project-state authorities. ATO does not require a new Requirement Card store and does not gate ordinary product intake or execution.

## 11. Risks and controls

| Risk | Control |
| --- | --- |
| Control plane grows faster than PKR | Phase 0.5 and later gates require measured PKR value. |
| Generic task tool becomes a command runner | Separate immutable task creation from narrow start; server-owned invocation. |
| Provider roles become permanent | Roles selected per task; provider is an independent field. |
| ChatGPT framing anchors both providers | Mandatory provider challenge of brief framing and context selection. |
| Claude read-only boundary is assumed rather than proven | End-to-end host probe plus unchanged repository and context verification. |
| Live worktree changes during read-only analysis | Start-and-result hash checks, fail-closed drift, preferred immutable snapshot. |
| Codex guarantees regress during generalization | Compatibility path and exact regression coverage before migration. |
| Deliberation becomes recursive and expensive | One initial round, one targeted rebuttal maximum. |
| Multi-agent component success masks integration failure | Separate integration task and integrated HEAD gate. |
| Conversation becomes the task database | Durable MCP task and relation state. |
| Rich schema is designed before evidence | Minimal wrapper; versioned task-specific payloads. |

## 12. Immediate next batch after ratification

After ratification:

1. confirm [`BASELINE_EVIDENCE.md`](BASELINE_EVIDENCE.md) against the exact branch and host state;
2. record the current manual transport frequency and effort estimate;
3. draft the bounded `ATO-001 — Bounded Claude transport spike` work package manually;
4. review ATO-001 through a bounded manual AR because it introduces a new provider transport and read boundary; manual owner relay is expected for this pre-ATO review;
5. obtain owner ratification of ATO-001;
6. implement and run the bounded Phase 0.5 transport spike;
7. decide from measured value whether Phase 1 proceeds;
8. if approved, inspect the current Codex task, execution, review, process, policy, and contract layers;
9. define the smallest provider-neutral task and result wrapper needed for read-only runs;
10. specify compatibility with current Codex tools and artifacts;
11. verify the Claude CLI boundary on the installed version and Windows runtime;
12. produce the final implementation plan for Phase 1;
13. stop before broad provider routing, write support, deterministic claims, or multi-agent delivery machinery.
