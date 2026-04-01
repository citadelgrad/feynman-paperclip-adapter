export const type = "feynman_local";
export const label = "Feynman (local)";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# feynman_local agent configuration

Adapter: feynman_local

Use when:
- You want Paperclip to run Feynman (the AI research agent) locally
- You want Feynman's research capabilities: deep research, literature review, paper audit, replication
- You want Feynman's bundled skills, subagents (researcher, reviewer, writer, verifier), and extensions
- You want provider/model routing in Pi format (provider/model)

Don't use when:
- You need a general-purpose coding agent (use claude_local, pi_local, or codex_local)
- Feynman CLI is not installed on the machine
- You only need one-shot shell commands (use process)

Core fields:
- model (string, required): Pi model id in provider/model format (for example anthropic/claude-opus-4-6)
- cwd (string, optional): default absolute working directory for the agent process
- thinking (string, optional): thinking level (off, minimal, low, medium, high, xhigh)
- feynmanCommand (string, optional): path to feynman binary, defaults to "feynman"
- instructionsFilePath (string, optional): absolute path to a markdown instructions file appended to system prompt
- promptTemplate (string, optional): Paperclip task prompt template
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Feynman is built on the Pi coding agent runtime. Models are the same as \`pi --list-models\`.
- The adapter resolves the Feynman installation, loads its system prompt, extensions, and prompt templates.
- Sessions are stored in ~/.feynman/paperclips/ and resumed across heartbeats.
- Feynman's research tools (alpha_search, alpha_get_paper, etc.) are loaded via its extension.
- Feynman's subagents (researcher, reviewer, writer, verifier) and skills are synced at startup.
`;
