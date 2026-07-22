import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix as pathPosix, win32 as pathWin32 } from "node:path";
import process from "node:process";

export const RUNTIME_STATUS_VERSION = 1;
export const RUNTIME_CONTROL_VERSION = 1;
export const DEFAULT_STATUS_MAX_AGE_MS = 15_000;
export const DEFAULT_RESTART_DELAY_MS = 4_000;
const CONTROL_ACTIONS = new Set(["restart_mcp", "restart_all"]);

export function resolveRuntimeDirectory(env = process.env, platform = process.platform, homeDirectory = homedir()) {
  const configured = env.GPT_REPO_RUNTIME_DIR?.trim();
  if (configured) return configured;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || pathWin32.join(homeDirectory, "AppData", "Local");
    return pathWin32.join(localAppData, "gpt-repo-mcp", "runtime");
  }
  return pathPosix.join(homeDirectory, ".gpt-repo-mcp", "runtime");
}

export function runtimePaths(runtimeDirectory = resolveRuntimeDirectory()) {
  return {
    directory: runtimeDirectory,
    status: join(runtimeDirectory, "status.json"),
    control: join(runtimeDirectory, "control.json"),
    lock: join(runtimeDirectory, "supervisor.lock"),
    log: join(runtimeDirectory, "runtime.log")
  };
}

export async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonFileIfPresent(path) {
  try {
    return await readJsonFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function isFreshRuntimeStatus(status, now = Date.now(), maxAgeMs = DEFAULT_STATUS_MAX_AGE_MS) {
  if (!status || status.version !== RUNTIME_STATUS_VERSION || typeof status.updated_at !== "string") return false;
  const updatedAt = Date.parse(status.updated_at);
  return Number.isFinite(updatedAt) && now - updatedAt >= 0 && now - updatedAt <= maxAgeMs;
}

export function createControlRequest(action, options = {}) {
  if (!CONTROL_ACTIONS.has(action)) throw new Error(`Unsupported runtime control action: ${action}`);
  const now = options.now ?? Date.now();
  const delayMs = options.delayMs ?? DEFAULT_RESTART_DELAY_MS;
  if (!Number.isInteger(delayMs) || delayMs < 1_000 || delayMs > 30_000) {
    throw new Error("Runtime restart delay must be between 1000 and 30000 milliseconds.");
  }
  return {
    version: RUNTIME_CONTROL_VERSION,
    request_id: options.requestId ?? randomUUID(),
    action,
    requested_at: new Date(now).toISOString(),
    not_before: new Date(now + delayMs).toISOString()
  };
}

export function isDueControlRequest(request, now = Date.now()) {
  if (!request || request.version !== RUNTIME_CONTROL_VERSION || !CONTROL_ACTIONS.has(request.action)) return false;
  if (typeof request.request_id !== "string" || request.request_id.length < 8) return false;
  const notBefore = Date.parse(request.not_before);
  return Number.isFinite(notBefore) && notBefore <= now;
}
