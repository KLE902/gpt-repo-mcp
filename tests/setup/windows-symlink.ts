import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const fsPromises = require("node:fs/promises") as {
  symlink: typeof import("node:fs/promises").symlink;
};

if (process.platform === "win32") {
  const nativeSymlink = fsPromises.symlink;
  fsPromises.symlink = ((target, path, type) => {
    return nativeSymlink(target, path, type ?? "junction");
  }) as typeof nativeSymlink;
  syncBuiltinESMExports();

  const gitHome = mkdtempSync(join(tmpdir(), "gpt-repo-mcp-git-home-"));
  const gitConfig = "[core]\n\tautocrlf = false\n";
  mkdirSync(join(gitHome, "git"), { recursive: true });
  writeFileSync(join(gitHome, ".gitconfig"), gitConfig, "utf8");
  writeFileSync(join(gitHome, "git", "config"), gitConfig, "utf8");
  process.env.HOME = gitHome;
  process.env.XDG_CONFIG_HOME = gitHome;
}
