export type RepoReaderErrorCode =
  | "UNKNOWN_REPO"
  | "ABSOLUTE_PATH_REJECTED"
  | "PATH_TRAVERSAL_REJECTED"
  | "SYMLINK_ESCAPE_REJECTED"
  | "UNSUPPORTED_FILE_TYPE"
  | "BINARY_FILE_REJECTED"
  | "SECRET_CANDIDATE_BLOCKED"
  | "DEFAULT_EXCLUDE_BLOCKED"
  | "SIZE_LIMIT_EXCEEDED"
  | "WRITE_DISABLED"
  | "WRITE_DENIED_GLOB"
  | "WRITE_NOT_ALLOWED_GLOB"
  | "WRITE_EXPECTED_SHA_REQUIRED"
  | "WRITE_STALE_EXPECTED_SHA"
  | "WRITE_PARENT_MISSING"
  | "WRITE_TARGET_EXISTS"
  | "WRITE_TARGET_MISSING"
  | "WRITE_CONTENT_REQUIRED"
  | "WRITE_FIND_REQUIRED"
  | "WRITE_FIND_NOT_FOUND"
  | "WRITE_FIND_NOT_UNIQUE"
  | "OPERATIONS_DISABLED"
  | "GIT_STAGE_DISABLED"
  | "GIT_COMMIT_DISABLED"
  | "GIT_BRANCH_CREATE_DISABLED"
  | "GIT_BRANCH_MANAGE_DISABLED"
  | "GIT_PUSH_DISABLED"
  | "GITHUB_PULL_REQUEST_DISABLED"
  | "GITHUB_PULL_REQUEST_STATE_DISABLED"
  | "GITHUB_WORKFLOW_DISPATCH_DISABLED"
  | "GITHUB_MERGE_DISABLED"
  | "GIT_SYNC_DISABLED"
  | "SCRIPT_RUN_DISABLED"
  | "SCRIPT_NOT_ALLOWED"
  | "GIT_WORKTREE_DIRTY"
  | "GIT_BRANCH_MISMATCH"
  | "GIT_BRANCH_INVALID"
  | "GIT_BRANCH_EXISTS"
  | "GIT_BRANCH_CREATE_FAILED"
  | "GIT_BRANCH_NOT_FOUND"
  | "GIT_BRANCH_SWITCH_FAILED"
  | "GIT_BRANCH_DELETE_FAILED"
  | "GIT_DETACHED_HEAD"
  | "GIT_REMOTE_NOT_GITHUB"
  | "GIT_REMOTE_NOT_ALLOWED"
  | "GIT_DIRECT_BASE_PUSH_BLOCKED"
  | "GIT_REMOTE_HEAD_MISMATCH"
  | "GIT_REMOTE_BRANCH_NOT_FOUND"
  | "GITHUB_AUTH_REQUIRED"
  | "GITHUB_API_ERROR"
  | "GITHUB_PR_HEAD_MISMATCH"
  | "GITHUB_PR_NOT_OPEN"
  | "GITHUB_PR_STATE_INVALID"
  | "GITHUB_PR_NOT_MERGED"
  | "GITHUB_PR_NOT_MERGEABLE"
  | "GITHUB_CHECKS_NOT_PASSED"
  | "GITHUB_MERGE_REJECTED"
  | "GIT_HEAD_MISMATCH"
  | "GIT_OPERATION_PATHS_REQUIRED"
  | "GIT_OPERATION_TOO_MANY_PATHS"
  | "GIT_OPERATION_UNSAFE_PATHSPEC"
  | "GIT_STAGED_PATHS_MISMATCH"
  | "GIT_NOTHING_STAGED"
  | "GIT_COMMIT_MESSAGE_INVALID"
  | "CLEANUP_DISABLED"
  | "CLEANUP_PATHS_REQUIRED"
  | "CLEANUP_UNSAFE_PATH"
  | "CLEANUP_TRACKED_PATH"
  | "CLEANUP_NOT_ALLOWED_GLOB"
  | "VALIDATION_ERROR"
  | "GIT_ERROR"
  | "INTERNAL_ERROR";

export class RepoReaderError extends Error {
  readonly code: RepoReaderErrorCode;
  readonly retryable: boolean;
  readonly diagnostics: Record<string, unknown>;

  constructor(
    code: RepoReaderErrorCode,
    message: string,
    options: { retryable?: boolean; diagnostics?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = "RepoReaderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.diagnostics = options.diagnostics ?? {};
  }
}

export function toRepoReaderError(error: unknown): RepoReaderError {
  if (error instanceof RepoReaderError) return error;
  if (error instanceof Error) return new RepoReaderError("INTERNAL_ERROR", error.message);
  return new RepoReaderError("INTERNAL_ERROR", "Unexpected internal error");
}
