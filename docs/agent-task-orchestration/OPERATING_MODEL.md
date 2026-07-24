# Agent Task Orchestration Operating Model

Status: **proposed; owner ratification pending**.

## 1. Purpose

Define how the owner, ChatGPT, GPT Repo MCP, Claude Code, and Codex collaborate after the common durable task lifecycle exists.

The operating model removes manual transport while keeping decision authority, evidence boundaries, provider roles, and framing risk explicit.

## 2. Roles

### Owner

- sets product direction and material constraints;
- decides when a decision warrants independent architecture positions;
- ratifies architecture decisions and merge actions;
- may reject a converged recommendation;
- remains the final authority when evidence is incomplete or trade-offs are value judgments.

### ChatGPT coordinator and integrator

- drafts a task or decision brief that is treated as a reviewable input, not presumed neutral;
- selects task kind, provider, context, access profile, and workflow;
- creates and starts visible tasks through MCP;
- prevents one provider's answer from anchoring another when independence is required;
- compares results against project authority and available evidence;
- produces the final synthesis or proposed task contract;
- records framing objections, unresolved conflicts, and owner decisions;
- does not treat model agreement as proof.

ChatGPT is not a third architecture advocate by default. A separate sealed ChatGPT position is an explicit high-stakes option, not the normal synthesis role.

### GPT Repo MCP

- owns task transport, immutable manifests, exact context identity, durable execution state, logs, provider policy, and boundary evidence;
- exposes explicit create, start, and review operations;
- does not choose product direction, hide recursive agent conversations, or ratify decisions;
- does not act as a general command runner.

### Provider agent

Claude or Codex receives a bounded role for one task. The provider may draft, critique, review, implement, investigate, or integrate according to `task_kind` and `access_profile`.

No provider has a permanent repository role.

## 3. Workflow selection

Use the lightest workflow that matches consequence and uncertainty.

### Solo task

Use one provider when the work is bounded, reversible, and not materially ambiguous.

### Sequential refinement

Use when an initial artifact should be intentionally improved by a second provider. Anchoring is desired.

Typical uses:

- requirements drafting;
- implementation task contracts;
- test strategy refinement;
- documentation tightening;
- review of a concrete proposal.

### Independent deliberation

Use when stakes and genuine uncertainty justify independent expert positions. Anchoring is undesirable.

Typical uses:

- architecture boundaries;
- data or persistence strategy;
- security model changes;
- irreversible or expensive product direction;
- adoption of a new workflow or infrastructure capability.

### Independent review

Use after implementation when risk, ambiguity, or consequence warrants a fresh read-only reviewer.

### Future coordinated delivery

Use only after the write and integration capabilities are explicitly implemented. It consists of several visible tasks under one delivery, not an automatic agent team.

## 4. Specification drafting workflow

```text
owner objective and constraints
  -> ChatGPT creates task contract brief
  -> provider A: spec_draft
  -> provider B: spec_critique, with the draft visible
  -> ChatGPT integrates accepted corrections
  -> owner resolves material product choices
  -> final task contract
```

The critic should identify:

- missing acceptance criteria;
- hidden assumptions;
- architecture conflicts;
- scope leakage;
- unverifiable requirements;
- missing validation paths;
- owner decisions disguised as engineering details.

The output is a usable task contract, not a transcript of debate.

## 5. Independent architecture deliberation

### Decision brief

ChatGPT produces one brief containing:

- the exact decision question;
- why a decision is needed now;
- verified current state;
- constraints and non-goals;
- alternatives already identified without favoring one;
- decision criteria;
- shared context snapshot;
- requested result structure.

The brief is a draft input to the deliberation. It is not accepted as neutral merely because ChatGPT produced it.

### Mandatory brief framing challenge

Every independent architecture position begins with a review of the brief itself before answering the decision question.

Each provider must state:

- whether the question is neutrally framed;
- whether material alternatives are missing or unfairly represented;
- whether facts, assumptions, and owner preferences are separated;
- whether relevant authority or evidence is absent;
- whether any decision criterion is leading, incomplete, or inappropriate;
- whether the question should be reframed before a decision is made.

A material framing defect is not silently worked around. The provider may give a conditional position, but it must identify the corrected framing it relied on.

### Independent first positions

Claude and Codex receive the same brief and context. Neither receives the other's result or a prior preferred recommendation.

A position should state:

- brief-framing objections;
- recommendation;
- assumptions;
- reasoning and trade-offs;
- risks and failure modes;
- rejected alternatives;
- evidence gaps;
- decisions requiring owner judgment;
- confidence and what would change the recommendation.

### Synthesis

ChatGPT classifies:

- framing objections and their disposition;
- real agreement;
- apparent agreement based on different assumptions;
- material conflict;
- non-material terminology differences;
- unsupported claims;
- missing project evidence;
- product or governance choices that belong to the owner.

If either provider identifies a material framing defect, ChatGPT must resolve or surface that objection before recommending a decision. The synthesis recommends a decision but does not claim that agreement proves correctness.

### Rebuttal rule

At most one targeted rebuttal round is used, and only when a material conflict remains. Each new task receives the other position and a precise conflict question. It is not an invitation to re-argue the whole topic.

### Decision record

The workflow ends in:

```text
positions
  -> synthesis
  -> proposed decision record
  -> owner ratification or amendment
  -> authoritative documentation update
```

A proposed record is not an accepted ADR until the owner ratifies it.

## 6. Implementation and review workflow

```text
ratified task contract
  -> one selected writer
  -> deterministic validation
  -> read-only independent reviewer when warranted
  -> ChatGPT disposition of findings
  -> at most one bounded repair round
  -> revalidation
  -> owner-controlled delivery
```

Review input should prioritize:

- original task contract;
- actual repository diff or exact commit range;
- deterministic test and validation evidence;
- relevant architecture authority;
- known constraints and exclusions.

The reviewer's findings are advisory. Git state, test evidence, execution boundary evidence, and physical-device evidence remain distinct sources of truth.

## 7. Finding disposition

Until a richer structured schema is justified, ChatGPT records each material finding as:

```text
accepted
rejected
deferred
duplicate
not_reproducible
owner_decision_required
```

Every rejected or deferred material finding receives a concise reason. New findings in a second review round require materially new evidence or a change introduced by repair.

## 8. Round and cost boundaries

Default limits:

- one initial task per provider role;
- one synthesis;
- at most one targeted rebuttal or repair round;
- no recursive agent-to-agent loop;
- explicit timeout and turn cap for every provider run;
- provider cost cap when reliably supported, plus MCP-side usage reporting;
- stop when additional rounds repeat positions without new evidence.

The owner may authorize a wider high-stakes review, but the exception is explicit and bounded.

## 9. Context rules

Every dispatched task receives an exact context snapshot rather than an informal recollection.

The snapshot should include only relevant authority and evidence. It must distinguish:

- canonical product and architecture documents;
- current project state and backlog;
- historical records;
- task-specific source files;
- generated or local evidence;
- superseded proposals.

Historical pilot documents do not silently become current workflow authority.

A result invalidated by `context_drifted` is retained for diagnosis but is not used in synthesis or decision ratification.

## 10. Evidence hierarchy

When sources conflict, use this order unless the task defines a stricter rule:

1. exact repository and Git state;
2. deterministic build, test, static-analysis, runtime, or device evidence;
3. ratified architecture and product authority;
4. validated task and result artifacts;
5. independent semantic review;
6. provider completion narrative.

A provider may identify a problem in a higher-ranked source, but its statement does not replace verification.

## 11. Deliberation trigger

Use independent deliberation only when both conditions are true:

- the decision has material cost, risk, irreversibility, or architectural reach;
- reasonable experts could disagree because evidence or trade-offs are genuinely uncertain.

Do not deliberate routine naming, local refactoring, reversible UI tuning, or matters already governed by ratified authority.

## 12. Future multi-agent delivery rules

When implemented:

- each write task owns one branch and one worktree;
- no two writers edit the same worktree;
- task scopes should minimize overlapping files;
- dependencies are explicit;
- component branches are not delivery-ready independently;
- one integration activity combines results;
- the integrated HEAD receives full validation and review;
- delivery status is stored durably rather than only in conversation context.

A multi-agent delivery is justified only when decomposition reduces elapsed time or materially improves specialization without making integration risk dominate.

## 13. Stop conditions

Stop the workflow and return to the owner when:

- providers disagree on a product preference rather than an engineering fact;
- the brief has a material unresolved framing defect;
- required evidence cannot be obtained safely;
- repository or context identity drifts during a run;
- the task would require a new unratified security boundary;
- two write scopes overlap materially without an integration plan;
- the cost of coordination exceeds the value of the change;
- the proposed control-plane work begins delaying the product without measured benefit.
