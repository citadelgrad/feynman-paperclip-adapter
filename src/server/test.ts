import os from "node:os";
import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  parseObject,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  runChildProcess,
  asStringArray,
} from "@paperclipai/adapter-utils/server-utils";
import { discoverFeynmanModelsCached } from "./models.js";
import { parsePiJsonl } from "./parse.js";
import { resolveFeynman } from "../shared/resolve-feynman.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function summarizeProbeDetail(
  stdout: string,
  stderr: string,
  parsedError: string | null,
): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function normalizeEnv(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

const AUTH_REQUIRED_RE =
  /(?:auth(?:entication)?\s+required|api\s*key|invalid\s*api\s*key|not\s+logged\s+in|free\s+usage\s+exceeded)/i;

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const feynmanCommand = asString(config.feynmanCommand, "feynman");
  const cwd = asString(config.cwd, process.cwd());

  // Check working directory
  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: false });
    checks.push({
      code: "feynman_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "feynman_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  // Add Feynman-specific env
  env.PI_CODING_AGENT_DIR = path.join(os.homedir(), ".feynman", "agent");
  env.PI_SKIP_VERSION_CHECK = "1";
  const runtimeEnv = normalizeEnv(ensurePathInEnv({ ...process.env, ...env }));

  // Check Feynman installation
  const cwdInvalid = checks.some((check) => check.code === "feynman_cwd_invalid");
  let installation: Awaited<ReturnType<typeof resolveFeynman>> | null = null;

  if (!cwdInvalid) {
    try {
      installation = await resolveFeynman(feynmanCommand, env);
      checks.push({
        code: "feynman_installation_found",
        level: "info",
        message: `Feynman installation found at ${installation.feynmanRoot}`,
      });
      checks.push({
        code: "feynman_pi_resolvable",
        level: "info",
        message: `Pi CLI resolvable at ${installation.piCli}`,
      });
    } catch (err) {
      checks.push({
        code: "feynman_installation_not_found",
        level: "error",
        message: err instanceof Error ? err.message : "Feynman installation not found",
        hint: "Install Feynman: https://feynman.is/docs/getting-started/quickstart",
      });
    }
  } else {
    checks.push({
      code: "feynman_installation_skipped",
      level: "warn",
      message: "Skipped Feynman check because working directory validation failed.",
    });
  }

  const canRunProbe = installation !== null;

  // Discover models
  if (canRunProbe) {
    try {
      const discovered = await discoverFeynmanModelsCached({
        feynmanCommand,
        cwd,
        env: runtimeEnv,
      });
      if (discovered.length > 0) {
        checks.push({
          code: "feynman_models_discovered",
          level: "info",
          message: `Discovered ${discovered.length} model(s) via Feynman.`,
        });
      } else {
        checks.push({
          code: "feynman_models_empty",
          level: "warn",
          message: "Feynman returned no models.",
          hint: "Run `feynman model list` and verify provider authentication.",
        });
      }
    } catch (err) {
      checks.push({
        code: "feynman_models_discovery_failed",
        level: "warn",
        message: err instanceof Error ? err.message : "Feynman model discovery failed.",
        hint: "Run `feynman model list` manually to verify provider auth and config.",
      });
    }
  }

  // Check configured model
  const configuredModel = asString(config.model, "").trim();
  if (!configuredModel) {
    checks.push({
      code: "feynman_model_required",
      level: "error",
      message: "Feynman requires a configured model in provider/model format.",
      hint: "Set adapterConfig.model using an ID from `feynman model list`.",
    });
  } else if (canRunProbe) {
    try {
      const discovered = await discoverFeynmanModelsCached({
        feynmanCommand,
        cwd,
        env: runtimeEnv,
      });
      const modelExists = discovered.some((m: { id: string }) => m.id === configuredModel);
      if (modelExists) {
        checks.push({
          code: "feynman_model_configured",
          level: "info",
          message: `Configured model: ${configuredModel}`,
        });
      } else {
        checks.push({
          code: "feynman_model_not_found",
          level: "warn",
          message: `Configured model "${configuredModel}" not found in available models.`,
          hint: "Run `feynman model list` and choose a currently available provider/model ID.",
        });
      }
    } catch {
      checks.push({
        code: "feynman_model_configured",
        level: "info",
        message: `Configured model: ${configuredModel}`,
      });
    }
  }

  // Hello probe
  if (canRunProbe && installation && configuredModel) {
    const provider = configuredModel.includes("/")
      ? configuredModel.slice(0, configuredModel.indexOf("/"))
      : "";
    const modelId = configuredModel.includes("/")
      ? configuredModel.slice(configuredModel.indexOf("/") + 1)
      : configuredModel;
    const thinking = asString(config.thinking, "").trim();
    const extraArgs = (() => {
      const fromExtraArgs = asStringArray(config.extraArgs);
      if (fromExtraArgs.length > 0) return fromExtraArgs;
      return asStringArray(config.args);
    })();

    // Run hello probe via Pi with Feynman's environment
    const args = [installation.piCli, "-p", "Respond with hello.", "--mode", "json"];
    if (provider) args.push("--provider", provider);
    if (modelId) args.push("--model", modelId);
    if (thinking) args.push("--thinking", thinking);
    args.push("--tools", "read");
    if (extraArgs.length > 0) args.push(...extraArgs);

    try {
      const probe = await runChildProcess(
        `feynman-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        installation.nodebin,
        args,
        {
          cwd,
          env: runtimeEnv,
          timeoutSec: 60,
          graceSec: 5,
          onLog: async () => {},
        },
      );

      const parsed = parsePiJsonl(probe.stdout);
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errors[0] ?? null);
      const authEvidence = `${parsed.errors.join("\n")}\n${probe.stdout}\n${probe.stderr}`.trim();

      if (probe.timedOut) {
        checks.push({
          code: "feynman_hello_probe_timed_out",
          level: "warn",
          message: "Feynman hello probe timed out.",
          hint: "Retry the probe. If this persists, run Feynman manually in this working directory.",
        });
      } else if ((probe.exitCode ?? 1) === 0 && parsed.errors.length === 0) {
        const summary = (parsed.finalMessage || parsed.messages.join(" ")).trim();
        const hasHello = /\bhello\b/i.test(summary);
        checks.push({
          code: hasHello ? "feynman_hello_probe_passed" : "feynman_hello_probe_unexpected_output",
          level: hasHello ? "info" : "warn",
          message: hasHello
            ? "Feynman hello probe succeeded."
            : "Feynman probe ran but did not return `hello` as expected.",
          ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
          ...(hasHello
            ? {}
            : {
                hint: "Run Feynman manually and prompt `Respond with hello` to inspect output.",
              }),
        });
      } else if (AUTH_REQUIRED_RE.test(authEvidence)) {
        checks.push({
          code: "feynman_hello_probe_auth_required",
          level: "warn",
          message: "Feynman is installed, but provider authentication is not ready.",
          ...(detail ? { detail } : {}),
          hint: "Run `feynman setup` to configure provider auth, or set API key environment variables.",
        });
      } else {
        checks.push({
          code: "feynman_hello_probe_failed",
          level: "error",
          message: "Feynman hello probe failed.",
          ...(detail ? { detail } : {}),
          hint: "Run `feynman doctor` to diagnose issues.",
        });
      }
    } catch (err) {
      checks.push({
        code: "feynman_hello_probe_failed",
        level: "error",
        message: "Feynman hello probe failed.",
        detail: err instanceof Error ? err.message : String(err),
        hint: "Run `feynman doctor` to diagnose issues.",
      });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
