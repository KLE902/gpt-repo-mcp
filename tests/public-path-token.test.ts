import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const helperUrl = pathToFileURL(join(process.cwd(), "scripts", "public-path-token.mjs")).href;

describe("stable public path value", () => {
  test("creates the value once outside the repository and reuses it", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "gpt-repo-path-home-"));
    const result = await runModule(`
      import { loadOrCreatePublicPathToken } from ${JSON.stringify(helperUrl)};
      const homeDirectory = ${JSON.stringify(homeDirectory)};
      const first = await loadOrCreatePublicPathToken({ env: {}, homeDirectory });
      const second = await loadOrCreatePublicPathToken({ env: {}, homeDirectory });
      console.log(JSON.stringify({ first, second, same: first.value === second.value }));
    `);

    const parsed = JSON.parse(result.stdout) as {
      first: { value: string; source: string; localFile: string };
      second: { value: string; source: string; localFile: string };
      same: boolean;
    };

    expect(parsed.first.source).toBe("created");
    expect(parsed.second.source).toBe("file");
    expect(parsed.same).toBe(true);
    expect(parsed.first.value).toMatch(/^[a-f0-9]{32}$/);
    expect(parsed.first.localFile).toBe(join(homeDirectory, ".gpt-repo-mcp", "public-path-token"));
    await expect(readFile(parsed.first.localFile, "utf8")).resolves.toBe(`${parsed.first.value}\n`);
  });

  test("keeps an explicit MCP path value separate from persisted storage", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "gpt-repo-path-env-"));
    const expectedPathSegment = "0123456789abcdef0123456789abcdef";
    const result = await runModule(`
      import { loadOrCreatePublicPathToken } from ${JSON.stringify(helperUrl)};
      const value = await loadOrCreatePublicPathToken({
        env: { GPT_REPO_PUBLIC_PATH_TOKEN: ${JSON.stringify(expectedPathSegment)} },
        homeDirectory: ${JSON.stringify(homeDirectory)}
      });
      console.log(JSON.stringify(value));
    `);

    expect(JSON.parse(result.stdout)).toEqual({ value: expectedPathSegment, source: "environment" });
  });
});

function runModule(source: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr });
    });
  });
}
