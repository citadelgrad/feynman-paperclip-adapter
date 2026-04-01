import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import { asString, runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import { resolveFeynman } from "../shared/resolve-feynman.js";

const MODELS_CACHE_TTL_MS = 60_000;

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function parseModelsOutput(stdout: string): AdapterModel[] {
  const parsed: AdapterModel[] = [];
  const lines = stdout.split(/\r?\n/);

  let startIndex = 0;
  if (lines.length > 0 && (lines[0].includes("provider") || lines[0].includes("model"))) {
    startIndex = 1;
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/\s{2,}/);
    if (parts.length < 2) continue;

    const provider = parts[0].trim();
    const model = parts[1].trim();

    if (!provider || !model) continue;
    if (provider === "provider" && model === "model") continue;

    const id = `${provider}/${model}`;
    parsed.push({ id, label: id });
  }

  return parsed;
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function sortModels(models: AdapterModel[]): AdapterModel[] {
  return [...models].sort((a, b) =>
    a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }),
  );
}

function normalizeEnv(input: unknown): Record<string, string> {
  const envInput =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envInput)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

const discoveryCache = new Map<string, { expiresAt: number; models: AdapterModel[] }>();
const VOLATILE_ENV_KEY_PREFIXES = ["PAPERCLIP_", "npm_", "NPM_"] as const;
const VOLATILE_ENV_KEY_EXACT = new Set(["PWD", "OLDPWD", "SHLVL", "_", "TERM_SESSION_ID"]);

function isVolatileEnvKey(key: string): boolean {
  if (VOLATILE_ENV_KEY_EXACT.has(key)) return true;
  return VOLATILE_ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryCacheKey(command: string, cwd: string, env: Record<string, string>) {
  const envKey = Object.entries(env)
    .filter(([key]) => !isVolatileEnvKey(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${hashValue(value)}`)
    .join("\n");
  return `feynman:${command}\n${cwd}\n${envKey}`;
}

function pruneExpiredDiscoveryCache(now: number) {
  for (const [key, value] of discoveryCache.entries()) {
    if (value.expiresAt <= now) discoveryCache.delete(key);
  }
}

/**
 * Build the Feynman-specific environment for Pi model discovery.
 * Sets PI_CODING_AGENT_DIR so Pi uses Feynman's auth/settings.
 */
function buildFeynmanModelEnv(extraEnv: Record<string, string>): Record<string, string> {
  return {
    ...extraEnv,
    PI_CODING_AGENT_DIR: path.join(os.homedir(), ".feynman", "agent"),
    PI_SKIP_VERSION_CHECK: "1",
  };
}

export async function discoverFeynmanModels(input: {
  feynmanCommand?: string;
  cwd?: unknown;
  env?: unknown;
} = {}): Promise<AdapterModel[]> {
  const feynmanCommand = input.feynmanCommand ?? "feynman";
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);

  // Resolve the Feynman installation to get the Pi CLI path
  const installation = await resolveFeynman(feynmanCommand, env);
  const feynmanEnv = buildFeynmanModelEnv(env);
  const runtimeEnv = normalizeEnv({ ...process.env, ...feynmanEnv });

  const result = await runChildProcess(
    `feynman-models-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    installation.nodebin,
    [installation.piCli, "--list-models"],
    {
      cwd,
      env: runtimeEnv,
      timeoutSec: 20,
      graceSec: 3,
      onLog: async () => {},
    },
  );

  if (result.timedOut) {
    throw new Error("Feynman model discovery timed out.");
  }
  if ((result.exitCode ?? 1) !== 0) {
    const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout);
    throw new Error(detail ? `Feynman model discovery failed: ${detail}` : "Feynman model discovery failed.");
  }

  // Pi's --list-models may output to terminal only (not stdout when piped).
  // Try stdout first, then fall back to stderr.
  const combined = result.stdout || result.stderr;
  return sortModels(dedupeModels(parseModelsOutput(combined)));
}

export async function discoverFeynmanModelsCached(input: {
  feynmanCommand?: string;
  cwd?: unknown;
  env?: unknown;
} = {}): Promise<AdapterModel[]> {
  const feynmanCommand = input.feynmanCommand ?? "feynman";
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);
  const key = discoveryCacheKey(feynmanCommand, cwd, env);
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.models;

  const models = await discoverFeynmanModels({ feynmanCommand, cwd, env });
  discoveryCache.set(key, { expiresAt: now + MODELS_CACHE_TTL_MS, models });
  return models;
}

export async function ensureFeynmanModelConfiguredAndAvailable(input: {
  model?: unknown;
  feynmanCommand?: string;
  cwd?: unknown;
  env?: unknown;
}): Promise<AdapterModel[]> {
  const model = asString(input.model, "").trim();
  if (!model) {
    throw new Error("Feynman requires `adapterConfig.model` in provider/model format.");
  }

  const models = await discoverFeynmanModelsCached({
    feynmanCommand: input.feynmanCommand,
    cwd: input.cwd,
    env: input.env,
  });

  if (models.length === 0) {
    // Pi's --list-models may not produce parseable output when not connected to a TTY.
    // Accept the configured model on trust when discovery returns empty.
    return [];
  }

  if (!models.some((entry) => entry.id === model)) {
    const sample = models.slice(0, 12).map((entry) => entry.id).join(", ");
    throw new Error(
      `Configured model is unavailable: ${model}. Available models: ${sample}${models.length > 12 ? ", ..." : ""}`,
    );
  }

  return models;
}

export async function listFeynmanModels(): Promise<AdapterModel[]> {
  try {
    return await discoverFeynmanModelsCached();
  } catch {
    return [];
  }
}

export function resetFeynmanModelsCacheForTests() {
  discoveryCache.clear();
}
