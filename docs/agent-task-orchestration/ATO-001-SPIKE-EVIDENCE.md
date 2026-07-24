# ATO-001 Phase 0.5 Claude Transport Spike Evidence

Status: **measured spike complete — implementation-gate failure; target capability unresolved; no validated Claude result**.

This is the historical evidence record for the exhausted, ratified [`ATO-001.md`](ATO-001.md) spike. It records what the measured spike actually did, which implementation defects stopped it, and which capability questions remain open. It does not reopen the spike, extend its attempt budget, or authorize Phase 1.

## Binding capability question

ATO-001 asked:

> Can one bounded read-only Claude task be started by ChatGPT through GPT Repo MCP and returned to ChatGPT through GPT Repo MCP with no owner prompt or result relay, while preserving exact repository, Git, context, runtime, and result boundaries strongly enough to justify Phase 1?

Target seam:

`ChatGPT → GPT Repo MCP → Claude → GPT Repo MCP → ChatGPT`

The ratified execution was bound to:

- task: the exact ATO-001 §4 PKR-004 prompt;
- PKR repository: `Premium-Komga-Reader`;
- branch: `master`;
- HEAD: `6036e56fb54ca332824fa9f26c48a82ae56110dd`;
- ten explicit context files and SHA-256 identities from ATO-001;
- context aggregate SHA-256: `b749c7e2edc96895cce837f6f80faec14abe05bb72cb33a7adeb29c76545b65e`;
- exact task-file SHA-256: `65a9986da526db3c1c5900f5a7129b8dd6ce9e2cbda13aebd21aba223ed48b16`.

The candidate task bytes were verified as UTF-8 with no prefix, suffix, normalization, or trailing newline. They were never sent to Claude during the ratified ATO-001 execution.

## Historical implementation boundary

The spike branch initially implemented fixed start and review operations, a fixed Claude invocation, an MCP-owned artifact set, semantic result parsing, and a live-worktree read lease. Those mechanisms were implementation candidates, not validated production capability.

The squash-merged PR #23 tree removed all executable runtime content and disconnected the MCP surface, compatibility operation, policy toggle, fixed task content, parser, lease, and active spike tests. Its merged tree initially retained ten zero-byte runtime paths and two skipped test retirement markers because the bounded repository writer could not delete tracked paths. The follow-up cleanup branch `chore/remove-ato-001-stubs` mechanically deletes those twelve tracked paths through one exact server-owned `git rm -- <paths>` operation; that temporary local allowlist entry was removed immediately after execution and the MCP policy reloaded without it. The resulting tree contains neither an active runner nor inert ATO-001 runtime or test stub paths.

At the independently reviewed head `2255c1b153f282c786a97430f6370bf85b300ceb`, PR #23 was six commits ahead of `main`, not a two-commit correction in isolation. That reviewed history consisted of `742b9e4c1c9216e90641254479ed6fcf2b7f6afd`, `282bb0a5fd367746d6a427578167bb730d3d7193`, `ecd0d1482a181cc79b4fb25a05112cffd32388e2`, `f6dec4fd939040d0beb16b5c459341bcaddff6fa`, `ae14920a7fd4c377413afa66c207eb5daac3e25b`, and `2255c1b153f282c786a97430f6370bf85b300ceb`. The last two of those commits corrected and retired the earlier spike implementation; they did not erase the four preceding implementation, repair, and evidence commits. Later evidence-only clarifications add to, rather than replace, that history. Review and merge must therefore evaluate the complete current branch diff and commit history. A squash merge may condense commits on `main`, but the PR record remains the historical evidence trail.

## Implementation and component activity

This section is not transport proof.

- Initial implementation delegation stopped before edits because its delegation prompt introduced a non-authoritative task SHA. The ratified ATO-001 text was rechecked and the delegation error was removed.
- The corrected implementation delegation produced a bounded code path, but its Codex log exceeded the configured runner output cap and stopped fail-closed. No Claude task was started by that implementation process.
- The implementation was subsequently tightened around version binding, MCP call identity, measurement fields, terminal artifact completeness, result-time revalidation, persistent lease handling, and startup-timeout process-tree termination.
- Component tests used mocked Claude execution only. They did not invoke the provider and are not counted as measured transport attempts.

Before the measured attempts, the then-current implementation passed TypeScript typecheck, its deterministic test suite, ESLint, public hygiene, production build, fixed task identity tests, invocation/parser tests, timeout and truncation tests, repository/context verification tests, read-lease tests, and existing Codex regression tests. Those checks established only that the implementation behaved as coded; they did not validate the target seam or the installed CLI's turn enforcement.

## Measured ChatGPT-through-MCP execution

The measured calls were initiated by ChatGPT through fixed GPT Repo MCP operations. The owner performed no prompt relay, result relay, terminal action, PowerShell action, filesystem action, attachment action, or Claude UI action during the measured attempts.

### First measured attempt — artifact placement failure

After implementation commit `282bb0a5fd367746d6a427578167bb730d3d7193`, ChatGPT invoked `repo_run_allowed_script:mcp.ato001.start`.

The attempt failed closed before Claude started with `ATO001_ARTIFACTS_NOT_IGNORED`. The first implementation placed MCP-owned runtime artifacts under the pinned PKR live worktree and required that path to be ignored there.

This was a self-inflicted implementation and design failure. Artifact placement was incompatible with the fixed clean-worktree boundary. It was not a provider limitation and did not answer the transport capability question.

Consequences:

- Claude was not started;
- the PKR-004 prompt did not reach the provider;
- no provider process tree existed;
- no provider output existed;
- no read lease was acquired;
- PKR remained unchanged;
- the first measured attempt was consumed.

### Permitted narrow repair — used once

ATO-001 allowed at most one bounded repair after a narrow invocation or parsing defect. That repair was used to move the fixed task, execution state, result, measurements, and mutation-lease artifacts from the pinned PKR worktree to GPT Repo MCP's ignored runtime area.

The repair addressed only artifact placement. It did not add another attempt, reopen scope, or validate the provider, parser, result-return path, read lease, or turn enforcement.

### Final measured attempt — incorrect help-text gate

After repair commit `ecd0d1482a181cc79b4fb25a05112cffd32388e2`, ChatGPT invoked `repo_run_allowed_script:mcp.ato001.start` for the single permitted rerun.

PKR repository identity, branch, HEAD, cleanliness, origin synchronization, fixed task identity, and all ten context hashes passed preflight. Claude executable resolution and version probing completed. The implementation then failed closed with `ATO001_CLAUDE_CAPABILITY_UNVERIFIED` because it treated absence of `--max-turns` from `claude --help` as authoritative proof that the invocation capability was unavailable.

That capability gate was incorrectly constructed. ATO-001 requires bounded turns and cost **where the installed CLI supports reliable enforcement**. It does not require `--max-turns` to be advertised in help text, and help output is not a reliable execution-capability oracle.

The final measured attempt stopped before provider start. Therefore:

- Claude was not started during the ratified ATO-001 execution;
- the PKR-004 prompt did not reach Claude;
- no provider process tree was created;
- no real provider output reached the ATO-001 parser;
- no semantic PKR-004 validation occurred;
- no live read lease was acquired or exercised during a provider run;
- no complete result returned to ChatGPT through the target seam;
- no PKR-004 result is valid for interim intake.

ChatGPT then invoked `repo_run_allowed_script:mcp.ato001.review`. It failed closed with `ATO001_EXECUTION_INVALID` because the preflight failure occurred before the execution artifact set was created. That failure did not create or retrieve a result.

## Corrected capability classification

Two questions must remain separate.

### 1. False negative against the implementation's help-text gate

The final ATO-001 start was rejected because `claude --help` did not advertise `--max-turns`. A later post-spike invocation accepted an argument list containing `--max-turns 1` and reached a successful non-interactive result. That observation disproves the implementation's assumption that help-text presence was required to accept the flag.

The ATO-001 stop was therefore a false negative **against its own implementation gate**.

### 2. Reliable turn enforcement remains unresolved

Acceptance of `--max-turns 1`, absence of an argument error, and a successful provider result do not prove that the limit was enforced reliably. The later probe did not create a differential max-turns test, preserve the full raw envelope, or provide a mechanically auditable turn-limit terminal classification.

The correct conclusion is:

> Help-text-based capability detection was incorrectly treated as authoritative. A later post-spike probe showed that Claude Code 2.1.217 accepted an invocation containing `--max-turns 1` and reached a successful non-interactive result. That observation disproves the help-text gate but does not establish that the turn limit was reliably enforced. Reliable turn enforcement therefore remains unresolved.

ATO-001 did not answer the complete capability question positively or negatively.

## Authentication and non-interactive execution observations

The measured ATO-001 preflight separately observed Claude Code `2.1.217` and an authentication-status response containing `loggedIn: true` for the first-party `claude.ai` path. That was an authentication-status observation only; it did not establish actual non-interactive provider behavior because the provider never started in ATO-001.

The later post-spike provider invocation is the evidence that an actual non-interactive invocation reached a successful result. It is documented separately below and must not be conflated with the earlier `loggedIn: true` status probe.

## Post-spike diagnostic observation — outside ATO-001

After ATO-001 had already exhausted its attempt and repair budget and had been classified, ChatGPT initiated a separate probe through GPT Repo MCP.

Observed invocation facts:

- initiator: ChatGPT;
- surface: GPT Repo MCP;
- MCP operation: `repo_run_allowed_script`;
- allowlisted script id: `pkr.agent.claude.probe`;
- Claude Code version: `2.1.217`;
- reported executable name: `claude.exe`;
- arguments included:
  - `-p`;
  - `--output-format json`;
  - `--max-turns 1`;
  - `--permission-mode plan`;
  - `--disallowedTools Bash,Edit,Write,NotebookEdit`;
  - `--no-session-persistence`;
- the provider invocation completed without an argument error;
- a simple exact-marker parser passed;
- reported runtime was approximately `11,396 ms`;
- PKR was reported clean before and after the invocation.

This observation is deliberately limited:

- it occurred outside ATO-001's ratified attempt budget;
- it does not reopen ATO-001;
- it is not a third spike attempt;
- it does not prove the complete ChatGPT → MCP → Claude → MCP → ChatGPT transport;
- it does not prove that `--max-turns 1` was enforced;
- it does not prove the semantic PKR-004 parser;
- it does not prove or exercise the ATO-001 read lease;
- it produced no intake-valid PKR result;
- it did not preserve the raw provider envelope, full executable resolution, exit-code record, stdout/stderr hashes, or artifact manifest as a durable audit package;
- it may be used only to reject help text as the sole capability gate.

The probe script id was a generic entry in PKR's local ignored operations policy, not part of the ATO-001 runtime or the public repository tree. Final review found that `pkr.agent.claude.probe` remained allowlisted after the probe. Its entry was removed from local `config.local.json`, the MCP runtime was restarted, and the reloaded effective PKR policy no longer lists that script id. This is an operational retirement of the local installation, not a Git-delivered control and not evidence about other installations.

## Measurement record

No terminal provider artifact exists for the ratified spike because both measured starts stopped before provider execution.

| Measurement | Result |
| --- | --- |
| Claude Code version observed during ATO-001 preflight | `2.1.217` |
| Earlier authentication-status observation | `loggedIn: true`; not itself proof of provider execution |
| Exact task-file identity | Candidate bytes verified; SHA-256 `65a9986da526db3c1c5900f5a7129b8dd6ce9e2cbda13aebd21aba223ed48b16`; never executed |
| Context identity | Ten exact ATO-001 files; aggregate SHA-256 `b749c7e2edc96895cce837f6f80faec14abe05bb72cb33a7adeb29c76545b65e` |
| Owner prompt relay count | `0` |
| Owner result relay count | `0` |
| ChatGPT MCP start calls in ATO-001 | `2`: initial attempt and repaired rerun |
| ChatGPT MCP review calls in ATO-001 | `1` |
| Measured start initiated by ChatGPT through MCP | Yes |
| Measured result retrieved by ChatGPT through complete target seam | No |
| Owner terminal / PowerShell / filesystem / attachment / Claude UI actions | `0` for each |
| Measured MCP call elapsed time | First start `333 ms`; final start `1,912 ms`; final review `105 ms` |
| Claude runtime within ratified ATO-001 | `0 ms`; provider never started |
| Attempt count | `2`; budget exhausted |
| Narrow repair | Used exactly once; budget exhausted |
| Timeout / process-tree termination | Not reached; no provider process tree started |
| Provider output | None in ratified ATO-001 |
| Semantic parsing and schema validation | Not reached |
| Read lease | Not acquired in a real provider run |
| Usage and reported cost | None; provider not invoked in ATO-001 |
| PKR interim-intake validity | No |
| Phase 1 basis | No |

## Final classification

**Changes required before any renewed transport attempt. Do not begin Phase 1 on the basis of ATO-001.**

ATO-001 did not answer the complete capability question. It established fixed MCP entry points and fail-closed preflight behavior in its historical implementation, but the provider, real provider envelope, semantic parser, result-return path, live read lease, and reliable turn enforcement were not validated end to end.

The artifact-placement defect consumed the only repair. The final help-text gate was a false negative against that gate, not evidence that Claude Code lacked the invocation capability. The later probe invalidated help text as a sole capability detector but did not validate enforcement.

A renewed attempt requires a separately ratified work package after the synthetic turn diagnostic is designed, ratified, implemented, and executed. There is no evidence-based reason to pin an older Claude Code version; doing so would add operational and version debt without resolving the open enforcement question.

No PKR-004 advisory result exists, and nothing from this spike may enter PKR interim need intake.
