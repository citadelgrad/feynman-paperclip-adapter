# feynman-paperclip-adapter

A [Paperclip](https://paperclip.ing) adapter for the [Feynman](https://feynman.is) AI research agent.

## What This Does

This adapter lets Paperclip orchestrate Feynman as an agent employee. When Paperclip wakes the agent (on a heartbeat, task assignment, or comment), the adapter:

1. Resolves the local Feynman installation
2. Loads Feynman's system prompt, research extensions, prompt templates, and skills
3. Spawns Pi (Feynman's underlying runtime) in RPC mode with Feynman's full configuration
4. Streams JSONL events back to Paperclip for the dashboard transcript
5. Persists sessions across heartbeats for multi-turn research workflows

## Relationship to `pi_local`

Feynman is built on the [Pi coding agent](https://github.com/badlogic/pi-mono) runtime. Paperclip already has a generic `pi_local` adapter that runs Pi directly. **This adapter exists because Feynman is more than Pi** -- it adds:

- A research-focused system prompt (`SYSTEM.md`) with "evidence over fluency" philosophy
- Research tools via its extension (`alpha_search`, `alpha_get_paper`, `alpha_ask_paper`, etc.)
- 11 workflow prompt templates (deep research, literature review, paper audit, replication, etc.)
- 4 specialized subagents (researcher, reviewer, writer, verifier)
- 20+ bundled skills for academic research workflows
- 14 Pi packages pre-configured (subagents, web access, charts, Zotero, memory, etc.)

Using `pi_local` directly would run a plain Pi agent without any of Feynman's research identity. This adapter spawns Pi with all of Feynman's configuration so the agent retains its full research capabilities.

### Key Differences from `pi_local`

| Aspect | `pi_local` | `feynman_local` |
|--------|-----------|-----------------|
| Command | `pi` binary | Feynman's bundled `node` + Pi CLI |
| System prompt | Pi default only | Feynman's `SYSTEM.md` + Paperclip extension |
| Extensions | None | Feynman's research-tools (AlphaXiv integration) |
| Prompt templates | None | 11 research workflow templates |
| Skills directory | `~/.pi/agent/skills/` | `~/.feynman/agent/skills/` |
| Sessions directory | `~/.pi/paperclips/` | `~/.feynman/paperclips/` |
| Agent config dir | `~/.pi/agent/` | `~/.feynman/agent/` |
| Model auth | Pi's auth config | Feynman's auth config (`~/.feynman/agent/auth.json`) |

The JSONL protocol, session format, and output parsing are identical since both use Pi's RPC mode.

## Prerequisites

- [Feynman CLI](https://feynman.is/docs/getting-started/quickstart) installed and configured
- At least one LLM provider authenticated via `feynman setup`
- [Paperclip](https://paperclip.ing) runtime running locally

## Configuration

Register the adapter as `feynman_local` in your Paperclip instance. The agent's `adapterConfig` accepts:

### Required

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Pi model ID in `provider/model` format (e.g., `anthropic/claude-opus-4-6`) |

### Optional

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cwd` | string | process.cwd() | Working directory for the agent |
| `thinking` | string | - | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `feynmanCommand` | string | `"feynman"` | Path to the Feynman binary |
| `instructionsFilePath` | string | - | Path to a markdown file appended to the system prompt |
| `promptTemplate` | string | *(built-in)* | Mustache-like template for the task prompt |
| `env` | object | - | Additional `KEY=VALUE` environment variables |
| `timeoutSec` | number | 0 (no limit) | Run timeout in seconds |
| `graceSec` | number | 20 | SIGTERM grace period in seconds |

### Example

```json
{
  "adapterType": "feynman_local",
  "adapterConfig": {
    "model": "anthropic/claude-opus-4-6",
    "cwd": "/path/to/research/workspace",
    "thinking": "high"
  }
}
```

### Available Models

List available models:

```sh
feynman model list
```

Or equivalently (with Feynman's auth):

```sh
PI_CODING_AGENT_DIR=~/.feynman/agent pi --list-models
```

## How It Works

### Installation Resolution

The adapter follows Feynman's binary chain to locate the installation:

```
~/.local/bin/feynman (symlink)
  -> ~/.local/share/feynman/<version>/feynman (shell script)
    -> $ROOT/node/bin/node $ROOT/app/bin/feynman.js
```

It extracts `$ROOT` and validates the expected structure:
- `$ROOT/node/bin/node` -- bundled Node.js
- `$ROOT/app/node_modules/@mariozechner/pi-coding-agent/dist/cli.js` -- Pi CLI
- `$ROOT/app/.feynman/SYSTEM.md` -- system prompt
- `$ROOT/app/extensions/research-tools.ts` -- extension
- `$ROOT/app/prompts/` -- prompt templates

### Execution

The adapter spawns Pi directly (not the `feynman` binary, which doesn't support `--mode rpc`):

```sh
$ROOT/node/bin/node \
  $ROOT/app/node_modules/@mariozechner/pi-coding-agent/dist/cli.js \
  --mode rpc \
  --extension $ROOT/app/extensions/research-tools.ts \
  --prompt-template $ROOT/app/prompts/ \
  --append-system-prompt "<Paperclip context>" \
  --provider <provider> --model <model> --thinking <level> \
  --session <session-file> \
  --tools read,bash,edit,write,grep,find,ls
```

With environment:
```
PI_CODING_AGENT_DIR=~/.feynman/agent/
FEYNMAN_SESSION_DIR=~/.feynman/sessions/
FEYNMAN_MEMORY_DIR=~/.feynman/memory/
PI_SKIP_VERSION_CHECK=1
PAPERCLIP_AGENT_ID=<agent-id>
PAPERCLIP_COMPANY_ID=<company-id>
PAPERCLIP_RUN_ID=<run-id>
PAPERCLIP_API_KEY=<token>
```

### Session Continuity

Sessions are stored in `~/.feynman/paperclips/` as JSONL files. When Paperclip resumes a heartbeat, the adapter passes the previous session file to Pi via `--session`, allowing multi-turn research workflows to continue where they left off.

## Package Exports

The adapter follows Paperclip's standard four-export-path convention:

| Export | Purpose |
|--------|---------|
| `.` | Root metadata: `type`, `label`, `models`, `agentConfigurationDoc` |
| `./server` | Server-side: `execute`, `testEnvironment`, `sessionCodec`, model discovery |
| `./ui` | Dashboard: `parseFeynmanStdoutLine`, `buildFeynmanLocalConfig` |
| `./cli` | Terminal: `printFeynmanStreamEvent` |

## Development

```sh
npm install
npm run typecheck
npm run build
```

## License

MIT
