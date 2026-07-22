# Security

## Tool Annotations

Read tools use read-only annotations:

- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: false`
- `idempotentHint: true`

Mutating tools use separate write annotations:

- `readOnlyHint: false`
- `destructiveHint: true`
- `openWorldHint: false`
- `idempotentHint: false`

No arbitrary shell, caller-supplied command runner, direct Codex execution tool, arbitrary Git tool, or force operation is registered. The optional script runner accepts only a configured `script_id`; executable, arguments, timeout, output limit, and inherited environment names come from local policy. Existing-branch switch and branch deletion are fixed-purpose guarded operations. Standalone branch deletion requires a clean non-current branch, exact repository/branch/base SHAs, matching local and remote refs when both exist, proof that the branch commit is contained in the exact remote base, no open pull request, and explicit owner approval. Local Git tools use fixed argument arrays through `execFile`; GitHub PR/check/merge/workflow calls use explicit API operations. On Windows, server bootstrap first reuses a complete user-level Git identity. When none exists, it creates an isolated runtime Git home under local application data using optional `GPT_REPO_GIT_AUTHOR_NAME`/`GPT_REPO_GIT_AUTHOR_EMAIL` values or a deterministic `local.invalid` fallback. Repository and global Git configuration remain unchanged. Advisory tools such as `repo_change_plan` and `repo_next_action` return plans and recommendations only; they do not write files or run tests.

Codex task tools do not run Codex or execute commands. `repo_prepare_codex_task` renders a prompt in tool output, `repo_write_codex_task` writes local prompt metadata under `.chatgpt/codex-runs/` through the normal write policy, and `repo_codex_review` reads the run result plus git review state. The user remains responsible for running Codex separately.

## Transport

The default OSS connection path is `npm run connect`. It starts the local MCP server and starts or reuses ngrok as a built-in convenience HTTPS tunnel. The printed ChatGPT URL ends in `/t/<stable-local-token>/mcp`; the path value is generated once under the user profile, reused across restarts, kept outside Git, and separate from GitHub authentication. See [CONNECTION_OPTIONS.md](CONNECTION_OPTIONS.md) for built-in, manual, and Secure MCP Tunnel connection paths.

That stable local path value is guess-resistance only, not authentication. Anyone with the full URL can reach the MCP endpoint while the public tunnel is running, so keep the endpoint active only when needed.

The optional supervised Windows runtime does not broaden the remote command surface. Its user-local control document accepts only versioned fixed actions. The ChatGPT allowlist exposes status and delayed MCP-only restart; it cannot supply executable names, commands, arguments, paths, or environment values. The out-of-process supervisor performs the restart after the current tool response and keeps ngrok separate from ordinary MCP reloads. Runtime status and logs stay outside Git, and the stable public path value is redacted from supervisor logs.

Network exposure does not bypass repository policy. ChatGPT still supplies only `repo_id`; approved roots, default excludes, path sandboxing, secret checks, read/write policies, expected HEAD checks, and tool schemas still apply. Mutating tools remain disabled unless the target repo explicitly enables writes or operations.

OpenAI Secure MCP Tunnel is an advanced option for longer-lived or private connector setups when supported. In that mode, the local MCP endpoint stays private at `/mcp`, while `tunnel-client` opens an outbound connection to OpenAI and forwards MCP requests back to the local server. Store the tunnel runtime API key in `.env` or another local secret store, never in committed files.

## Approved Roots

ChatGPT never supplies absolute repository paths. It supplies `repo_id`; the server resolves that id to an approved root from config. Unknown repos are rejected.

All model-supplied paths must be repo-relative POSIX paths. `PathSandbox` rejects absolute paths, traversal, symlink escapes, device files, sockets, and named pipes.

## Default Excludes

Default excludes apply consistently to tree, search, bounded reads, project briefing, task inventory, decision memory, change planning, and next-action signals. Common excluded areas include Git internals, dependency directories, generated output/cache directories, coverage, virtual environments, and generated test artifacts.

Generated/default-excluded files can be fetched only through `repo_fetch_file` with `override_default_excludes: true`, and the result includes a warning. Secret candidates remain blocked.

## Secret Candidates

Secret-looking paths are blocked by default, even when explicitly requested. Sensitive examples include `.env`, private keys, certificate bundles, identity key files, and directories exactly named `secrets` or `credentials`. Ordinary code, docs, and tests are not blocked merely because their paths contain words like `secret` or `credential`.

Public environment templates are the narrow exception for reads: `.env.example`, `.env.sample`, `.env.template`, and `example.env` can be read when their contents pass secret scanning. Real environment files such as `.env`, `.env.local`, `.env.production`, and arbitrary `.env.*` names remain blocked.

Tool outputs, errors, and logs must not include file contents from blocked secret candidates, tokens, credentials, environment variables, private keys, raw tool outputs, or raw errors. Except for the configured `root` returned by `repo_list_roots`, tools should prefer `repo_id` and repo-relative paths over absolute paths.

## Write Policy

Writes are disabled by default for every repo. A repo must opt in with `writes.enabled: true`.

The CLI permission modes are config shortcuts only:

- `read`: writes and operations disabled.
- `write`: broad repo-local file edits enabled under write policy, with hard denied paths and secret checks still enforced.
- `ship`: write mode plus bounded creation of a new local feature branch, local Git operations, and the GitHub `origin` workflow: feature-branch push, PR create/update/status, owner-approved PR merge, and fast-forward base synchronization.

No mode enables arbitrary shell or caller-supplied command execution, force-push, direct push to `main`/`master`, unrestricted pull/merge, reset, rebase, stash, or `git clean`. `repo_write_create_branch` creates a new branch with exact source/HEAD guards; `repo_write_switch_branch` switches a clean worktree to an existing local branch with exact current branch/HEAD guards; `repo_write_finalize_pull_request` deletes only refs proven to match an exact merged PR head. Allowlisted scripts remain disabled until explicitly configured per repository. Remote operations use fixed arguments and GitHub REST endpoints, require separate opt-in toggles, and are restricted to `origin`.

Default allowed write globs are `.chatgpt/**`, `.codex/**`, `docs/**`, exact root public docs (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, `LICENSE`), and exact `.gitignore`. This is not a general root-write allowance; root files such as `package.json`, source files, scripts, tests, and arbitrary notes remain blocked unless the repo opts in with custom allow globs. The `.gitignore` allowance is a narrow repo-metadata path for adding local-only ignore policy. Default denied write globs include real env files, private key files, Git internals, root and nested dependency directories, common generated/cache directories, coverage, test results, and virtual environments. Denied globs and hard secret-candidate checks win over allowed globs.

Clone-based `npm run add -- <path> --mode write` and `--mode ship` intentionally use `allowed_globs: ["**"]` for solo-dev ergonomics while preserving the hard denied globs, hard secret-path checks, resulting-content secret scans, path sandboxing, and size limits. Use `repo_policy_explain` to inspect the effective read/write/cleanup policy and explain why a supported path check is allowed or blocked.

`repo_write_file` also enforces repo-relative paths, no traversal, no absolute paths, no symlink escapes, no device files, no sockets, no named pipes, `max_bytes_per_write`, denied globs, allowed globs, and secret scanning of the resulting content. `dry_run: true` performs policy, path, size, and content checks and computes the result without writing.

`repo_write_file` does not create visible overwrite backups by default. Its result includes `old_sha256` and `new_sha256` for review, but the user-facing write flow no longer requires manually supplying `expected_sha256`.

## Operations Policy

All Git and process operations are disabled by default for every repo. New feature-branch creation, branch management, local stage/commit, push, PR create/update, PR merge, workflow dispatch, base synchronization, allowlisted script execution, and cleanup each have explicit operation-policy toggles. `operations.enabled: true` is necessary but not sufficient.

`repo_git_stage` and `repo_git_unstage` accept only explicit repo-relative POSIX paths and require `expected_head_sha`. They reject empty path lists, `.`, `*`, shell-like pathspecs, absolute paths, traversal, `.git`, real environment files, private key/certificate files, identity key filenames, and directories literally named `secrets` or `credentials`. Legitimate code, docs, and tests whose filenames contain words like `secret` or `credential` are allowed when the path is explicit and otherwise safe. Actual staging uses fixed `git add -- <paths>` arguments, and actual unstaging uses fixed `git restore --staged -- <paths>` arguments.

`repo_write_create_branch` requires `git_branch_enabled`, the exact current source branch, and the exact current HEAD. It validates the target with `git check-ref-format --branch`, refuses `main`, `master`, the current branch, and any existing local branch, then uses only fixed `git switch -c <new-branch>`. A dirty index/worktree is allowed so already reviewed staged or unstaged work can move off the base branch; the result reports that state with `WORKTREE_CHANGES_CARRIED_TO_NEW_BRANCH`. The operation verifies afterward that the new branch is active and HEAD is unchanged.

Remote tools accept only the remote name `origin` and GitHub.com HTTPS/SSH repository URLs without embedded credentials. Push requires a clean named feature branch, an exact expected branch and HEAD, and a fixed non-force refspec. Direct push to `main` and `master` is rejected. PR merge requires the exact reviewed PR head SHA and an explicit `owner_approved: true`; known checks must be successful unless the caller deliberately disables that guard. Base synchronization is fast-forward only. Feature-branch updates require a clean named non-base branch, exact feature and remote-base SHAs, merge-tree conflict preflight, and fixed fast-forward or merge arguments. Conflicts do not enter merge state; no rebase, cherry-pick, force update, or push is exposed.

Draft-ready is delegated to the fixed `github.pr-ready` wrapper through `repo_run_allowed_script`; that wrapper accepts no caller-supplied command or arguments, derives the PR from the clean current feature branch, verifies the local and GitHub head SHAs, invokes `gh pr ready`, and verifies the resulting state. `repo_remote_pull_requests` uses fixed `gh pr list` arguments and schema-validates bounded JSON output. `repo_write_retire_pull_request` requires explicit owner approval, a clean worktree, exact local and PR head SHAs, an open unmerged PR, a non-base head branch, and proof that no other open PR uses the branch. It invokes fixed `gh pr close` arguments without `--delete-branch`, verifies the resulting closed-unmerged state, and only then performs separate exact-SHA local and origin branch cleanup through guarded Git operations. `repo_write_finalize_pull_request` requires a confirmed merged PR, explicit owner approval, a clean worktree, exact local HEAD, matching local/remote feature refs, and push permission before remote deletion. `repo_write_dispatch_workflow` requires a locally allowlisted workflow, a validated remote branch, its exact current SHA, and bounded string inputs.

`repo_run_allowed_script` never accepts command text or arguments from the caller. It resolves a local `script_id`, verifies exact HEAD, starts the configured executable without a shell, uses a restricted environment, enforces timeout and output caps, redacts output, and reports exit code, timeout, completeness, and truncation. Fixed audited wrappers may use tools already installed on the host, such as GitHub CLI, while retaining server-owned arguments and their own fail-closed state checks. Timeout, truncation, or nonzero exit cannot be reported as success.

Public environment template files can be staged only through a narrow filename allowlist: `.env.example`, `.env.sample`, `.env.template`, and `example.env`. These files are still read and scanned for secret-looking values before staging or commit validation. Real environment files such as `.env`, `.env.local`, and `.env.production` remain blocked.

`repo_git_commit` requires `expected_head_sha`, a non-empty message, and non-empty `expected_staged_paths`. It verifies actual staged paths exactly match the expected list before using fixed `git commit -m <message>` arguments. It does not stage files, use `git commit -a`, or push.

`repo_cleanup_paths` is disabled by default and requires both `operations.enabled: true` and `operations.cleanup_enabled: true`. It deletes only explicitly listed repo-relative paths that match `operations.cleanup_allowed_globs` and refuses targets tracked by Git. Defaults are `.chatgpt/tool-tests/**`, `.chatgpt/backups/**`, `.chatgpt/audits/**`, `.chatgpt/backlog/**`, `.chatgpt/codex-runs/**`, `coverage/**`, `dist/**`, and `test-results/**`. It rejects absolute paths, traversal, `.`, `*`, broad pathspec-like values, `.git`, `.env`, secret-looking paths, symlink escapes, device files, sockets, and named pipes. Deletion uses Node filesystem APIs only and never runs `git clean`.

## Nested Repos and Submodules

Nested Git repositories and submodules are separate trust boundaries. Tree/search/read_many/planning workflows do not recurse into them by default. Register a nested repo or submodule as its own `repo_id` to allow reading it.

Symlinks are still resolved through the sandbox, so a symlink cannot be used to escape the approved root or bypass nested-repo boundaries.

## Error Envelope

All tool errors use the shared structured error envelope through the MCP error path:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Sanitized message",
    "retryable": false,
    "diagnostics": []
  }
}
```

Validation errors identify the invalid field without echoing sensitive values. Policy errors distinguish blocked secret candidates, default-excluded paths, traversal attempts, symlink escapes, binary files, and size limits where possible. Unexpected errors are converted to sanitized internal errors before returning to ChatGPT.

## Audit Logging

Audit logs may include tool name, `repo_id`, safe repo-relative paths or globs, counts, truncation state, warning codes, `request_id`, safe MCP method and tool name, HTTP status code, duration, and MCP session presence.

Audit logs must not include request bodies, tool arguments, full MCP session ids, headers, returned file text, file content, secret-looking values, raw structured outputs, raw errors, environment variables, tokens, credentials, SSH keys, private keys, or unredacted absolute paths.

`GPT_REPO_CONFIG`, `GPT_REPO_PUBLIC_PATH_TOKEN`, `GPT_REPO_LOG_FORMAT`, and `GPT_REPO_LOG_COLOR` are the public environment variables. Legacy `REPO_READER_*` names remain supported as fallback aliases for compatibility.

`GPT_REPO_LOG_FORMAT=pretty` changes only terminal formatting. Pretty logs use the same sanitized audit event data as the default JSON logs. `GPT_REPO_LOG_COLOR=auto|always|never` controls color, and `NO_COLOR` disables color.
