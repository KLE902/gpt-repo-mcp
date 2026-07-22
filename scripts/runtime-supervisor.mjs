import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { appendFile, mkdir, open, readFile, stat, truncate, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { ensureGitHubRuntimeAccess } from "./github-runtime-access.mjs";
import { loadOrCreatePublicPathToken } from "./public-path-token.mjs";
import {
  isDueControlRequest,
  readJsonFileIfPresent,
  runtimePaths,
  writeJsonAtomic
} from "./runtime-state.mjs";

const PORT = "8787";
const NGROK_API_URL = "http://127.0.0.1:4040/api/tunnels";
const HEARTBEAT_INTERVAL_MS = 1_000;
const CONTROL_INTERVAL_MS = 500;
const RETRY_DELAY_MS = 2_000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

const options = parseArguments(process.argv.slice(2));
const repoRoot = resolve(options.repo ?? process.cwd());
const configPath = resolve(repoRoot, options.config ?? "config.local.json");
const serverPath = resolve(repoRoot, "dist", "server.js");
const paths = runtimePaths();

let shuttingDown = false;
let mcpChild;
let tunnelChild;
let mcpRestartTimer;
let tunnelRestartTimer;
let lastControlRequestId;
let lockHandle;
let publicPathSegment = "";
let logWrite = Promise.resolve();
const startedAt = new Date().toISOString();
const state = {
  mcp: { state: "starting", pid: undefined, restarts: 0, last_exit: undefined },
  tunnel: { state: "starting", pid: undefined, restarts: 0, source: undefined, public_url: undefined, last_exit: undefined }
};

await mkdir(paths.directory, { recursive: true });
await acquireLock();
await appendLog(`Supervisor starting for ${repoRoot}.`);

const pathState = await loadOrCreatePublicPathToken();
publicPathSegment = pathState.value;
const githubAccess = ensureGitHubRuntimeAccess();
await appendLog(githubAccess.available ? `GitHub runtime access available from ${githubAccess.source}.` : "GitHub runtime access unavailable.");

startMcp();
await ensureTunnel();
await writeStatus();

const heartbeatTimer = globalThis.setInterval(() => void writeStatus(), HEARTBEAT_INTERVAL_MS);
const controlTimer = globalThis.setInterval(() => void pollControl(), CONTROL_INTERVAL_MS);
const tunnelMonitorTimer = globalThis.setInterval(() => void monitorTunnel(), 2_000);

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  void appendLog(`Uncaught exception: ${safeError(error)}`).finally(() => void shutdown("uncaughtException", 1));
});
process.on("unhandledRejection", (error) => {
  void appendLog(`Unhandled rejection: ${safeError(error)}`).finally(() => void shutdown("unhandledRejection", 1));
});

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--repo" || current === "--config" || current === "--npm-cli") {
      const value = args[index + 1];
      if (!value) throw new Error(`Missing value for ${current}.`);
      parsed[current.slice(2).replace("-", "_")] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown supervisor argument: ${current}`);
  }
  return parsed;
}

async function acquireLock() {
  try {
    lockHandle = await open(paths.lock, "wx", 0o600);
    await lockHandle.writeFile(`${process.pid}\n`, "utf8");
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const existingPid = Number.parseInt((await readFile(paths.lock, "utf8").catch(() => "")).trim(), 10);
  if (Number.isInteger(existingPid) && processExists(existingPid)) {
    throw new Error(`Another GPT Repo MCP supervisor is already running with pid ${existingPid}.`);
  }
  await unlink(paths.lock).catch(() => undefined);
  lockHandle = await open(paths.lock, "wx", 0o600);
  await lockHandle.writeFile(`${process.pid}\n`, "utf8");
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function childEnvironment() {
  return {
    ...process.env,
    GPT_REPO_CONFIG: configPath,
    REPO_READER_CONFIG: configPath,
    PORT,
    GPT_REPO_PUBLIC_PATH_TOKEN: publicPathSegment,
    REPO_READER_PUBLIC_PATH_TOKEN: publicPathSegment,
    ...(options.npm_cli ? { npm_execpath: options.npm_cli } : {})
  };
}

function startMcp() {
  if (shuttingDown || mcpChild) return;
  globalThis.clearTimeout(mcpRestartTimer);
  state.mcp.state = "starting";
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: childEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  mcpChild = child;
  state.mcp.pid = child.pid;
  pipeOutput(child.stdout, "mcp");
  pipeOutput(child.stderr, "mcp");
  child.once("spawn", () => {
    state.mcp.state = "running";
    void appendLog(`MCP started with pid ${child.pid}.`);
  });
  child.once("error", (error) => {
    void appendLog(`MCP start error: ${safeError(error)}`);
  });
  child.once("exit", (code, signal) => {
    if (mcpChild === child) mcpChild = undefined;
    state.mcp.pid = undefined;
    state.mcp.state = shuttingDown ? "stopped" : "waiting";
    state.mcp.last_exit = { code, signal, at: new Date().toISOString() };
    if (!shuttingDown) {
      state.mcp.restarts += 1;
      void appendLog(`MCP exited (code=${code ?? "null"}, signal=${signal ?? "null"}); restart scheduled.`);
      mcpRestartTimer = globalThis.setTimeout(startMcp, RETRY_DELAY_MS);
    }
  });
}

async function ensureTunnel() {
  if (shuttingDown || tunnelChild) return;
  const existing = await readNgrokHttpsUrl().catch(() => undefined);
  if (existing) {
    state.tunnel.state = "running";
    state.tunnel.source = "reused";
    state.tunnel.public_url = existing;
    return;
  }
  startTunnel();
}

function startTunnel() {
  if (shuttingDown || tunnelChild) return;
  globalThis.clearTimeout(tunnelRestartTimer);
  state.tunnel.state = "starting";
  state.tunnel.source = "supervised";
  const child = spawn("ngrok", ["http", PORT, "--log=stdout"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  tunnelChild = child;
  state.tunnel.pid = child.pid;
  pipeOutput(child.stdout, "tunnel");
  pipeOutput(child.stderr, "tunnel");
  child.once("spawn", () => {
    state.tunnel.state = "running";
    void appendLog(`ngrok started with pid ${child.pid}.`);
  });
  child.once("error", (error) => {
    void appendLog(`ngrok start error: ${safeError(error)}`);
  });
  child.once("exit", (code, signal) => {
    if (tunnelChild === child) tunnelChild = undefined;
    state.tunnel.pid = undefined;
    state.tunnel.public_url = undefined;
    state.tunnel.state = shuttingDown ? "stopped" : "waiting";
    state.tunnel.last_exit = { code, signal, at: new Date().toISOString() };
    if (!shuttingDown) {
      state.tunnel.restarts += 1;
      void appendLog(`ngrok exited (code=${code ?? "null"}, signal=${signal ?? "null"}); restart scheduled.`);
      tunnelRestartTimer = globalThis.setTimeout(startTunnel, RETRY_DELAY_MS);
    }
  });
}

async function monitorTunnel() {
  if (shuttingDown) return;
  const publicUrl = await readNgrokHttpsUrl().catch(() => undefined);
  if (publicUrl) {
    state.tunnel.public_url = publicUrl;
    state.tunnel.state = "running";
    return;
  }
  state.tunnel.public_url = undefined;
  if (!tunnelChild) {
    state.tunnel.state = "waiting";
    state.tunnel.restarts += 1;
    startTunnel();
  }
}

async function readNgrokHttpsUrl() {
  const response = await globalThis.fetch(NGROK_API_URL);
  if (!response.ok) return undefined;
  const payload = await response.json();
  const tunnels = Array.isArray(payload?.tunnels) ? payload.tunnels : [];
  return tunnels.find((tunnel) => typeof tunnel?.public_url === "string" && tunnel.public_url.startsWith("https://"))?.public_url;
}

async function pollControl() {
  if (shuttingDown) return;
  const request = await readJsonFileIfPresent(paths.control).catch(async (error) => {
    await appendLog(`Could not read runtime control request: ${safeError(error)}`);
    return undefined;
  });
  if (!request || request.request_id === lastControlRequestId || !isDueControlRequest(request)) return;
  lastControlRequestId = request.request_id;
  await unlink(paths.control).catch(() => undefined);
  await appendLog(`Accepted runtime control action ${request.action}, request ${request.request_id}.`);
  if (request.action === "restart_mcp") {
    restartMcp();
  } else if (request.action === "restart_all") {
    restartMcp();
    restartTunnel();
  }
}

function restartMcp() {
  globalThis.clearTimeout(mcpRestartTimer);
  if (mcpChild) {
    state.mcp.state = "restarting";
    mcpChild.kill("SIGTERM");
  } else {
    mcpRestartTimer = globalThis.setTimeout(startMcp, 250);
  }
}

function restartTunnel() {
  globalThis.clearTimeout(tunnelRestartTimer);
  if (tunnelChild) {
    state.tunnel.state = "restarting";
    tunnelChild.kill("SIGTERM");
  } else if (state.tunnel.source !== "reused") {
    tunnelRestartTimer = globalThis.setTimeout(startTunnel, 250);
  }
}

function pipeOutput(stream, label) {
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) void appendLog(`[${label}] ${line}`);
  });
  stream.on("end", () => {
    if (buffer) void appendLog(`[${label}] ${buffer}`);
  });
}

async function writeStatus() {
  await writeJsonAtomic(paths.status, {
    version: 1,
    supervisor_pid: process.pid,
    started_at: startedAt,
    updated_at: new Date().toISOString(),
    repo_root: repoRoot,
    mcp: state.mcp,
    tunnel: state.tunnel
  }).catch((error) => appendLog(`Could not write runtime status: ${safeError(error)}`));
}

function appendLog(message) {
  const safeMessage = publicPathSegment ? message.replaceAll(publicPathSegment, "[redacted-path]") : message;
  const line = `${new Date().toISOString()} ${safeMessage}\n`;
  logWrite = logWrite.then(async () => {
    try {
      const current = await stat(paths.log);
      if (current.size + Buffer.byteLength(line, "utf8") > MAX_LOG_BYTES) {
        await truncate(paths.log, 0);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await appendFile(paths.log, line, "utf8");
  }).catch(() => undefined);
  return logWrite;
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  globalThis.clearInterval(heartbeatTimer);
  globalThis.clearInterval(controlTimer);
  globalThis.clearInterval(tunnelMonitorTimer);
  globalThis.clearTimeout(mcpRestartTimer);
  globalThis.clearTimeout(tunnelRestartTimer);
  await appendLog(`Supervisor stopping due to ${reason}.`);
  mcpChild?.kill("SIGTERM");
  tunnelChild?.kill("SIGTERM");
  state.mcp.state = "stopped";
  state.tunnel.state = "stopped";
  await writeStatus();
  await lockHandle?.close().catch(() => undefined);
  await unlink(paths.lock).catch(() => undefined);
  process.exit(exitCode);
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}
