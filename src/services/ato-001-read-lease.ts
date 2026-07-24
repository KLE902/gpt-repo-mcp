import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { RepoReaderError } from "../runtime/errors.js";
import { ATO001_ARTIFACT_PATHS, ATO001_REPO_ID, ATO001_RUN_ID } from "./ato-001-claude-profile.js";

const GatePath = ".chatgpt/ato-001-claude-spike/.mcp-mutation-gate";
const LeaseSchema = z.object({
  schema_version: z.literal(1),
  repo_id: z.literal(ATO001_REPO_ID),
  run_id: z.literal(ATO001_RUN_ID),
  acquired_at: z.string().datetime({ offset: true }),
  purpose: z.literal("persistent_live_worktree_read_lease")
}).strict();

export class Ato001ReadLease {
  constructor(private readonly repoRoot: string) {}

  async withMutationGuard<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireGate();
    try {
      await this.assertMutationAllowed();
      return await operation();
    } finally {
      await this.releaseGate();
    }
  }

  async acquireForStart(now: Date, start: () => Promise<void>): Promise<void> {
    await this.acquireGate();
    try {
      await this.assertMutationAllowed();
      await start();
      const leasePath = this.absolute(ATO001_ARTIFACT_PATHS.lease);
      await mkdir(dirname(leasePath), { recursive: true });
      await writeFile(leasePath, `${JSON.stringify({
        schema_version: 1,
        repo_id: ATO001_REPO_ID,
        run_id: ATO001_RUN_ID,
        acquired_at: now.toISOString(),
        purpose: "persistent_live_worktree_read_lease"
      }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new RepoReaderError("ATO001_READ_LEASE_ACTIVE", "The fixed ATO-001 PKR read lease is already active.");
      }
      throw error;
    } finally {
      await this.releaseGate();
    }
  }

  async releaseAfterTerminalReview(): Promise<void> {
    await this.acquireGate();
    try {
      await this.readRequired();
      await rm(this.absolute(ATO001_ARTIFACT_PATHS.lease), { force: false });
    } finally {
      await this.releaseGate();
    }
  }

  async isActive(): Promise<boolean> {
    try {
      await this.readRequired();
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  private async assertMutationAllowed(): Promise<void> {
    try {
      const lease = await this.readRequired();
      throw new RepoReaderError(
        "ATO001_READ_LEASE_ACTIVE",
        `Known MCP mutations against ${lease.repo_id} are blocked until terminal ATO-001 review releases the live-worktree read lease.`
      );
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  private async readRequired(): Promise<z.infer<typeof LeaseSchema>> {
    try {
      return LeaseSchema.parse(JSON.parse(await readFile(this.absolute(ATO001_ARTIFACT_PATHS.lease), "utf8")));
    } catch (error) {
      if (isNotFound(error)) throw error;
      if (error instanceof RepoReaderError) throw error;
      throw new RepoReaderError("ATO001_READ_LEASE_INVALID", "The ATO-001 read lease is malformed; MCP mutations remain blocked fail-closed.");
    }
  }

  private async acquireGate(): Promise<void> {
    const path = this.absolute(GatePath);
    await mkdir(dirname(path), { recursive: true });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const handle = await open(path, "wx");
        await handle.close();
        return;
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
    }
    throw new RepoReaderError("ATO001_MUTATION_GATE_BUSY", "The PKR MCP mutation gate did not become available within five seconds.");
  }

  private async releaseGate(): Promise<void> {
    await rm(this.absolute(GatePath), { force: true });
  }

  private absolute(relativePath: string): string {
    return join(this.repoRoot, ...relativePath.split("/"));
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
