# Error Codes

This inventory documents the existing v1 error codes returned through the shared error envelope. It is not a new output contract.

All tool errors return:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Sanitized message",
    "retryable": false,
    "diagnostics": {
      "applied_paths": ["docs/example.md"],
      "failed_path": "src/example.ts",
      "recovery_hint": "Run repo_git_review, then use repo_git_restore_paths for tracked applied paths or repo_cleanup_paths for generated untracked artifacts."
    }
  }
}
```

`error.diagnostics` is optional. Some write and git-operation errors include safe machine-readable diagnostics such as repo-relative paths, HEAD SHAs, or recovery hints. Diagnostics never include file contents, snippets, raw diffs, secret values, absolute paths, environment values, raw command output, or stack traces.

## Inventory

| Code | Meaning |
| --- | --- |
| `UNKNOWN_REPO` | The requested `repo_id` is not registered as an approved repository root. |
| `ABSOLUTE_PATH_REJECTED` | A repo-relative path field received an absolute path. |
| `PATH_TRAVERSAL_REJECTED` | A path attempted to traverse outside the approved repository root. |
| `SYMLINK_ESCAPE_REJECTED` | A symlink resolved outside the approved repository root. |
| `UNSUPPORTED_FILE_TYPE` | The resolved path is not a supported regular file. |
| `BINARY_FILE_REJECTED` | A file read was blocked because the target appears to be binary. |
| `SECRET_CANDIDATE_BLOCKED` | A file read was blocked because the path looks secret-sensitive, or a public environment template contains a secret-looking value. |
| `DEFAULT_EXCLUDE_BLOCKED` | A file read was blocked by default exclude policy. |
| `SIZE_LIMIT_EXCEEDED` | A file read exceeded the requested or configured byte limit. |
| `WRITE_DISABLED` | A write was requested for a repo that has not enabled `writes.enabled`. |
| `WRITE_DENIED_GLOB` | A write target matched a configured denied glob or secret-sensitive path. |
| `WRITE_NOT_ALLOWED_GLOB` | A write target did not match the repo's configured allowed write globs. |
| `WRITE_EXPECTED_SHA_REQUIRED` | Legacy code for old pre-OSS write schema; current `repo_write_file` does not require user-supplied expected SHA. |
| `WRITE_STALE_EXPECTED_SHA` | Legacy code for old pre-OSS write schema; current `repo_write_file` does not require user-supplied expected SHA. |
| `WRITE_PARENT_MISSING` | The target parent directory does not exist and `create_dirs` was not enabled. |
| `WRITE_TARGET_EXISTS` | Legacy code for old pre-OSS create mode; current `repo_write_file` writes missing or existing files with `action: "write"`. |
| `WRITE_TARGET_MISSING` | An edit action was requested for a path that does not exist. |
| `WRITE_CONTENT_REQUIRED` | `content` or `replace` was required for the requested write action. |
| `WRITE_FIND_REQUIRED` | `find` was required for the requested exact-match edit action. |
| `WRITE_FIND_NOT_FOUND` | The requested `find` text was not present in the target file. |
| `WRITE_FIND_NOT_UNIQUE` | The requested `find` text appeared more than once in the target file. |
| `OPERATIONS_DISABLED` | A git or cleanup operation was requested without `operations.enabled`. |
| `GIT_STAGE_DISABLED` | Git stage or unstage was requested without stage operations enabled. |
| `GIT_COMMIT_DISABLED` | Git commit was requested without commit operations enabled. |
| `GIT_BRANCH_CREATE_DISABLED` | New feature-branch creation was requested without `operations.git_branch_enabled`. |
| `GIT_BRANCH_MANAGE_DISABLED` | Existing-branch switch or verified post-merge cleanup was requested without `operations.git_branch_manage_enabled`. |
| `GIT_PUSH_DISABLED` | Push was requested without `operations.git_push_enabled`. |
| `GITHUB_PULL_REQUEST_DISABLED` | Pull-request creation or update was requested without its operation toggle. |
| `GITHUB_PULL_REQUEST_STATE_DISABLED` | Pull-request ready/close was requested without its operation toggle. |
| `GITHUB_WORKFLOW_DISPATCH_DISABLED` | GitHub Actions dispatch was requested without its operation toggle. |
| `GITHUB_WORKFLOW_NOT_ALLOWED` | The requested workflow id is not locally allowlisted for this repository. |
| `GITHUB_MERGE_DISABLED` | Pull-request merge was requested without its operation toggle. |
| `GIT_SYNC_DISABLED` | Local base synchronization was requested without its operation toggle. |
| `SCRIPT_RUN_DISABLED` | Allowlisted script execution was requested without its operation toggle. |
| `SCRIPT_NOT_ALLOWED` | The requested script id is not configured for the repository. |
| `GIT_WORKTREE_DIRTY` | A remote mutation or base synchronization that requires a clean repository found staged or unstaged changes. New-branch creation is the deliberate exception. |
| `GIT_BRANCH_MISMATCH` | Current branch did not match the supplied exact expected branch. |
| `GIT_BRANCH_INVALID` | A supplied branch name was invalid or was an explicitly prohibited base-branch target. |
| `GIT_BRANCH_EXISTS` | `repo_write_create_branch` was asked to create a local branch that already exists. The tool never switches to existing branches. |
| `GIT_BRANCH_CREATE_FAILED` | Git did not leave the repository on the expected new branch with unchanged HEAD. |
| `GIT_BRANCH_NOT_FOUND` | The requested existing local branch was not found. |
| `GIT_BRANCH_SWITCH_FAILED` | Git did not leave the repository on the verified target branch and HEAD. |
| `GIT_BRANCH_DELETE_FAILED` | A verified local or remote feature branch still existed after deletion was attempted. |
| `GIT_DETACHED_HEAD` | A delivery operation requires a named current branch but the repository is detached. |
| `GIT_REMOTE_NOT_GITHUB` | The configured remote was not a supported credential-free GitHub HTTPS or SSH repository URL. |
| `GIT_REMOTE_NOT_ALLOWED` | A remote other than the configured `origin` was requested. |
| `GIT_DIRECT_BASE_PUSH_BLOCKED` | Push to `main` or `master` was rejected; use a feature branch and pull request. |
| `GIT_REMOTE_HEAD_MISMATCH` | The remote feature-branch SHA did not match the exact local HEAD required by push or pull-request workflow. |
| `GIT_REMOTE_BRANCH_NOT_FOUND` | The requested remote base branch was not found during synchronization. |
| `GITHUB_AUTH_REQUIRED` | A GitHub API operation required a runtime token that was not supplied to the MCP server process. |
| `GITHUB_API_ERROR` | A GitHub API request failed and was returned as a sanitized error. |
| `GITHUB_PR_HEAD_MISMATCH` | The pull-request head changed after owner review. Review the new head before merging. |
| `GITHUB_PR_NOT_OPEN` | The requested pull request is not open for this merge workflow. |
| `GITHUB_PR_STATE_INVALID` | The requested ready/close transition is invalid for the current pull-request state. |
| `GITHUB_PR_NOT_MERGED` | Post-merge finalization was requested for a pull request GitHub has not confirmed as merged. |
| `GITHUB_PR_NOT_MERGEABLE` | GitHub reports that the pull request cannot currently be merged. |
| `GITHUB_CHECKS_NOT_PASSED` | Required known checks were not successful, so merge was not attempted. |
| `GITHUB_MERGE_REJECTED` | GitHub rejected the requested pull-request merge. |
| `GIT_HEAD_MISMATCH` | Current HEAD did not match the supplied `expected_head_sha`. |
| `GIT_OPERATION_PATHS_REQUIRED` | A git operation requiring explicit paths received an empty path list. |
| `GIT_OPERATION_TOO_MANY_PATHS` | A git operation exceeded `operations.max_paths_per_operation`. |
| `GIT_OPERATION_UNSAFE_PATHSPEC` | A git pathspec was broad, shell-like, Git-internal, or otherwise unsafe. Absolute paths, traversal, `.env`, and hard-risk secret paths are also rejected by path and secret policy. |
| `GIT_STAGED_PATHS_MISMATCH` | Actual staged paths did not exactly match `expected_staged_paths`. |
| `GIT_NOTHING_STAGED` | Commit was requested when there were no staged changes. |
| `GIT_COMMIT_MESSAGE_INVALID` | Commit message was empty or looked like command syntax rather than a local commit message. |
| `CLEANUP_DISABLED` | Cleanup was requested without both `operations.enabled` and `operations.cleanup_enabled`. |
| `CLEANUP_PATHS_REQUIRED` | Cleanup received an empty path list. |
| `CLEANUP_UNSAFE_PATH` | Cleanup target was absolute, traversal, broad, `.git`, `.env`, secret-looking, a symlink escape, or an unsupported file type. |
| `CLEANUP_NOT_ALLOWED_GLOB` | Cleanup target did not match `operations.cleanup_allowed_globs`. |
| `VALIDATION_ERROR` | Tool input failed validation, such as invalid regex syntax or missing required read targets. |
| `GIT_ERROR` | A git operation failed. |
| `INTERNAL_ERROR` | An unexpected failure was sanitized before returning to the caller. |

## Non-Envelope Skip Reasons

Some successful tools also return stable warning or skip reason strings inside their existing success output shapes. For example, `repo_read_many.skipped[].reason` may contain file policy codes such as `SECRET_CANDIDATE_BLOCKED`, `BINARY_FILE_REJECTED`, or the read-many limit reason `MAX_TOTAL_BYTES_EXCEEDED`.
