# ATO-001 Phase 0.5 Claude Transport Spike Evidence

Status: **measured spike complete — boundary failure; no validated Claude result**.

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

The measured calls were made by ChatGPT through fixed GPT Repo MCP operations only. No direct Claude CLI call, shell execution, filesystem result read, attachment relay, Claude-UI action, owner prompt relay, or owner result relay was used.

### First measured attempt

`repo_run_allowed_script:mcp.ato001.start` was invoked by ChatGPT after implementation commit `282bb0a5fd367746d6a427578167bb730d3d7193`. It failed closed before Claude started with `ATO001_ARTIFACTS_NOT_IGNORED`: the first implementation placed MCP-owned artifacts under the pinned PKR live worktree and required that path to be ignored there.

This is an informative boundary failure, not transport success. No task prompt reached Claude, no PKR file changed, no lease was acquired, and no owner relay or local owner action occurred.

### Permitted narrow repair

Used once. The fixed task, execution state, result, measurements, and mutation lease were moved from the pinned PKR worktree to GPT Repo MCP's existing ignored `.chatgpt/` runtime area. PKR remains only the verified read-only target. The same start/review services, fixed invocation, result parser, and live-worktree mutation guard remain in force.

The rerun record explicitly carries both measured start attempts and marks the repair as used.

### Final measured attempt

After repair commit `ecd0d1482a181cc79b4fb25a05112cffd32388e2`, ChatGPT invoked `repo_run_allowed_script:mcp.ato001.start` for the single permitted rerun. PKR repository, branch, HEAD, cleanliness, origin synchronization, fixed task identity, and all ten context hashes passed preflight. Claude CLI resolution and version probing also completed, but capability verification failed closed with `ATO001_CLAUDE_CAPABILITY_UNVERIFIED`: the installed CLI did not expose the required `--max-turns` capability.

Claude was not started, no task prompt reached the provider, no process tree was created, no provider output or usage existed, and the lease was not acquired because capability verification precedes lease acquisition.

ChatGPT then invoked `repo_run_allowed_script:mcp.ato001.review`. It failed closed with `ATO001_EXECUTION_INVALID` because the preflight failure occurred before execution artifacts were created. Therefore no result was returned through MCP and no PKR intake result exists.

A fixed non-provider diagnostic established Claude Code `2.1.217` and `loggedIn: true` through the first-party `claude.ai` authentication path. MCP's path-redaction hid the resolved executable paths, so an exact executable path is not claimed as delivered evidence.

## Required measurement record

No terminal result artifact exists because both measured starts stopped before provider execution. The values below come from the ChatGPT-visible MCP start, review, repository, and fixed non-provider diagnostic responses; no run artifact was read directly from the filesystem.

| Measurement | Result |
| --- | --- |
| Exact Claude executable resolution | Resolution succeeded, but the two returned paths were redacted by MCP; exact path not claimable |
| Exact Claude CLI version | `2.1.217 (Claude Code)` |
| Non-interactive authentication | PASS — logged in through first-party `claude.ai` authentication |
| Fixed task-file identity | Candidate task bytes verified exactly; SHA-256 `65a9986da526db3c1c5900f5a7129b8dd6ce9e2cbda13aebd21aba223ed48b16`; not executed |
| Context identity | Ten exact ATO-001 files; aggregate SHA-256 `b749c7e2edc96895cce837f6f80faec14abe05bb72cb33a7adeb29c76545b65e` |
| Owner prompt relay count | `0` |
| Owner result relay count | `0` |
| ChatGPT MCP start calls | `2`: `repo_run_allowed_script:mcp.ato001.start` first attempt and repaired rerun |
| ChatGPT MCP review calls | `1`: `repo_run_allowed_script:mcp.ato001.review` |
| Measured start initiated by ChatGPT through MCP | Yes, both attempts |
| Measured result retrieved by ChatGPT through MCP | No — review failed closed before a result existed |
| Owner terminal actions during run | `0` |
| Owner PowerShell actions during run | `0` |
| Owner filesystem actions during run | `0` |
| Owner attachment actions during run | `0` |
| Owner Claude-UI actions during run | `0` |
| Prospective active owner administration time | Not measured; no retrospective estimate invented |
| Measured MCP call elapsed time | First start `333 ms`; final start `1,912 ms`; final review `105 ms` |
| Claude task runtime | `0 ms`; provider was never started |
| Measured attempt count | `2` |
| Narrow repair used | Yes, exactly once |
| Timeout outcome | Not triggered |
| Process-tree termination outcome | Not required; no provider process tree started |
| Output completeness | No provider output exists |
| Parsing and schema validation | Not reached |
| Repository and context boundary | Start preflight passed on final attempt; post-attempt PKR state and hashes reverified unchanged |
| Read-lease outcome | Not acquired in either measured attempt; runtime blocking therefore not exercised end-to-end |
| Usage and reported cost | None reported; provider not invoked |
| Remaining recurring setup/manual steps | Resolve or ratify a current-CLI bounded turn limit; expose exact resolved path safely; refresh connector catalog or retain fixed compatibility operations |
| Owner-perceived administrative burden | Not recorded in this spike |
| PKR interim-intake validity | No — no Claude result exists |

## Final classification

**Proceed only after bounded changes. Do not begin Phase 1.**

The spike proved that ChatGPT can invoke fixed MCP-owned start and review operations without owner relay and that repository, task, context, authentication, and capability checks fail closed. It did **not** prove the target transport seam because the installed Claude Code `2.1.217` lacks the required `--max-turns` capability, the provider never started, no result returned through MCP, and the live-worktree lease was not exercised during a real run.

A later work package must first decide the smallest truthful current-CLI equivalent for a bounded single-turn execution, or pin a compatible CLI version, while preserving the existing no-caller-input and read-only boundaries. That work must be separately measured; it is not a continuation or relabeling of this exhausted ATO-001 timebox.

The PKR-004 position is diagnostic-only by absence: no Claude advisory result exists and nothing may enter PKR interim need intake.
