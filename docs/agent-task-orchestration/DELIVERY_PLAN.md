# Agent Task Orchestration Delivery Plan

Status: **proposed; owner ratification pending**.

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
- Do not make PKR product delivery wait for optional orchestration sophistication.

## 3. Phase 0 — Ratify the foundation

### Scope

- Review and ratify this document set.
- Record the architectural decision that the project uses a common durable task lifecycle with provider adapters.
- Confirm `provider`, `task_kind`, `access_profile`, and `orchestration` as separate axes.
- Confirm context snapshots, open ChatGPT coordination, owner-ratified decision records, one writer per worktree, and bounded rounds.
- Confirm the permanent non-goals.

### Deliverables

- ratified architecture direction;
- explicit success metric for Phase 1;
- bounded first dogfooding question;
- list of current Codex behaviors that must remain unchanged.

### Exit criteria

- no unresolved disagreement about the create/start/review seam;
- no hidden requirement for a general inline dispatch or command runner;
- first implementation slice is limited to durable read-only tasks.

### Timebox

This is a decision batch, not a prolonged design programme. It ends when implementation constraints are clear enough for Phase 1.

## 4. Phase 1 — Common durable read-only task lifecycle

### Scope

- Introduce a provider-neutral task package and result wrapper under new schema versions.
- Extract only lifecycle services shared by current Codex execution and read-only providers.
- Implement `ClaudeReadOnlyAdapter` and `CodexReadOnlyAdapter`.
- Bind tasks to exact repository, branch, HEAD, and context snapshot.
- Add server-owned structured-output validation.
- Expose narrow create, start, and review operations.
- Preserve existing Codex-specific tool behavior through compatibility or unchanged paths.

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

- same verified decision brief and context snapshot;
- separate durable run identities;
- complete, validated results;
- unchanged repository state;
- bounded usage and runtime;
- readable failure classification;
- no regression to durable Codex execution.

If manual relay is still required, Phase 1 has failed regardless of code quality.

## 5. Phase 2 — Independent architecture deliberation pilot

### Scope

- Select one material, genuinely uncertain PKR architecture decision.
- Produce a neutral decision brief and decision criteria.
- Run blind independent Claude and Codex positions.
- Synthesize agreement, assumptions, conflicts, evidence gaps, and owner decisions.
- Use at most one targeted rebuttal round.
- Produce a proposed decision record for owner ratification.

### Measurements

- manual transport steps eliminated;
- number of provider runs and total usage;
- new material considerations discovered;
- false or unsupported findings;
- owner effort compared with the current copy-paste loop;
- whether independence was preserved;
- whether the final decision improved over one strong model plus owner review.

### Exit decision

- **Adopt:** measurable reduction in owner transport with useful independent analysis.
- **Adopt with changes:** transport succeeds but context, result, or synthesis contract needs bounded correction.
- **Reject or simplify:** the workflow adds cost without improving the decision.

Do not build convergence engines, automatic recursive debate, or a deliberation database as part of this pilot.

## 6. Phase 3 — Sequential specification refinement

### Scope

- Add `spec_draft` and `spec_critique` task kinds.
- Allow the critique task to reference the draft task explicitly.
- Generate a final implementation contract through ChatGPT synthesis.
- Dogfood on one real PKR product batch.

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

## 11. Risks and controls

| Risk | Control |
| --- | --- |
| Control plane grows faster than PKR | Phase gates require a real PKR value test. |
| Generic task tool becomes a command runner | Separate immutable task creation from narrow start; server-owned invocation. |
| Provider roles become permanent | Roles selected per task; provider is an independent field. |
| Claude read-only boundary is assumed rather than proven | End-to-end host probe plus unchanged repository verification. |
| Codex guarantees regress during generalization | Compatibility path and exact regression coverage before migration. |
| Deliberation becomes recursive and expensive | One initial round, one targeted rebuttal maximum. |
| Multi-agent component success masks integration failure | Separate integration task and integrated HEAD gate. |
| Conversation becomes the task database | Durable MCP task and relation state. |
| Rich schema is designed before evidence | Minimal wrapper; versioned task-specific payloads. |

## 12. Immediate next batch after ratification

A focused GPT Repo MCP architecture-and-contract batch should:

1. inspect the current Codex task, execution, review, process, policy, and contract layers;
2. define the smallest provider-neutral task and result wrapper needed for read-only runs;
3. specify compatibility with current Codex tools and artifacts;
4. verify the Claude CLI boundary on the installed version and Windows runtime;
5. produce an implementation plan for Phase 1;
6. stop before broad provider routing, write support, deterministic claims, or multi-agent delivery machinery.
