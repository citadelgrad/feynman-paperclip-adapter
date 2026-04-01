# Upstream issue draft: `@kaiserlich-dev/pi-session-search` package appears incomplete

Summary
- `@kaiserlich-dev/pi-session-search@1.1.1` installs, but the runtime extension fails to load because files referenced by `extensions/index.ts` are missing from the published package.

Environment
- macOS
- Feynman 0.2.16
- Feynman bundled Node: v24.14.0
- Paperclip + Feynman local adapter integration

Observed error
```text
Failed to load extension "/opt/homebrew/lib/node_modules/@kaiserlich-dev/pi-session-search/extensions/index.ts": Failed to load extension: Cannot find module './types'
Require stack:
- /opt/homebrew/lib/node_modules/@kaiserlich-dev/pi-session-search/extensions/index.ts
```

Package inspected
- Installed path: `/opt/homebrew/lib/node_modules/@kaiserlich-dev/pi-session-search`
- Present files include:
  - `extensions/index.ts`
  - `extensions/component.ts`
  - `extensions/indexer.ts`
  - `extensions/screens/preview.ts`
- Missing files referenced by imports include:
  - `extensions/types.ts`
  - `extensions/summarizer.ts`
  - `extensions/resume.ts`
  - `extensions/screens/search.ts`
  - `extensions/screens/prompt-input.ts`
  - `extensions/lib/render-helpers.ts`

Additional notes
- This initially looked like a `better-sqlite3` dependency issue, but after installing/rebuilding dependencies with Feynman's bundled npm/node, the package still fails because the local source files above are absent.
- `@samfp/pi-memory` was repairable with a local `better-sqlite3` rebuild, but `pi-session-search` remains broken due to missing package contents.

Suggested maintainer checks
1. Verify the npm published tarball contains all files imported by `extensions/index.ts`, `extensions/component.ts`, and `extensions/screens/preview.ts`.
2. Check the package `files` field / publish pipeline so all required extension files are included.
3. Consider publishing compiled/runtime-complete extension assets instead of a partial TS tree.

Local workaround
- Disable `npm:@kaiserlich-dev/pi-session-search` in `~/.feynman/agent/settings.json` until a fixed package is published.
