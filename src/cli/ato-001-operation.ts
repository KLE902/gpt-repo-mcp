import { randomUUID } from "node:crypto";
import process from "node:process";
import { loadConfig, resolveConfigPath } from "../config/store.js";
import { RepoReaderError, toRepoReaderError } from "../runtime/errors.js";
import { Ato001ClaudeReviewService } from "../services/ato-001-claude-review-service.js";
import { Ato001ClaudeStartService } from "../services/ato-001-claude-start-service.js";
import { ATO001_REPO_ID } from "../services/ato-001-claude-profile.js";
import { OperationsPolicy } from "../services/operations-policy.js";

type Operation = "start" | "review";

async function main(): Promise<void> {
  const operation = parseOperation(process.argv.slice(2));
  const cwd = process.cwd();
  const configPath = resolveConfigPath({ env: process.env, cwd });
  const config = await loadConfig(configPath);
  const repo = config.repos.find((candidate) => candidate.repo_id === ATO001_REPO_ID);
  if (!repo) {
    throw new RepoReaderError("ATO001_REPOSITORY_MISMATCH", `Configured repository ${ATO001_REPO_ID} was not found.`);
  }

  new OperationsPolicy(repo.operations).assertAto001ClaudeAllowed();
  const call = {
    call_id: randomUUID(),
    recorded_at: new Date().toISOString(),
    tool: `repo_run_allowed_script:mcp.ato001.${operation}`
  };

  const result = operation === "start"
    ? await new Ato001ClaudeStartService(repo.root, cwd).start(call)
    : await new Ato001ClaudeReviewService(repo.root).review(call);

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseOperation(args: string[]): Operation {
  if (args.length !== 1 || (args[0] !== "start" && args[0] !== "review")) {
    throw new RepoReaderError("VALIDATION_ERROR", "The fixed ATO-001 operation accepts exactly one server-owned mode: start or review.");
  }
  return args[0];
}

main().catch((error: unknown) => {
  const normalized = toRepoReaderError(error);
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message
    }
  })}\n`);
  process.exitCode = 1;
});
