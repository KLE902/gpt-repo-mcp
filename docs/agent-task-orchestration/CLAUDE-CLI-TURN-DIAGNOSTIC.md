# Claude CLI Turn-Bound Diagnostic

Status: **Draft — not ratified and not executed**.

## 1. Purpose

Define a small, artifact-bearing synthetic diagnostic that can determine what the installed Claude Code CLI actually does with a fixed `--max-turns` limit before any renewed transport attempt is designed.

This document is a diagnostic specification only. It does not authorize execution, implement a runner, reopen ATO-001, or establish a permanent Claude capability.

## 2. Diagnostic questions

The diagnostic must establish mechanically:

1. what ratified ATO-001 actually requires for turn bounding;
2. whether installed Claude Code `2.1.217` reliably enforces `--max-turns`;
3. the actual unmodified JSON envelope returned by that CLI version;
4. which observed fields, if any, reliably express terminal status, turn count, usage, cost, and truncation;
5. the smallest parser contract that can be bound to the observed envelope without assuming undocumented field names.

ATO-001 requires bounded runtime, output, turns, and cost where the installed CLI supports reliable enforcement. It does not make help-text advertisement an acceptance criterion.

## 3. Method principle

The diagnostic is raw-envelope-first:

1. preserve the complete bounded stdout and stderr bytes;
2. preserve the unmodified provider envelope before interpretation;
3. record process and execution facts independently of provider narrative;
4. compare two otherwise identical runs;
5. derive a parser contract only after the real envelopes and terminal behavior have been inspected;
6. reject any field that is absent, ambiguous, inconsistent between runs, or not mechanically tied to observed process behavior.

A narrative `PASS` line, exact marker alone, zero exit code, or parseable JSON is insufficient evidence.

## 4. Immutable synthetic fixture

Use a small MCP-owned fixture outside PKR and outside any product repository worktree. The fixture is immutable for both runs and hash-bound in the artifact manifest.

The fixture contains a three-link dependency chain whose later filenames cannot be known from the task prompt:

```text
fixture/
  START.txt
  step-<token-from-START>.txt
  final-<token-from-step>.txt
```

Example semantics:

- `START.txt` contains the exact name of the second file and a short value fragment;
- the second file contains the exact name of the final file and another value fragment;
- the final file contains the last value fragment and a deterministic transformation rule;
- the correct response is one exact marker computed from all three fragments, for example `TURN_CANARY_OK:<sha256-prefix>`.

The prompt names only `fixture/START.txt`. The provider receives only the read capability needed to follow the chain. Directory listing, shell, edits, writes, notebook tools, network access, repository mutation, session persistence, and caller-selected tools are excluded.

The fixture must be designed so that completing the task requires multiple sequential information steps rather than one read or a guess. The exact bytes, filenames, expected marker, and hashes are fixed before ratification.

## 5. Fixed prompt

Use a synthetic prompt written specifically for this diagnostic. It must not contain, quote, summarize, or invoke PKR-004.

The prompt should instruct the provider to:

- begin at the single named `START.txt` path;
- follow each content-derived file reference in sequence;
- perform the fixed deterministic transformation;
- return only the exact final marker when complete;
- return no guessed marker when the chain cannot be completed;
- make no file changes.

The prompt bytes and SHA-256 are identical for both runs.

## 6. Differential pair

Use the same resolved executable, executable hash, CLI version, working directory, fixture, prompt, environment allowlist, tool policy, timeout, output limit, and non-turn arguments for both runs.

### Run A — one-turn limit

- argument: `--max-turns 1`.

### Run B — higher fixed limit

- argument: `--max-turns 3`.

No other input differs.

## 7. Diagnostic hypothesis

The pre-ratification hypothesis is:

- Run A terminates with a mechanically observable max-turns outcome and without the correct final marker;
- Run B can complete the sequential fixture and return the correct final marker;
- the raw envelopes and independent process records expose a reproducible difference without narrative interpretation.

This is a hypothesis, not an assumed result. The diagnostic fails to answer the question if both runs complete identically, both fail identically, the limit cannot be distinguished mechanically, or the relevant envelope/process evidence is absent or ambiguous.

## 8. Server-owned invocation boundary

A future implementation must use a fixed MCP-owned operation with no caller-supplied executable, command, arguments, prompt, fixture path, environment, working directory, timeout, output cap, or parser settings.

Before either run, MCP must verify:

- exact diagnostic specification identity;
- exact prompt identity;
- exact fixture identities;
- resolved executable and version;
- executable or package-entry SHA-256;
- no pre-existing artifact collision;
- clean and immutable fixture state;
- fixed read-only tool policy;
- fixed runtime and output bounds.

The same verified executable identity must be used for both runs.

## 9. Required artifacts

Each run must leave a durable MCP-owned artifact package containing at least:

- resolved executable path, redacted only in user-facing summaries when necessary but retained in the local audit package;
- SHA-256 for the actually launched executable or package-entry file;
- CLI version;
- full server-owned argument list;
- prompt file and prompt SHA-256;
- fixture file identities and SHA-256 values;
- working directory;
- repository, branch, and HEAD where relevant, or an explicit statement that no repository is involved;
- start time and end time;
- process exit code;
- timeout status;
- process-tree termination status;
- raw bounded stdout bytes;
- raw bounded stderr bytes;
- SHA-256 for stdout and stderr;
- unchanged raw provider envelope;
- parser result;
- terminal type and subtype, derived only after envelope inspection;
- observed turn count, when mechanically supported by evidence;
- usage, when present;
- reported cost, when present;
- Git status before and after where a Git worktree is involved;
- a manifest that hash-binds every artifact in the package.

Artifacts must remain retrievable through MCP. A summary or narrative `PASS` record is not a substitute for the package.

## 10. Parser derivation

Do not assume field names such as `num_turns`, `turns`, `subtype`, `usage`, `total_cost_usd`, or truncation indicators in advance.

After both raw envelopes are preserved:

1. enumerate the actual top-level and nested fields;
2. compare presence, type, and value across Run A and Run B;
3. correlate candidate fields with independent exit, timeout, output-completeness, and marker evidence;
4. document unsupported or ambiguous fields;
5. propose the smallest strict parser that accepts only the observed supported contract;
6. retain the raw envelope as higher-fidelity evidence than the derived parser result.

A later CLI version requires a new diagnostic or explicit compatibility evidence; the parser is not generalized from one version by assumption.

## 11. Decision outcomes

### Enforcement supported

Only when the differential pair demonstrates that the lower bound prevents completion in a mechanically identifiable way, the higher bound permits completion, and the distinction is reproducible from the preserved process/envelope evidence.

### Enforcement unsupported

Only when the CLI accepts the flag but demonstrably ignores it or behaves inconsistently under the otherwise identical differential pair.

### Unresolved

Use when the runs cannot mechanically distinguish enforcement, the envelope lacks dependable evidence, the fixture does not produce the intended differential, artifacts are incomplete, or any boundary check fails.

No outcome from this diagnostic alone establishes full transport acceptance.

## 12. Explicit exclusions

The diagnostic excludes:

- PKR-004;
- PKR interim intake;
- transport acceptance;
- Phase 1;
- a provider-neutral task or result schema;
- a permanent Claude runner;
- Claude version pinning;
- read-lease acceptance;
- automatic retry;
- more than the two fixed canary runs;
- product repository analysis;
- semantic architecture review;
- file writes by the provider;
- any change to ATO-001's exhausted attempt or repair budget.

## 13. Ratification prerequisites

Before execution, a separately reviewed and owner-ratified version must fix:

- exact fixture bytes and hashes;
- exact synthetic prompt bytes and hash;
- exact allowed tools and denied tools;
- exact executable-resolution and package-entry hashing method;
- exact environment allowlist;
- exact timeout and output limits;
- artifact paths and MCP retrieval operation;
- manifest schema;
- stop rules for incomplete or ambiguous evidence.

Until then, this document remains a draft and no diagnostic run is authorized.
