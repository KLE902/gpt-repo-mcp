# Setup

This guide gets a local GPT Repo MCP (`gpt-repo-mcp`) server configured for approved repositories. For ChatGPT Developer Mode connection steps, see [CHATGPT_CONNECT.md](CHATGPT_CONNECT.md). For tunnel choices, see [CONNECTION_OPTIONS.md](CONNECTION_OPTIONS.md).

## Requirements

- Node.js 20 or newer
- npm
- git
- ngrok for the built-in `npm run connect` convenience tunnel, or another HTTPS tunnel for manual setup
- ChatGPT account with Developer Mode access

ChatGPT cannot call `localhost` directly. The fastest OSS setup is `npm run connect`, which starts the local MCP server, starts or reuses ngrok, and prints a public HTTPS URL ending in `/t/<stable-local-token>/mcp`.

## Install ngrok from zero

Use this section if you have never installed or used ngrok before. GPT Repo MCP uses the ngrok Agent CLI to expose your local MCP server on a temporary HTTPS URL for ChatGPT.

### 1. Create an ngrok account

Create a free ngrok account in the ngrok dashboard. After signing in, open the dashboard setup page. The dashboard shows a one-time account connection command for your machine.

### 2. Install the ngrok Agent CLI

macOS with Homebrew:

```bash
brew install ngrok
```

Debian/Ubuntu Linux:

```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
  && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | sudo tee /etc/apt/sources.list.d/ngrok.list \
  && sudo apt update \
  && sudo apt install ngrok
```

Windows:

Install ngrok from the Microsoft Store or from the ngrok download page, then open PowerShell or Terminal.

### 3. Verify ngrok is installed

Run `ngrok help`. If this prints ngrok help text, the CLI is available on your PATH.

### 4. Connect ngrok to your account

Copy the account connection command from your ngrok dashboard and run it once in your terminal. Do not commit the account value from that command to this repo or paste it into ChatGPT.

### 5. Use ngrok through GPT Repo MCP

After ngrok is installed and connected to your account, use the normal quickstart: `npm run connect`.

`npm run connect` starts the local MCP server on port `8787`, starts or reuses ngrok, and prints the ChatGPT connector URL ending in `/t/<stable-local-token>/mcp`. The first run creates the value under the user profile and later runs reuse it. You do not need to run `ngrok http 8787` yourself unless you are following the manual tunnel flow.

## Install

```bash
git clone https://github.com/CAHN91/gpt-repo-mcp.git
cd gpt-repo-mcp
npm install
```

## Build

Run `npm run build`.

## Create Local Config

Run `cp config.example.json config.local.json`. This creates a valid empty local config with no approved repositories. `config.local.json` is ignored by git and should stay uncommitted.

## Add A Repository

```bash
npm run add -- /path/to/your/repo
```

The CLI adds the first approved local repository root to the empty `config.local.json`. It prompts for a permission mode when stdin is interactive: `read`, `write`, or `ship`. Non-interactive runs default to read mode.

Use explicit mode flags when you want predictable setup:

```bash
npm run add -- /path/to/your/repo --mode read
npm run add -- /path/to/your/repo --mode write
npm run add -- /path/to/your/repo --mode ship
```

- `read`: read-only tools.
- `write`: read tools plus broad repo-local writes guarded by hard denied paths, secret checks, path sandboxing, and size limits.
- `ship`: write mode plus bounded new feature-branch creation, local Git operations, and the GitHub `origin` workflow.

No mode enables unrestricted Git or shell execution. Force-push, direct push to `main`/`master`, switching to an existing branch, reset, rebase, stash, `git clean`, and branch deletion remain unavailable. `ship` adds only fixed creation of a brand-new feature branch plus the bounded remote tools.

Permission mode summary:

| Mode | Effect |
| --- | --- |
| `read` | Read-only repository tools; writes and local operations stay disabled. |
| `write` | Read tools plus broad repo-local writes guarded by hard denied paths, secret checks, path sandboxing, and size limits. |
| `ship` | Same write policy as `write`, plus bounded new feature-branch creation, local stage/commit/recovery, and the GitHub `origin` workflow. |

## List Repositories

Run `npm run list`. Use the listed `repo_id` in prompts such as:

```text
Use GPT Repo MCP. Give me a project brief for <repo_id>.
```

## Remove A Repository

Run `npm run remove -- <repo_id>`. The `gpt-repo` binary is also available when the package is linked or installed. Clone-based setup should use the npm scripts above.

## Check Config

Run `npm run check:config`.

## Doctor

Run `npm run doctor`. The doctor command checks config validation, package scripts, ngrok availability, tunnel state, port `8787`, and git status without dumping raw config or secrets. Run it after adding a repository for full green status. Before adding a repository, the empty starter config still validates and doctor may report `WARN config has no repositories`.

## Quickstart: Start MCP And Built-In Tunnel

Use the built-in convenience path first: `npm run connect`.

This starts the local MCP server and tries to use or reuse ngrok. It should print:

```text
ChatGPT MCP URL: https://<ngrok-host>/t/<stable-local-token>/mcp
```

Paste the exact printed URL into ChatGPT Developer Mode connector settings. The path value is generated once under the current user's profile, reused across restarts, kept outside Git, and separate from GitHub credentials. It is guess-resistance only, not authentication. Anyone with the full URL can reach the endpoint while the tunnel is running. The connector URL still changes if the tunnel provider changes its public host.

## Windows desktop launcher

Run this once from the repository:

```powershell
npm run install:desktop-launcher
```

The installer creates `Start GPT Repo MCP.cmd` on the current user's Desktop and records the current repository path in that local launcher. Double-click it after Windows starts and keep the command window open while ChatGPT uses the connector. Use `npm run install:desktop-launcher -- -Force` to replace an existing launcher.

## Manual Tunnel Setup

Use `npm run mcp` when you want to run the local server yourself and expose port `8787` through your own HTTPS tunnel, reverse proxy, or network setup:

```bash
npm run mcp
```

`npm run mcp` starts only the local MCP server on localhost. It does not start a tunnel and does not generate a public path token by itself.

For a manual public tunnel, start the MCP server with an explicit random public path value. See [CONNECTION_OPTIONS.md](CONNECTION_OPTIONS.md) for the advanced environment-variable form.

Then start a tunnel in another terminal with `ngrok http 8787` or `cloudflared tunnel --url http://localhost:8787`.

Use `https://<public-host>/t/<that-token>/mcp`.

You can also use `npm run tunnel` to start only the bundled ngrok command for local debugging.

## Advanced: OpenAI Secure MCP Tunnel

For longer-lived or private connector setups, and for workspaces that support it, use OpenAI Secure MCP Tunnel. Run `cp .env.example .env`, fill `.env` with your OpenAI Secure MCP Tunnel runtime API key, `tunnel-client` binary path, and profile name, then run `npm run connect:secure`. The profile name in `.env.example` is only a convention; create or configure that profile locally, or replace it with your own configured profile name. See [CONNECTION_OPTIONS.md](CONNECTION_OPTIONS.md) for connection details.

## How To Know It Worked

- `npm run connect` prints an HTTPS URL ending in `/t/<stable-local-token>/mcp` and reuses the same local value on later starts.
- Or `npm run connect:secure` starts the local MCP server and `tunnel-client`.
- ChatGPT Developer Mode accepts the connector URL.
- A new ChatGPT conversation can call the connector.
- This prompt returns your configured repos:

```text
Use GPT Repo MCP. Which repositories can you access?
```

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the MCP server and CLI. |
| `npm run doctor` | Check local setup and tunnel readiness. |
| `npm run connect` | Start the server, stable local path value, and ngrok. |
| `npm run connect:secure` | Start the server and OpenAI Secure MCP Tunnel. |
| `npm run install:desktop-launcher` | Create the Windows desktop launcher for this checkout. |
| `npm run mcp` | Start only the local MCP server. |
| `npm run tunnel` | Start only the ngrok tunnel. |
| `npm run list` | List approved repositories. |
| `npm run add -- <path>` | Add an approved repository root. |
| `npm run add -- <path> --mode <mode>` | Add a repository root with explicit `read`, `write`, or `ship` mode. |
| `npm run remove -- <repo_id>` | Remove an approved repository root. |
| `npm run check:config` | Validate local config. |
| `npm test -- tests/tool-contracts.test.ts tests/mcp-contract.test.ts` | Run focused MCP contract checks. |

## Opt-In Mutating Tools

The default setup is read-mostly. Mutating tools are disabled by default and should only be enabled for trusted repositories.

Enable them per repo in `config.local.json`:

```json
{
  "repos": [
    {
      "repo_id": "example-repo",
      "writes": {
        "enabled": true
      },
      "operations": {
        "enabled": true,
        "git_stage_enabled": true,
        "git_commit_enabled": true,
        "git_branch_enabled": true,
        "git_push_enabled": true,
        "github_pull_request_enabled": true,
        "github_merge_enabled": true,
        "git_sync_enabled": true,
        "cleanup_enabled": true
      }
    }
  ]
}
```

Write, Git, and cleanup actions remain policy-limited. ChatGPT may ask for client-level confirmation for mutating tool calls unless approval is remembered for the conversation; that UI confirmation is separate from the project decision model. Within an authorized delivery task, routine work may create a new feature branch from the exact current branch/HEAD, commit, push, and create or update the PR without a separate conversational approval. PR merge still requires an explicit owner decision.

If a read, write, or cleanup path is unexpectedly blocked, ask ChatGPT to run `repo_policy_explain` with the repo id and path. It explains read/write/cleanup policy decisions and all local/remote operation toggles without reading or mutating files.

## GitHub Runtime Access

PR creation, check inspection, and merge use runtime GitHub access. Startup first honors `GPT_REPO_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`; when none is set, `npm run connect` and `npm run connect:secure` reuse the authenticated GitHub CLI session through `gh auth token`. The access value is passed only to the MCP child process and is never printed or written to the repository. Run `gh auth login` once if GitHub CLI is not already authenticated. Git push authentication remains separate and uses the host's Git credential manager or SSH agent. Local commits prefer the existing Windows Git identity. When no complete identity is configured, server bootstrap creates an isolated runtime Git home under local application data and uses `GPT_REPO_GIT_AUTHOR_NAME` and `GPT_REPO_GIT_AUTHOR_EMAIL` when supplied, otherwise `GPT Repo MCP <gpt-repo-mcp@local.invalid>`. Repository and global Git configuration are not modified. After changing operation policy or runtime environment variables, restart the MCP server and reconnect the ChatGPT app so the new tool surface and permissions are loaded.

## Common Failure Modes

- `config.local.json` is missing: run `cp config.example.json config.local.json`.
- Unknown `repo_id`: run `npm run list`.
- ChatGPT cannot connect through Secure MCP Tunnel: confirm `npm run connect:secure` is still running, refresh connector metadata, and verify the connector uses Tunnel.
- ChatGPT cannot connect through a public tunnel: confirm the URL is public HTTPS and exactly matches the printed `/t/<token>/mcp` URL.
- Connector URL changed: the local path value persists under the user profile; update or refresh the connector only when the public tunnel host changed or the local file was removed.
- Port `8787` is busy: stop the process using it, then rerun `npm run connect`.
- ngrok endpoint already online: `npm run connect` tries to reuse an existing HTTPS tunnel from the local ngrok API.
- Schema mismatch in ChatGPT: refresh connector metadata, then run `npm test -- tests/tool-contracts.test.ts tests/mcp-contract.test.ts`.
- Write disabled: keep the default read-mostly setup, or explicitly enable `writes.enabled` for a trusted repo.
