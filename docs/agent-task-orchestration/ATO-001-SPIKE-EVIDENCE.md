# ATO-001 Phase 0.5 Claude Transport Spike Evidence

Status: **implementation complete; measured ChatGPT-through-MCP execution pending**.

This record separates implementation/component activity from the measured transport attempt required by [`ATO-001.md`](ATO-001.md). A local implementation process, component test, direct CLI call, or filesystem read is not accepted as proof of the target seam.

## Binding scope

The spike answers only this capability question:

> Can one bounded read-only Claude task be started by ChatGPT through GPT Repo MCP and returned to ChatGPT through GPT Repo MCP with no owner prompt or result relay, while preserving exact repository, Git, context, runtime, and result boundaries strongly enough to justify Phase 1?

Target seam:

`ChatGPT → GPT Repo MCP → Claude → GPT Repo MCP → ChatGPT`

The implementation is fixed to:

- task: ATO-001 §4 / PKR-004 independent read-only analysis;
- PKR repository: `Premium-Komga-Reader`;
- branch: `master`;
- HEAD: `6036e56fb54ca332824fa9f26c48a82ae56110dd`;
- ten explicit context files and SHA-256 identities from ATO-001;
- context aggregate SHA-256: `b749c7e2edc96895cce837f6f80faec14abe05bb72cb33a7adeb29c76545b65e`;
- exact task-file SHA-256: `65a9986da526db3c1c5900f5a7129b8dd6ce9e2cbda13aebd21aba223ed48b16`.

The task file is UTF-8 with no prefix, suffix, normalization, or trailing newline.

## Implementation boundary

The temporary spike adds exactly two fixed MCP operations:

- `repo_start_ato_001_claude` — zero caller parameters; verifies the pinned PKR repository, task, context, current Claude CLI resolution/version/authentication/capabilities, acquires the PKR read lease, writes bounded MCP-owned artifacts, and starts the fixed runner;
- `repo_ato_001_claude_review` — zero caller parameters; records each ChatGPT MCP retrieval call, returns running or terminal state, revalidates PKR and all context identities, invalidates incomplete/drifted output, and releases the lease only after terminal collection.

The caller cannot provide prompt text, executable, command, arguments, model, provider flags, tools, environment, working directory, timeout, cost, budget, repository, branch, HEAD, context paths, or hashes.

The dedicated tools are the primary interface. Because the live ChatGPT connector catalog for this already-open conversation cannot hot-refresh after a server build, the measured run may use two fixed allowlisted MCP compatibility operations through the already-exposed `repo_run_allowed_script` tool: `mcp.ato001.start` and `mcp.ato001.review`. Those operations invoke the same start/review services with no caller-controlled runtime input and record their actual MCP operation identities. They do not call Claude directly or read result artifacts outside the MCP lifecycle.

The fixed Claude invocation is one-turn, non-interactive, structured, read-only, and restricted to `Read`, `Glob`, and `Grep`. `Bash`, `Edit`, `Write`, and `NotebookEdit` are explicitly disallowed. Runtime and complete output are bounded. Timeout or truncation is terminal and cannot be treated as a valid result. The exact current CLI version is verified at start and must remain identical inside the detached runner.

A persistent live-worktree read lease blocks all known MCP mutating operations against the pinned PKR repository until terminal review. It does not claim protection against unrelated external host processes; that remains a residual Phase 0.5 risk.

## Implementation and component activity

This section is not transport proof.

- Initial implementation delegation stopped before edits because its delegation prompt introduced a non-authoritative task SHA. The ratified ATO-001 text was rechecked; the delegation error was removed.
- The corrected implementation delegation produced the bounded code path but its own Codex log exceeded the configured runner output cap and stopped fail-closed. No Claude task was started by that implementation process.
- The preserved implementation was independently reviewed and tightened for dynamic current-version binding, exact ChatGPT MCP call identities, complete measurement fields, terminal artifact completeness, result-time revalidation, persistent lease handling, and startup-timeout process-tree termination.
- Component tests use mocked Claude execution only. They do not invoke the provider and are not counted as the measured transport attempt.

### Component validation before measured execution

- TypeScript typecheck: PASS.
- Full deterministic test suite: PASS — 54 test files, 487 tests.
- ESLint: PASS.
- Public hygiene check: PASS.
- Production build: PASS.
- Exact task identity test: PASS.
- Fixed invocation and semantic schema tests: PASS.
- timeout, output-truncation, invalid-result, repository/context verification, and read-lease tests: PASS.
- Existing Codex execution contracts: PASS.

## Measured ChatGPT-through-MCP execution

Not yet run at the time this section was created. The measured attempt begins only after the implementation is committed, built, and the supervised MCP runtime exposes the two fixed tools.

### First measured attempt

Pending.

### Permitted narrow repair

Not used.

### Final measured attempt

Pending.

## Required measurement record

The terminal MCP review result is authoritative for the machine-recorded values below. This document will be updated from that returned result without reading run artifacts directly from the filesystem.

| Measurement | Result |
| --- | --- |
| Exact Claude executable resolution | Pending |
| Exact Claude CLI version | Pending |
| Exact executed task-file identity | Pending |
| Owner prompt relay count | Pending |
| Owner result relay count | Pending |
| ChatGPT MCP start call count and identity | Pending |
| ChatGPT MCP review call count and identities | Pending |
| Measured start initiated by ChatGPT through MCP | Pending |
| Measured result retrieved by ChatGPT through MCP | Pending |
| Owner terminal actions during run | Pending |
| Owner PowerShell actions during run | Pending |
| Owner filesystem actions during run | Pending |
| Owner attachment actions during run | Pending |
| Owner Claude-UI actions during run | Pending |
| Prospective active owner administration time | Not retrospectively estimated |
| Total elapsed time | Pending |
| Claude task runtime | Pending |
| Measured attempt count | Pending |
| Narrow repair used | Pending |
| Timeout outcome | Pending |
| Process-tree termination outcome | Pending |
| Output completeness | Pending |
| Parsing and schema validation | Pending |
| Repository and context boundary | Pending |
| Read-lease outcome | Pending |
| Usage and reported cost | Pending |
| Remaining recurring setup/manual steps | Pending |
| Owner-perceived administrative burden | Not yet recorded |
| PKR interim-intake validity | Pending |

## Final classification

Pending one of:

- proceed to Phase 1;
- proceed only after bounded changes;
- stop ATO development.

No result may enter PKR interim need intake unless the terminal MCP review reports every transport, task-identity, parser, repository, context, output, and lease boundary as valid.
