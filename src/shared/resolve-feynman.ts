import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FeynmanInstallation {
  /** Feynman installation root (contains node/, app/) */
  feynmanRoot: string;
  /** Bundled Node.js binary */
  nodebin: string;
  /** Pi coding agent CLI entry point */
  piCli: string;
  /** Path to Feynman's SYSTEM.md */
  systemPromptPath: string;
  /** Path to Feynman's research-tools extension */
  extensionPath: string;
  /** Path to Feynman's prompt templates directory */
  promptTemplatePath: string;
}

async function fileExists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true).catch(() => false);
}

/**
 * Follow a chain of shell wrapper scripts to find the final target.
 *
 * Feynman uses two levels of shell wrappers:
 *   ~/.local/bin/feynman — exec "/path/to/.local/share/feynman/<ver>/feynman" "$@"
 *   ~/.local/share/feynman/<ver>/feynman — exec "$ROOT/node/bin/node" "$ROOT/app/bin/feynman.js" "$@"
 *
 * We read each script and extract the exec target until we find a non-wrapper.
 */
async function followShellWrappers(scriptPath: string, maxDepth = 5): Promise<string> {
  let current = scriptPath;
  for (let i = 0; i < maxDepth; i++) {
    let content: string;
    try {
      content = await fs.readFile(current, "utf8");
    } catch {
      return current;
    }

    // Match: exec "/absolute/path/to/binary" "$@" or exec '/path' "$@"
    const execMatch = content.match(/exec\s+["']([^"']+)["']\s+["\$]/);
    if (execMatch) {
      const target = execMatch[1];
      if (path.isAbsolute(target) && (await fileExists(target))) {
        current = target;
        continue;
      }
    }

    // Match: exec "$ROOT/node/bin/node" "$ROOT/app/bin/feynman.js" (self-referencing ROOT)
    // This is the final wrapper — ROOT = dirname of current script
    if (content.includes('$ROOT/node/bin/node')) {
      return current;
    }

    return current;
  }
  return current;
}

/**
 * Resolve the Feynman installation root from the feynman binary.
 *
 * Feynman's binary chain:
 *   ~/.local/bin/feynman (shell script) →
 *     exec "~/.local/share/feynman/<version>/feynman" "$@"
 *   ~/.local/share/feynman/<version>/feynman (shell script) →
 *     exec "$ROOT/node/bin/node" "$ROOT/app/bin/feynman.js" "$@"
 *
 * We follow the chain to find $ROOT, then validate the expected paths.
 */
export async function resolveFeynman(
  feynmanCommand = "feynman",
  env?: Record<string, string>,
): Promise<FeynmanInstallation> {
  // Step 1: Find the feynman binary via `which`
  let binaryPath: string;
  try {
    const { stdout } = await execFileAsync("which", [feynmanCommand], {
      env: env ? { ...process.env, ...env } : undefined,
    });
    binaryPath = stdout.trim();
  } catch {
    throw new Error(
      `Feynman CLI not found: "${feynmanCommand}" is not in PATH. Install Feynman: https://feynman.is/docs`,
    );
  }

  if (!binaryPath) {
    throw new Error(
      `Feynman CLI not found: "${feynmanCommand}" is not in PATH. Install Feynman: https://feynman.is/docs`,
    );
  }

  // Step 2: Resolve symlinks first, then follow shell wrapper exec chains
  let realBinary: string;
  try {
    realBinary = await fs.realpath(binaryPath);
  } catch {
    throw new Error(`Cannot resolve Feynman binary path: ${binaryPath}`);
  }

  realBinary = await followShellWrappers(realBinary);

  // Step 3: The final binary is a shell script in the Feynman root directory.
  // ROOT is the directory containing the shell script.
  const feynmanRoot = path.dirname(realBinary);

  // Step 4: Validate the expected file structure
  const nodebin = path.join(feynmanRoot, "node", "bin", "node");
  const piCli = path.join(
    feynmanRoot,
    "app",
    "node_modules",
    "@mariozechner",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  const systemPromptPath = path.join(feynmanRoot, "app", ".feynman", "SYSTEM.md");
  const extensionPath = path.join(feynmanRoot, "app", "extensions", "research-tools.ts");
  const promptTemplatePath = path.join(feynmanRoot, "app", "prompts");

  const checks = await Promise.all([
    fileExists(nodebin).then((ok) => (ok ? null : `Bundled Node.js not found: ${nodebin}`)),
    fileExists(piCli).then((ok) => (ok ? null : `Pi CLI not found: ${piCli}`)),
    fileExists(systemPromptPath).then((ok) =>
      ok ? null : `Feynman system prompt not found: ${systemPromptPath}`,
    ),
    fileExists(extensionPath).then((ok) =>
      ok ? null : `Feynman extension not found: ${extensionPath}`,
    ),
    fileExists(promptTemplatePath).then((ok) =>
      ok ? null : `Feynman prompt templates not found: ${promptTemplatePath}`,
    ),
  ]);

  const errors = checks.filter(Boolean);
  if (errors.length > 0) {
    throw new Error(
      `Feynman installation at ${feynmanRoot} is incomplete:\n${errors.join("\n")}`,
    );
  }

  return {
    feynmanRoot,
    nodebin,
    piCli,
    systemPromptPath,
    extensionPath,
    promptTemplatePath,
  };
}
