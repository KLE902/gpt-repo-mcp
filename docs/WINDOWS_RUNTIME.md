# Supervised Windows Runtime

The supervised Windows runtime keeps GPT Repo MCP and its public ngrok tunnel available without an interactive command window. It also gives an approved ChatGPT workflow a bounded way to reload a newly built MCP server.

This is an optional Windows operating mode. The normal `npm run connect` flow remains useful for first-time setup, troubleshooting, and temporary sessions.

## Why a supervisor is required

A server process cannot reliably replace itself while it is handling the request that asks for the replacement. It also cannot recover after it has crashed. The supervised runtime therefore separates responsibilities:

```text
Windows Task Scheduler
  -> runtime-supervisor.mjs
       -> dist/server.js
       -> ngrok, or an already active ngrok agent
```

The supervisor runs outside the MCP process. It:

- starts the compiled MCP server from `dist/server.js`
- reuses an active ngrok HTTPS endpoint when available
- otherwise starts and monitors ngrok
- restarts MCP or ngrok independently after an unexpected exit
- writes a local heartbeat and bounded runtime state outside the repository
- accepts only fixed control actions from a user-local control file

The complete connector URL continues to use the existing user-local `/t/<stable-path>/mcp` value. The path value is never written to the repository or runtime log.

## One-time installation

Complete the normal clone, install, config, and connector setup first. From PowerShell in the repository, run:

```powershell
npm run install:windows-runtime
```

The command:

1. builds the current MCP server
2. creates or replaces the current-user scheduled task `GPT Repo MCP Runtime`
3. configures automatic start at Windows sign-in
4. configures Task Scheduler restart-on-failure behavior
5. starts the supervisor immediately
6. adds two fixed local allowlisted scripts to the `gpt-repo-mcp` entry in `config.local.json`

The local allowlisted scripts are:

- `mcp.runtime.status`
- `mcp.runtime.restart`

`config.local.json` remains local and ignored by Git.

If an older `Start GPT Repo MCP.cmd` window is still running, close that window once after installation so only the supervisor owns local port `8787`. During installation the supervisor may temporarily reuse the ngrok process owned by the old launcher. Closing that launcher can therefore cause one tunnel replacement. Run `npm run runtime:status` afterward and update the ChatGPT connector only if the reported public host changed.

## Verify the runtime

Run:

```powershell
npm run runtime:status
```

A healthy response reports a fresh supervisor heartbeat plus the current MCP and tunnel states.

The scheduled-task state can also be inspected with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-windows-runtime.ps1 -Action Status
```

Runtime files are user-local. By default they are under:

```text
%LOCALAPPDATA%\gpt-repo-mcp\runtime
```

The directory contains a heartbeat/status document, a single fixed-action control request, a supervisor lock, and a bounded operational log. Set `GPT_REPO_RUNTIME_DIR` before installation only when another local runtime directory is required.

## Self-reload workflow

After the supervised runtime is installed, an authorized ChatGPT delivery flow can:

1. change and verify the MCP repository
2. build `dist/server.js`
3. call `repo_run_allowed_script` for repo id `gpt-repo-mcp` with script id `mcp.runtime.restart`
4. reconnect or retry after the short restart interval

The restart script does not terminate processes itself. It verifies that the supervisor heartbeat is fresh, writes one `restart_mcp` request, and returns. The request has a short `not_before` delay so the current tool response can complete before the supervisor stops the old MCP child.

The ngrok process is not restarted during a normal MCP reload. This keeps the public endpoint stable while the server implementation changes.

A local operator can request the same reload with:

```powershell
npm run runtime:restart
```

## Security boundary

Runtime control is deliberately smaller than a process runner:

- the caller cannot supply executable names
- the caller cannot supply command text or arguments
- no shell is used
- only `status`, `restart_mcp`, and the local-only `restart_all` action exist
- the ChatGPT allowlist installs only `status` and `restart_mcp`
- the supervisor accepts only versioned, validated control documents
- stale heartbeat state blocks a restart request
- runtime output does not reveal the stable public path token
- normal repository policy, exact HEAD guards, output limits, and redaction still apply to `repo_run_allowed_script`

This design does not add a generic service-management MCP tool.

## Operating characteristics

- The scheduled task runs for the current Windows user after sign-in. It is not a pre-logon system service.
- The PC must be powered on, connected, and signed in for ChatGPT to reach the local repositories.
- A restart invalidates active MCP sessions. The next tool call may need to establish a new session or be retried.
- A newly added or renamed MCP tool may still require ChatGPT connector metadata refresh or a new conversation after the server has reloaded.
- The supervisor runs the checked-in compiled build. Run `npm run build` before requesting a reload.
- If the public ngrok host changes, update the ChatGPT connector URL. The user-local path segment remains stable.

## Task management

Stop or start the task:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-windows-runtime.ps1 -Action Stop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-windows-runtime.ps1 -Action Start
```

Remove the supervised runtime:

```powershell
npm run uninstall:windows-runtime
```

Uninstalling removes the scheduled task. It does not delete the repository, local config, public path value, or user-local runtime log.

## Recovery

If `npm run runtime:status` reports a stale or missing supervisor:

1. inspect the scheduled task with `-Action Status`
2. run `-Action Start`
3. inspect `%LOCALAPPDATA%\gpt-repo-mcp\runtime\runtime.log`
4. confirm `dist/server.js`, `config.local.json`, Node.js, ngrok, and port `8787`
5. reinstall with `npm run install:windows-runtime` when the repository path or Node installation changed

Use `npm run connect` as the fallback diagnostic path. It remains independent of the scheduled-task installation.

## Console window behavior

The scheduled task starts the supervisor through a fixed PowerShell launcher with `-WindowStyle Hidden`. No persistent console window should remain open during normal supervised operation. Reinstall the current runtime build if an older task still starts `node.exe` interactively.

`npm run runtime:status` reports the most recent MCP or tunnel exit when one exists. A restart counter that remains unchanged while the process is healthy is historical and does not by itself indicate an active restart loop.

## No-console scheduled launcher

The Windows scheduled task uses `wscript.exe` with the fixed `scripts/start-runtime-supervisor.vbs` launcher. Windows Script Host starts the Node.js supervisor with window style `0` and waits for it, so Task Scheduler continues to own the long-lived process without leaving a PowerShell or console window open. The previous PowerShell launcher remains only as a diagnostic fallback and is not used by the scheduled task.
