import process from "node:process";
import {
  createControlRequest,
  isFreshRuntimeStatus,
  readJsonFileIfPresent,
  runtimePaths,
  writeJsonAtomic
} from "./runtime-state.mjs";

const command = process.argv[2];
const paths = runtimePaths();

if (command === "status") {
  const status = await readJsonFileIfPresent(paths.status);
  if (!isFreshRuntimeStatus(status)) {
    globalThis.console.error("GPT Repo MCP supervisor is not running or its heartbeat is stale.");
    process.exit(1);
  }
  const mcp = status.mcp ?? {};
  const tunnel = status.tunnel ?? {};
  globalThis.console.log(`Supervisor: running (pid ${status.supervisor_pid ?? "unknown"})`);
  globalThis.console.log(`MCP: ${mcp.state ?? "unknown"}${mcp.pid ? ` (pid ${mcp.pid})` : ""}, restarts ${mcp.restarts ?? 0}`);
  if (mcp.last_exit) globalThis.console.log(`MCP last exit: ${formatLastExit(mcp.last_exit)}`);
  globalThis.console.log(`Tunnel: ${tunnel.state ?? "unknown"}${tunnel.source ? ` (${tunnel.source})` : ""}, restarts ${tunnel.restarts ?? 0}`);
  if (tunnel.last_exit) globalThis.console.log(`Tunnel last exit: ${formatLastExit(tunnel.last_exit)}`);
  if (typeof tunnel.public_url === "string" && tunnel.public_url.startsWith("https://")) {
    globalThis.console.log(`Public host: ${tunnel.public_url}`);
  }
  process.exit(0);
}

const action = command === "restart-mcp"
  ? "restart_mcp"
  : command === "restart-all"
    ? "restart_all"
    : undefined;

if (!action) {
  globalThis.console.error("Usage: node scripts/runtime-control.mjs <status|restart-mcp|restart-all>");
  process.exit(1);
}

const status = await readJsonFileIfPresent(paths.status);
if (!isFreshRuntimeStatus(status)) {
  globalThis.console.error("Cannot schedule restart because the GPT Repo MCP supervisor is not running.");
  process.exit(1);
}

const request = createControlRequest(action);
await writeJsonAtomic(paths.control, request);
globalThis.console.log(
  `${action === "restart_mcp" ? "MCP" : "MCP and tunnel"} restart scheduled after the current tool response, request ${request.request_id}.`
);

function formatLastExit(lastExit) {
  const code = lastExit?.code ?? "null";
  const signal = lastExit?.signal ?? "null";
  const at = typeof lastExit?.at === "string" ? lastExit.at : "unknown";
  return `code=${code}, signal=${signal}, at=${at}`;
}
