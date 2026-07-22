import { descriptions } from "./descriptions.js";
import { readOnlyAnnotations, remoteReadAnnotations, remoteWriteAnnotations, writeAnnotations } from "./annotations.js";
import { toolContracts, type ToolContract, type ToolName } from "./contracts.js";
import {
  changePlanHandler,
  cleanupPathsHandler,
  codexReviewHandler,
  decisionMemoryHandler,
  fetchFileHandler,
  gitCommitHandler,
  gitDiffHandler,
  gitReviewHandler,
  writeCreateBranchHandler,
  gitBranchesHandler,
  branchAuditHandler,
  writeRetireBranchHandler,
  writeSwitchBranchHandler,
  remoteStatusHandler,
  remotePullRequestsHandler,
  gitRestorePathsHandler,
  gitStageHandler,
  gitStatusHandler,
  gitUnstageHandler,
  lastWriteHandler,
  listRootsHandler,
  nextActionHandler,
  planReviewHandler,
  prepareCodexTaskHandler,
  projectBriefHandler,
  readManyHandler,
  searchHandler,
  taskInventoryHandler,
  treeHandler,
  writeCommitHandler,
  writeRecoverHandler,
  writeStageCommitHandler,
  writeChangesHandler,
  writeCodexTaskHandler,
  writeFileHandler,
  writeHandoffHandler,
  policyExplainHandler,
  writePushHandler,
  writePullRequestHandler,
  writeRetirePullRequestHandler,
  writeFinalizePullRequestHandler,
  writeDispatchWorkflowHandler,
  runAllowedScriptHandler,
  writeSyncBaseHandler,
  writeUpdateBranchFromBaseHandler,
  writeMergePullRequestHandler,
  writeStageHandler,
  writeUnstageHandler,
  type ToolHandler
} from "./handlers.js";

export type ToolDefinition = {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: ToolContract["input"];
  outputSchema: ToolContract["output"];
  annotations: typeof readOnlyAnnotations | typeof remoteReadAnnotations | typeof writeAnnotations | typeof remoteWriteAnnotations;
  handler: ToolHandler;
};

export const toolCatalog: ToolDefinition[] = [
  {
    name: "repo_list_roots",
    title: "List approved repositories",
    description: descriptions.repo_list_roots,
    inputSchema: toolContracts.repo_list_roots.input,
    outputSchema: toolContracts.repo_list_roots.output,
    annotations: readOnlyAnnotations,
    handler: listRootsHandler
  },
  {
    name: "repo_policy_explain",
    title: "Explain repository policy",
    description: descriptions.repo_policy_explain,
    inputSchema: toolContracts.repo_policy_explain.input,
    outputSchema: toolContracts.repo_policy_explain.output,
    annotations: readOnlyAnnotations,
    handler: policyExplainHandler
  },
  {
    name: "repo_last_write",
    title: "Read last write receipt",
    description: descriptions.repo_last_write,
    inputSchema: toolContracts.repo_last_write.input,
    outputSchema: toolContracts.repo_last_write.output,
    annotations: readOnlyAnnotations,
    handler: lastWriteHandler
  },
  {
    name: "repo_tree",
    title: "Inspect repository tree",
    description: descriptions.repo_tree,
    inputSchema: toolContracts.repo_tree.input,
    outputSchema: toolContracts.repo_tree.output,
    annotations: readOnlyAnnotations,
    handler: treeHandler
  },
  {
    name: "repo_search",
    title: "Search repository text",
    description: descriptions.repo_search,
    inputSchema: toolContracts.repo_search.input,
    outputSchema: toolContracts.repo_search.output,
    annotations: readOnlyAnnotations,
    handler: searchHandler
  },
  {
    name: "repo_fetch_file",
    title: "Fetch one file",
    description: descriptions.repo_fetch_file,
    inputSchema: toolContracts.repo_fetch_file.input,
    outputSchema: toolContracts.repo_fetch_file.output,
    annotations: readOnlyAnnotations,
    handler: fetchFileHandler
  },
  {
    name: "repo_read_many",
    title: "Read bounded files",
    description: descriptions.repo_read_many,
    inputSchema: toolContracts.repo_read_many.input,
    outputSchema: toolContracts.repo_read_many.output,
    annotations: readOnlyAnnotations,
    handler: readManyHandler
  },
  {
    name: "repo_git_status",
    title: "Read git status",
    description: descriptions.repo_git_status,
    inputSchema: toolContracts.repo_git_status.input,
    outputSchema: toolContracts.repo_git_status.output,
    annotations: readOnlyAnnotations,
    handler: gitStatusHandler
  },
  {
    name: "repo_git_diff",
    title: "Read git diff",
    description: descriptions.repo_git_diff,
    inputSchema: toolContracts.repo_git_diff.input,
    outputSchema: toolContracts.repo_git_diff.output,
    annotations: readOnlyAnnotations,
    handler: gitDiffHandler
  },
  {
    name: "repo_git_review",
    title: "Plan git review",
    description: descriptions.repo_git_review,
    inputSchema: toolContracts.repo_git_review.input,
    outputSchema: toolContracts.repo_git_review.output,
    annotations: readOnlyAnnotations,
    handler: gitReviewHandler
  },
  {
    name: "repo_write_create_branch",
    title: "Create feature branch",
    description: descriptions.repo_write_create_branch,
    inputSchema: toolContracts.repo_write_create_branch.input,
    outputSchema: toolContracts.repo_write_create_branch.output,
    annotations: writeAnnotations,
    handler: writeCreateBranchHandler
  },
  {
    name: "repo_git_branches",
    title: "Inspect branches",
    description: descriptions.repo_git_branches,
    inputSchema: toolContracts.repo_git_branches.input,
    outputSchema: toolContracts.repo_git_branches.output,
    annotations: remoteReadAnnotations,
    handler: gitBranchesHandler
  },
  {
    name: "repo_write_switch_branch",
    title: "Switch existing branch",
    description: descriptions.repo_write_switch_branch,
    inputSchema: toolContracts.repo_write_switch_branch.input,
    outputSchema: toolContracts.repo_write_switch_branch.output,
    annotations: writeAnnotations,
    handler: writeSwitchBranchHandler
  },
  {
    name: "repo_remote_status",
    title: "Inspect GitHub remote status",
    description: descriptions.repo_remote_status,
    inputSchema: toolContracts.repo_remote_status.input,
    outputSchema: toolContracts.repo_remote_status.output,
    annotations: remoteReadAnnotations,
    handler: remoteStatusHandler
  },
  {
    name: "repo_remote_pull_requests",
    title: "List GitHub pull requests",
    description: descriptions.repo_remote_pull_requests,
    inputSchema: toolContracts.repo_remote_pull_requests.input,
    outputSchema: toolContracts.repo_remote_pull_requests.output,
    annotations: remoteReadAnnotations,
    handler: remotePullRequestsHandler
  },
  {
    name: "repo_write_push",
    title: "Push reviewed branch",
    description: descriptions.repo_write_push,
    inputSchema: toolContracts.repo_write_push.input,
    outputSchema: toolContracts.repo_write_push.output,
    annotations: remoteWriteAnnotations,
    handler: writePushHandler
  },
  {
    name: "repo_write_pull_request",
    title: "Create or update pull request",
    description: descriptions.repo_write_pull_request,
    inputSchema: toolContracts.repo_write_pull_request.input,
    outputSchema: toolContracts.repo_write_pull_request.output,
    annotations: remoteWriteAnnotations,
    handler: writePullRequestHandler
  },
  {
    name: "repo_write_retire_pull_request",
    title: "Retire pull request",
    description: descriptions.repo_write_retire_pull_request,
    inputSchema: toolContracts.repo_write_retire_pull_request.input,
    outputSchema: toolContracts.repo_write_retire_pull_request.output,
    annotations: remoteWriteAnnotations,
    handler: writeRetirePullRequestHandler
  },
  {
    name: "repo_write_finalize_pull_request",
    title: "Finalize merged pull request",
    description: descriptions.repo_write_finalize_pull_request,
    inputSchema: toolContracts.repo_write_finalize_pull_request.input,
    outputSchema: toolContracts.repo_write_finalize_pull_request.output,
    annotations: remoteWriteAnnotations,
    handler: writeFinalizePullRequestHandler
  },
  {
    name: "repo_write_dispatch_workflow",
    title: "Dispatch GitHub workflow",
    description: descriptions.repo_write_dispatch_workflow,
    inputSchema: toolContracts.repo_write_dispatch_workflow.input,
    outputSchema: toolContracts.repo_write_dispatch_workflow.output,
    annotations: remoteWriteAnnotations,
    handler: writeDispatchWorkflowHandler
  },
  {
    name: "repo_run_allowed_script",
    title: "Run allowlisted script",
    description: descriptions.repo_run_allowed_script,
    inputSchema: toolContracts.repo_run_allowed_script.input,
    outputSchema: toolContracts.repo_run_allowed_script.output,
    annotations: writeAnnotations,
    handler: runAllowedScriptHandler
  },
  {
    name: "repo_write_sync_base",
    title: "Fast-forward local base",
    description: descriptions.repo_write_sync_base,
    inputSchema: toolContracts.repo_write_sync_base.input,
    outputSchema: toolContracts.repo_write_sync_base.output,
    annotations: remoteWriteAnnotations,
    handler: writeSyncBaseHandler
  },
  {
    name: "repo_write_update_branch_from_base",
    title: "Update feature branch from base",
    description: descriptions.repo_write_update_branch_from_base,
    inputSchema: toolContracts.repo_write_update_branch_from_base.input,
    outputSchema: toolContracts.repo_write_update_branch_from_base.output,
    annotations: remoteWriteAnnotations,
    handler: writeUpdateBranchFromBaseHandler
  },
  {
    name: "repo_write_merge_pull_request",
    title: "Merge owner-approved pull request",
    description: descriptions.repo_write_merge_pull_request,
    inputSchema: toolContracts.repo_write_merge_pull_request.input,
    outputSchema: toolContracts.repo_write_merge_pull_request.output,
    annotations: remoteWriteAnnotations,
    handler: writeMergePullRequestHandler
  },
  {
    name: "repo_git_stage",
    title: "Stage explicit git paths",
    description: descriptions.repo_git_stage,
    inputSchema: toolContracts.repo_git_stage.input,
    outputSchema: toolContracts.repo_git_stage.output,
    annotations: writeAnnotations,
    handler: gitStageHandler
  },
  {
    name: "repo_git_unstage",
    title: "Unstage explicit git paths",
    description: descriptions.repo_git_unstage,
    inputSchema: toolContracts.repo_git_unstage.input,
    outputSchema: toolContracts.repo_git_unstage.output,
    annotations: writeAnnotations,
    handler: gitUnstageHandler
  },
  {
    name: "repo_git_restore_paths",
    title: "Restore explicit worktree paths",
    description: descriptions.repo_git_restore_paths,
    inputSchema: toolContracts.repo_git_restore_paths.input,
    outputSchema: toolContracts.repo_git_restore_paths.output,
    annotations: writeAnnotations,
    handler: gitRestorePathsHandler
  },
  {
    name: "repo_git_commit",
    title: "Create local git commit",
    description: descriptions.repo_git_commit,
    inputSchema: toolContracts.repo_git_commit.input,
    outputSchema: toolContracts.repo_git_commit.output,
    annotations: writeAnnotations,
    handler: gitCommitHandler
  },
  {
    name: "repo_write_stage",
    title: "Stage reviewed paths",
    description: descriptions.repo_write_stage,
    inputSchema: toolContracts.repo_write_stage.input,
    outputSchema: toolContracts.repo_write_stage.output,
    annotations: writeAnnotations,
    handler: writeStageHandler
  },
  {
    name: "repo_write_unstage",
    title: "Unstage reviewed paths",
    description: descriptions.repo_write_unstage,
    inputSchema: toolContracts.repo_write_unstage.input,
    outputSchema: toolContracts.repo_write_unstage.output,
    annotations: writeAnnotations,
    handler: writeUnstageHandler
  },
  {
    name: "repo_write_commit",
    title: "Create reviewed local commit",
    description: descriptions.repo_write_commit,
    inputSchema: toolContracts.repo_write_commit.input,
    outputSchema: toolContracts.repo_write_commit.output,
    annotations: writeAnnotations,
    handler: writeCommitHandler
  },
  {
    name: "repo_write_stage_commit",
    title: "Stage and commit reviewed paths",
    description: descriptions.repo_write_stage_commit,
    inputSchema: toolContracts.repo_write_stage_commit.input,
    outputSchema: toolContracts.repo_write_stage_commit.output,
    annotations: writeAnnotations,
    handler: writeStageCommitHandler
  },
  {
    name: "repo_write_recover",
    title: "Recover reviewed paths",
    description: descriptions.repo_write_recover,
    inputSchema: toolContracts.repo_write_recover.input,
    outputSchema: toolContracts.repo_write_recover.output,
    annotations: writeAnnotations,
    handler: writeRecoverHandler
  },
  {
    name: "repo_cleanup_paths",
    title: "Clean up generated paths",
    description: descriptions.repo_cleanup_paths,
    inputSchema: toolContracts.repo_cleanup_paths.input,
    outputSchema: toolContracts.repo_cleanup_paths.output,
    annotations: writeAnnotations,
    handler: cleanupPathsHandler
  },
  {
    name: "repo_project_brief",
    title: "Create project brief",
    description: descriptions.repo_project_brief,
    inputSchema: toolContracts.repo_project_brief.input,
    outputSchema: toolContracts.repo_project_brief.output,
    annotations: readOnlyAnnotations,
    handler: projectBriefHandler
  },
  {
    name: "repo_task_inventory",
    title: "Inventory repository tasks",
    description: descriptions.repo_task_inventory,
    inputSchema: toolContracts.repo_task_inventory.input,
    outputSchema: toolContracts.repo_task_inventory.output,
    annotations: readOnlyAnnotations,
    handler: taskInventoryHandler
  },
  {
    name: "repo_decision_memory",
    title: "Extract decision memory",
    description: descriptions.repo_decision_memory,
    inputSchema: toolContracts.repo_decision_memory.input,
    outputSchema: toolContracts.repo_decision_memory.output,
    annotations: readOnlyAnnotations,
    handler: decisionMemoryHandler
  },
  {
    name: "repo_change_plan",
    title: "Plan repository change",
    description: descriptions.repo_change_plan,
    inputSchema: toolContracts.repo_change_plan.input,
    outputSchema: toolContracts.repo_change_plan.output,
    annotations: readOnlyAnnotations,
    handler: changePlanHandler
  },
  {
    name: "repo_next_action",
    title: "Recommend next action",
    description: descriptions.repo_next_action,
    inputSchema: toolContracts.repo_next_action.input,
    outputSchema: toolContracts.repo_next_action.output,
    annotations: readOnlyAnnotations,
    handler: nextActionHandler
  },
  {
    name: "repo_plan_review",
    title: "Plan repository review",
    description: descriptions.repo_plan_review,
    inputSchema: toolContracts.repo_plan_review.input,
    outputSchema: toolContracts.repo_plan_review.output,
    annotations: readOnlyAnnotations,
    handler: planReviewHandler
  },
  {
    name: "repo_prepare_codex_task",
    title: "Prepare Codex task prompt",
    description: descriptions.repo_prepare_codex_task,
    inputSchema: toolContracts.repo_prepare_codex_task.input,
    outputSchema: toolContracts.repo_prepare_codex_task.output,
    annotations: readOnlyAnnotations,
    handler: prepareCodexTaskHandler
  },
  {
    name: "repo_write_codex_task",
    title: "Write Codex task prompt",
    description: descriptions.repo_write_codex_task,
    inputSchema: toolContracts.repo_write_codex_task.input,
    outputSchema: toolContracts.repo_write_codex_task.output,
    annotations: writeAnnotations,
    handler: writeCodexTaskHandler
  },
  {
    name: "repo_codex_review",
    title: "Review Codex result",
    description: descriptions.repo_codex_review,
    inputSchema: toolContracts.repo_codex_review.input,
    outputSchema: toolContracts.repo_codex_review.output,
    annotations: readOnlyAnnotations,
    handler: codexReviewHandler
  },
  {
    name: "repo_write_file",
    title: "Write one repository file",
    description: descriptions.repo_write_file,
    inputSchema: toolContracts.repo_write_file.input,
    outputSchema: toolContracts.repo_write_file.output,
    annotations: writeAnnotations,
    handler: writeFileHandler
  },
  {
    name: "repo_write_changes",
    title: "Apply repository edit pack",
    description: descriptions.repo_write_changes,
    inputSchema: toolContracts.repo_write_changes.input,
    outputSchema: toolContracts.repo_write_changes.output,
    annotations: writeAnnotations,
    handler: writeChangesHandler
  },
  {
    name: "repo_write_handoff",
    title: "Create ChatGPT handoff",
    description: descriptions.repo_write_handoff,
    inputSchema: toolContracts.repo_write_handoff.input,
    outputSchema: toolContracts.repo_write_handoff.output,
    annotations: writeAnnotations,
    handler: writeHandoffHandler
  },
  {
    name: "repo_branch_audit",
    title: "Audit branch retirement",
    description: descriptions.repo_branch_audit,
    inputSchema: toolContracts.repo_branch_audit.input,
    outputSchema: toolContracts.repo_branch_audit.output,
    annotations: remoteReadAnnotations,
    handler: branchAuditHandler
  },
  {
    name: "repo_write_retire_branch",
    title: "Retire verified branch",
    description: descriptions.repo_write_retire_branch,
    inputSchema: toolContracts.repo_write_retire_branch.input,
    outputSchema: toolContracts.repo_write_retire_branch.output,
    annotations: remoteWriteAnnotations,
    handler: writeRetireBranchHandler
  }
];
