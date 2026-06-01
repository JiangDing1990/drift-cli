# codeferry — Project Guide for Claude

## Project Overview

codeferry is a **bidirectional sync CLI** between Claude Design (JSX prototypes) and Claude Code (production code). It never modifies source files directly — it generates context-rich Markdown prompts that the user pastes into Claude Code or Claude Design.

**Key constraint:** The tool is framework-agnostic. Core logic (scanner, extractor, differ, mapper) must never hardcode framework-specific knowledge. Framework hints go in `codeferry.config.json → project.designToCodeHints` only.

---

## Repository Layout

```
src/
├── commands/        CLI command entry points (thin wrappers, delegate to core/)
│   └── watch.ts       Continuous file watcher — reloads registry/snapshot from disk
│                      before each scan; dirty-flag pattern prevents dropped events
├── core/            Pure business logic (no I/O side effects in tests)
│   ├── extractor.ts   JSX component boundary extraction (brace-depth counting)
│   ├── scanner.ts     File system scan + SHA-256 hashing
│   ├── mapper.ts      Design→code file mapping (filename + export-name strategies)
│   ├── differ.ts      Three-way diff engine (baseline vs design-current vs code-current)
│   ├── analyzer.ts    Claude API semantic analysis (batched, exponential backoff)
│   └── stack-detector.ts   Tech stack auto-detection from package.json / config files
├── output/
│   ├── reporter.ts    Terminal UI (chalk, ora, cli-table3)
│   └── prompt-builder.ts  Markdown prompt generation for both sync directions
├── state/
│   ├── store.ts           .codeferry/ directory management — ALL file I/O goes here
│   │                      Uses atomic write pattern: write to .tmp → fs.rename()
│   ├── workspace.ts       WorkspaceManager — workspace lifecycle (create/list/remove/migrate)
│   └── resolve-store.ts   Shared helper: resolves active workspace → StateStore
├── types/index.ts     All shared TypeScript types (single source of truth)
└── utils/             hash.ts · path.ts · logger.ts · content-reader.ts
templates/           User-copyable GitHub Actions workflow templates
tests/               Vitest unit tests (9 files, 115 tests)
docs/                ARCHITECTURE.md · USAGE.md · USAGE.zh-CN.md
```

---

## Development Commands

```bash
pnpm run build       # tsup: src/ → dist/ (ESM, dts, sourcemap)
pnpm run dev         # tsup --watch
pnpm run test        # vitest (watch mode)
pnpm run test:run    # vitest run (single pass) — use this before committing
pnpm run lint        # tsc --noEmit (zero errors expected)

# Local testing
npm link             # makes `codeferry` available globally
codeferry --version      # verify link works
```

**Before every commit:** `pnpm run lint && node_modules/.bin/vitest run`

---

## Core Architectural Rules

### 1. StateStore is the only workspace-level I/O layer
All reads/writes to a workspace's data (config, registry, queue, snapshots) must go through `StateStore` (`src/state/store.ts`). Global state (state.json) is managed by `WorkspaceManager`. Command files must use `resolveStore()` rather than constructing `StateStore` directly.

### 2. Atomic writes — always
`writeJson` uses `tmp → rename()`. Never write config/registry/queue directly with `writeFile` (data corruption on crash).

### 3. ENOENT ≠ parse error in `readJson`
`readJson` must distinguish "file not found" (return `null`) from "corrupted JSON" (throw descriptive error). Do not collapse both to `null`.

### 4. Three-way diff semantics
```
designHash ≠ designHashAtSync  → design side changed
codeHash   ≠ codeHashAtSync    → code side changed
both changed                   → 'both-changed' (conflict)
```
`designHashAtSync` / `codeHashAtSync` are `null` for never-synced components → status is `'never-synced'`.

### 5. Component ID format
`<relative-design-file>::<ComponentName>` — stable, human-readable, used as keys in registry.json and queue.json.

### 6. StackInfo persistence
`detectStack()` computes `designToCodeHints` / `codeToDesignHints`. These must be:
- Persisted to `codeferry.config.json → project.designToCodeHints/codeToDesignHints` during `codeferry init`
- Read back from config in `codeferry sync` via `tryLoadStackInfo()`
- Regenerated if user edits stack info in the init confirmation flow

### 7. Workspace resolution order
`-w` flag → `CODEFERRY_WORKSPACE` env → `.codeferry/state.json` → `"default"` fallback.
`WorkspaceManager.migrateIfNeeded()` is idempotent; call it at the start of any command that touches the workspace layer. Legacy flat `.codeferry/codeferry.config.json` is the trigger; `state.json` presence marks migration complete.

### 8. Queue state machine
`pending → in-progress → done/skipped`
- `codeferry diff` writes `pending` items
- `codeferry sync` updates them to `in-progress`
- `codeferry snapshot --after-sync` reads `in-progress`, updates baselines, marks `done`

### 9. `codeferry diff --ci` exit code semantics
`--ci` implies `--format json` and `--no-ai`. Uses `process.exitCode = N; return` (not `process.exit(N)`) to ensure large JSON output is fully flushed before the process terminates. Exit 1 when any actionable status is present (design-ahead, code-ahead, both-changed, never-synced); exit 0 when all synced.

### 10. `codeferry watch` concurrency rules
- Reload registry **and** snapshot from disk at the start of every scan loop iteration — never reuse the in-memory copy across scans. This prevents watch from overwriting state written by concurrent commands (`snapshot --after-sync`, `map set`, etc.).
- Use the `dirty` flag pattern: if a file event arrives while a scan is running, set `dirty = true` instead of dropping the event; schedule a follow-up scan in `finally` when `dirty` is true.

---

## Key Known Issues / Tech Debt

| Issue | Severity | Planned fix |
|---|---|---|
| HTML Bridge only traces 1 level of imports (App.jsx imports not followed) | Low | v0.9.0+ |
| `pnpm-workspace.yaml` uses legacy `allowBuilds` syntax | Low | Next release: migrate to `onlyBuiltDependencies` |

---

## Testing Guidelines

Tests are in `tests/` using Vitest. Fixtures are in `tests/fixtures/`.

- **Core modules** (`extractor`, `mapper`, `differ`, `scanner`) have unit tests — keep them passing
- **Commands** are NOT unit-tested (they're thin I/O wrappers) — test manually
- **Mock Claude API:** `tests/analyzer.test.ts` and `tests/ai-mapper.test.ts` mock `@anthropic-ai/sdk` — do not make real API calls in tests
- **File fixtures:** `tests/fixtures/mini-design/` and `tests/fixtures/mini-code/` for scanner/extractor/mapper tests; `tests/fixtures/html-bridge/` for HTML Bridge strategy tests — keep them minimal and stable
- When adding a new core module, add a corresponding test file

---

## Commit Style

Conventional Commits:

```
feat: add drift config command
fix: correct direction routing in prompt builder
docs: update usage guide for conflict scenario
chore: remove unused zod dependency
test: add mapper edge case for App Router paths
refactor: extract hash computation to utils/hash.ts
```

---

## Type System Notes

All types are in `src/types/index.ts` — single source of truth. Key types:

- `DriftConfig` — persisted to `.codeferry/codeferry.config.json`
- `ComponentRegistry` — persisted to `.codeferry/registry.json`
- `FullSnapshot` — persisted to `.codeferry/snapshots/`
- `SyncQueue` / `SyncQueueItem` — persisted to `.codeferry/queue.json`
- `StackInfo` — in-memory only (hints are extracted to `DriftConfig.project`)
- `ComponentSyncStatus` — the 7-state enum driving all status UI

---

## Release Checklist (for v0.5.0+)

1. Update `version` in `package.json` AND `src/index.ts` (both must match)
2. Update `CHANGELOG.md` with new section
3. Run `pnpm run lint && node_modules/.bin/vitest run && pnpm run build`
4. `git tag v0.5.0 && git push --tags`
5. `pnpm publish` (runs `prepublishOnly: pnpm run build` automatically)

---

## External Dependencies

| Package | Why | Notes |
|---|---|---|
| `commander` | CLI framework | v13, stable API |
| `inquirer` | Interactive prompts | v12, ESM-only |
| `chalk` | Terminal colors | v5, ESM-only |
| `ora` | Spinners | v8, ESM-only |
| `cli-table3` | Tables | v0.6, CJS-compatible |
| `fast-glob` | File scanning | v3, performant |
| `diff` | Unified diff generation | v7 |
| `clipboardy` | Clipboard access | v4, ESM-only |
| `p-limit` | Concurrency control for API calls | v6 |
| `chokidar` | File watching for `codeferry watch` | v4 (Node ≥14); do NOT upgrade to v5 — requires Node ≥20 |
| `@anthropic-ai/sdk` | Claude API client | Keep up to date for model names |

All ESM-only packages require `"type": "module"` in package.json (already set).
