import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function resolvePublicPathTokenFile(env = process.env, homeDirectory = homedir()) {
  const configuredPath = env.GPT_REPO_PUBLIC_PATH_TOKEN_FILE?.trim();
  return configuredPath || join(homeDirectory, ".gpt-repo-mcp", "public-path-token");
}

export function normalizePublicPathToken(value, source) {
  const segment = value.trim();
  if (!PATH_SEGMENT_PATTERN.test(segment)) {
    throw new Error(
      `Invalid MCP public path value in ${source}. Expected 32-128 URL-safe letters, digits, underscores, or hyphens.`
    );
  }
  return segment;
}

export async function loadOrCreatePublicPathToken(options = {}) {
  const env = options.env ?? process.env;
  const explicitPathSegment = env.GPT_REPO_PUBLIC_PATH_TOKEN ?? env.REPO_READER_PUBLIC_PATH_TOKEN;

  if (explicitPathSegment?.trim()) {
    return {
      value: normalizePublicPathToken(explicitPathSegment, "the environment"),
      source: "environment"
    };
  }

  const homeDirectory = options.homeDirectory ?? homedir();
  const localFile = resolvePublicPathTokenFile(env, homeDirectory);
  const readFileImpl = options.readFileImpl ?? readFile;
  const mkdirImpl = options.mkdirImpl ?? mkdir;
  const writeFileImpl = options.writeFileImpl ?? writeFile;
  const randomBytesImpl = options.randomBytesImpl ?? randomBytes;

  try {
    const existing = await readFileImpl(localFile, "utf8");
    return {
      value: normalizePublicPathToken(existing, localFile),
      source: "file",
      localFile
    };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const generated = normalizePublicPathToken(randomBytesImpl(16).toString("hex"), "generated value");
  await mkdirImpl(dirname(localFile), { recursive: true });

  try {
    await writeFileImpl(localFile, `${generated}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    return {
      value: generated,
      source: "created",
      localFile
    };
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const existing = await readFileImpl(localFile, "utf8");
    return {
      value: normalizePublicPathToken(existing, localFile),
      source: "file",
      localFile
    };
  }
}
