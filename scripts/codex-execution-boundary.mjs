const MODEL_CACHE_WARNING = "missing field supports_reasoning_summaries";
const STRUCTURED_SANDBOX_CODES = new Set([
  "orchestrator_helper_launch_failed",
  "windows_sandbox_failed",
  "sandbox_bootstrap_failed",
  "sandbox_setup_refresh_failed"
]);
const SANDBOX_TEXT_MARKERS = [
  { code: "orchestrator_helper_launch_failed", pattern: /orchestrator_helper_launch_failed/i },
  { code: "windows_sandbox_helper_missing", pattern: /codex-windows-sandbox-setup\.exe[\s\S]{0,240}(?:program not found|not found|cannot find|missing)/i },
  { code: "windows_sandbox_helper_spawn_failed", pattern: /failed to spawn[\s\S]{0,160}codex-windows-sandbox-setup\.exe/i },
  { code: "windows_sandbox_failed", pattern: /windows sandbox failed/i },
  { code: "sandbox_setup_refresh_failed", pattern: /setup refresh failed/i }
];
const RAW_HOST_TOOL = /(?:^|[._/-])(?:node|nodejs|node_repl|js|js_repl|javascript|javascript_repl|deno|deno_repl|bun|bun_repl)(?:$|[._/-])/i;
const FILE_OR_GIT_OPERATION = /(?:node:fs|require\s*\(\s*["']fs["']|\bfs\s*\.|readfile|writefile|appendfile|readdir|mkdir|rename|unlink|\brm\s*\(|\bstat\s*\(|\baccess\s*\(|child_process|simple-git|\bgit(?:\.exe)?\s|execfile\s*\(|spawn\s*\()/i;

export function createCodexExecutionBoundaryTracker(options = {}) {
  const sandboxRequested = String(options.sandboxRequested ?? "workspace-write");
  const sandboxBootstrapVerified = options.sandboxBootstrapVerified === true;
  let sandboxFailureDetected = false;
  let sandboxFailureCode = null;
  let sandboxFailurePriority = 0;
  let diagnosticTail = "";
  let successfulBuiltinOperations = 0;
  const fallbackToolViolations = new Set();
  const externalToolCalls = new Set();
  const unknownToolEvents = new Set();
  const warnings = new Set();

  function inspectText(value) {
    const text = boundedText(value);
    if (!text) return;
    if (text.toLowerCase().includes(MODEL_CACHE_WARNING)) warnings.add("CODEX_MODEL_CACHE_WARNING");
    const failure = detectSandboxFailureText(text);
    if (failure) recordSandboxFailure(failure, 1);
  }

  function observeDiagnostic(value) {
    diagnosticTail = `${diagnosticTail}${boundedText(value)}`.slice(-32_768);
    inspectText(diagnosticTail);
  }

  function observeEvent(event) {
    const structuredCode = findStructuredSandboxCode(event);
    if (structuredCode) recordSandboxFailure(structuredCode, 2);
    inspectText(event);

    const eventType = safeToken(event?.type);
    const item = event?.item && typeof event.item === "object" ? event.item : null;
    const itemType = safeToken(item?.type);
    if (!item || !itemType) return;

    if (itemType === "command_execution" || itemType === "file_change") {
      if (eventType === "item.completed" && itemSucceeded(item)) successfulBuiltinOperations += 1;
      return;
    }

    if (itemType === "mcp_tool_call") {
      const identity = toolIdentity(item);
      externalToolCalls.add(identity);
      fallbackToolViolations.add(`${identity}:unverified_external_tool_path`);
      const eventText = boundedText(event);
      if (RAW_HOST_TOOL.test(identity) && FILE_OR_GIT_OPERATION.test(eventText)) {
        fallbackToolViolations.add(`${identity}:host_file_or_git_operation`);
      }
      return;
    }

    if (looksLikeToolEvent(itemType)) unknownToolEvents.add(itemType);
  }

  function recordSandboxFailure(code, priority) {
    sandboxFailureDetected = true;
    if (!sandboxFailureCode || priority > sandboxFailurePriority) {
      sandboxFailureCode = code;
      sandboxFailurePriority = priority;
    }
  }

  function finalize(options = {}) {
    const resultPath = normalizePath(options.resultPath ?? "");
    const materialChangedPaths = [...new Set((options.changedPaths ?? [])
      .map(normalizePath)
      .filter(Boolean)
      .filter((path) => path !== resultPath)
      .filter((path) => !path.startsWith(".chatgpt/codex-runs/")))].sort();

    if (materialChangedPaths.length > 0) {
      for (const identity of externalToolCalls) fallbackToolViolations.add(`${identity}:unverified_external_write_path`);
      for (const itemType of unknownToolEvents) fallbackToolViolations.add(`${itemType}:unknown_tool_write_path`);
      if (successfulBuiltinOperations === 0) fallbackToolViolations.add("unknown_write_provenance");
    }

    const violations = [...fallbackToolViolations].sort();
    const executionBoundaryVerified = sandboxBootstrapVerified && !sandboxFailureDetected && violations.length === 0;
    return {
      sandbox_requested: sandboxRequested,
      sandbox_bootstrap_verified: sandboxBootstrapVerified,
      sandbox_failure_detected: sandboxFailureDetected,
      sandbox_failure_code: sandboxFailureCode,
      sandboxed_operation_observed: successfulBuiltinOperations > 0,
      execution_boundary_verified: executionBoundaryVerified,
      fallback_tool_violations: violations,
      material_changed_paths: materialChangedPaths,
      warnings: [...warnings].sort()
    };
  }

  return {
    observeEvent,
    observeStderr: observeDiagnostic,
    observeDiagnostic,
    finalize
  };
}

export function analyzeCodexJsonl(value, options = {}) {
  const tracker = createCodexExecutionBoundaryTracker(options);
  const lines = String(value ?? "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      const error = new Error("Codex returned a non-JSONL output line.");
      error.code = "CODEX_OUTPUT_INVALID";
      throw error;
    }
    tracker.observeEvent(event);
  }
  return tracker;
}

export function detectSandboxFailureText(value) {
  const text = String(value ?? "");
  for (const marker of SANDBOX_TEXT_MARKERS) {
    if (marker.pattern.test(text)) return marker.code;
  }
  return null;
}

function findStructuredSandboxCode(value) {
  const queue = [{ value, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 500) {
    const current = queue.shift();
    visited += 1;
    if (!current || current.depth > 8) continue;
    const item = current.value;
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 100)) queue.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    for (const [key, child] of Object.entries(item).slice(0, 100)) {
      if (["code", "error_code", "failure_code", "kind"].includes(key.toLowerCase()) && typeof child === "string") {
        const normalized = child.trim().toLowerCase();
        if (STRUCTURED_SANDBOX_CODES.has(normalized) || normalized.includes("orchestrator_helper_launch_failed")) return normalized;
      }
      queue.push({ value: child, depth: current.depth + 1 });
    }
  }
  return null;
}

function itemSucceeded(item) {
  if (item?.status === "failed" || item?.status === "error") return false;
  if (typeof item?.exit_code === "number") return item.exit_code === 0;
  return item?.status === undefined || item?.status === "completed" || item?.status === "success";
}

function looksLikeToolEvent(itemType) {
  return itemType.includes("tool") || itemType.endsWith("_call") || itemType.endsWith("_execution");
}

function toolIdentity(item) {
  const server = safeToken(item?.server) || "unknown_server";
  const tool = safeToken(item?.tool) || "unknown_tool";
  return `${server}/${tool}`.slice(0, 160);
}

function safeToken(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9._/-]+/g, "_").slice(0, 100) : "";
}

function boundedText(value) {
  if (typeof value === "string") return value.slice(-16_384);
  try {
    return JSON.stringify(value).slice(-16_384);
  } catch {
    return "";
  }
}

function normalizePath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
}
