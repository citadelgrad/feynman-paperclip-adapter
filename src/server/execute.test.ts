import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test, expect } from "vitest";
import { _buildArgs, inferCwdFromInstructionsFilePath } from "./execute.js";

describe("buildArgs", () => {
  const installation = {
    feynmanRoot: "/fake/feynman",
    nodebin: "/fake/feynman/node/bin/node",
    piCli: "/fake/feynman/app/node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
    systemPromptPath: "/fake/feynman/app/.feynman/SYSTEM.md",
    extensionPath: "/fake/feynman/app/extensions/research-tools.ts",
    promptTemplatePath: "/fake/feynman/app/prompts",
  };

  test("uses json mode with -p flag instead of rpc mode", () => {
    const args = _buildArgs({
      installation,
      sessionFile: "/tmp/session.jsonl",
      systemPromptExtension: "You are a test agent.",
      userPrompt: "Say hello.",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      thinking: "",
      extraArgs: [],
    });

    expect(args).toContain("--mode");
    const modeIndex = args.indexOf("--mode");
    expect(args[modeIndex + 1]).toBe("json");
    expect(args).not.toContain("rpc");

    // User prompt passed via -p flag, not stdin
    expect(args).toContain("-p");
    const pIndex = args.indexOf("-p");
    expect(args[pIndex + 1]).toBe("Say hello.");
  });

  test("does not require stdin for prompt delivery", () => {
    const args = _buildArgs({
      installation,
      sessionFile: "/tmp/session.jsonl",
      systemPromptExtension: "Test.",
      userPrompt: "Hello.",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      thinking: "",
      extraArgs: [],
    });

    // Verify the args contain the prompt inline
    expect(args).toContain("-p");
    expect(args).toContain("Hello.");
  });

  test("infers repo cwd from an instructions file in a sibling agents directory", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "feynman-adapter-"));
    const workspaceRoot = path.join(tempRoot, "workspace");
    const repoRoot = path.join(workspaceRoot, "app");
    const agentDir = path.join(workspaceRoot, "agents", "feynman");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(repoRoot, { recursive: true });
    await fs.writeFile(path.join(repoRoot, ".git"), "");
    const instructionsPath = path.join(agentDir, "AGENTS.md");
    await fs.writeFile(instructionsPath, "# Test instructions\n");

    await expect(inferCwdFromInstructionsFilePath(instructionsPath)).resolves.toBe(repoRoot);
  });
});
