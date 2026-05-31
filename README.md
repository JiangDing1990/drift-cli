**English** | [简体中文](./README.zh-CN.md)

# codeferry

> A CLI tool for bidirectional sync between Claude Design and Claude Code

[![npm version](https://img.shields.io/npm/v/codeferry)](https://www.npmjs.com/package/codeferry)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## The Problem

When building products with **Claude Design** (high-fidelity JSX prototypes) and **Claude Code** (production implementation), both sides represent the same product intent in different code forms — but live in separate directories. Whenever one side evolves, the other side has no way to know. Over time, this creates **bidirectional drift**.

`codeferry` tracks component-level differences between both sides, generates context-rich sync prompts, and lets you paste them directly into Claude Code or Claude Design to perform the translation. **It never modifies your files directly.**

```
Claude Design (JSX prototypes)        Claude Code (production code)
         │                                       │
         └──────────────── codeferry ────────────┘
                 track · generate prompts · update baseline
```

---

## Features

- 🔍 **Component-level tracking** — Extracts individual components from design JSX files and maps them to code files with 1:N / N:1 relationships
- 📸 **Own snapshot system** — Three-way version comparison (baseline vs design-current vs code-current) for accurate conflict detection
- 🤖 **AI semantic analysis** — Calls Claude API to classify change intent (feature-add / style-change / interaction-change…)
- 📋 **Bidirectional prompt generation** — Generates self-contained Markdown prompts with full context, ready to paste into Claude
- 🛠 **Framework-agnostic** — Core sync logic is independent of any framework; works with Next.js, Vue, Svelte, and more
- 🔎 **Auto stack detection** — `codeferry init` detects framework, language, and styling at setup time, injecting framework-specific conversion hints into prompts
- 🗂 **Multi-workspace support** — Manage multiple design↔code pairs from a single `.codeferry/` directory with `codeferry workspace`

---

## Installation

```bash
# npm
npm install -g codeferry

# pnpm
pnpm add -g codeferry

# or install locally in a project
npm install --save-dev codeferry
```

**Requires:** Node.js >= 18

---

## Quick Start

> **Looking for detailed examples?** → [Complete Usage Guide](./docs/USAGE.md) covers every scenario with annotated terminal output, including conflict resolution, batch sync, code→design reverse sync, and troubleshooting.

### 1. Initialize

```bash
codeferry init --design ~/Downloads/my-design --code ~/my-project
```

- Creates a `.codeferry/` directory in your current working directory (independent of both projects)
- Auto-detects the code-side tech stack with interactive confirmation
- Extracts design components, scans code files, and takes an initial snapshot

### 2. Map components to code files

```bash
codeferry map auto               # Auto-map by filename + export name matching
codeferry map                    # View all mappings
codeferry map set <id> <path>    # Manually set a mapping
```

### 3. Detect changes

```bash
codeferry diff                   # Scan both sides with AI semantic analysis
codeferry diff --no-ai           # Structural diff only, skip AI
codeferry diff --side design     # Only scan the design side
```

### 4. Generate a sync prompt

```bash
codeferry sync --to code         # Sync design changes to code (copy to clipboard)
codeferry sync --to design       # Sync code changes to design
codeferry sync --to code --out ./prompts/    # Write to files instead
codeferry sync --to code --component TopNav # Single component only
```

### 5. Paste the prompt and let Claude do the work

Paste the clipboard content into a Claude Code or Claude Design conversation and wait for the AI to make the changes.

### 6. Update the baseline to close the loop

```bash
codeferry snapshot --after-sync  # Only update components synced in this run
codeferry snapshot               # Update all component baselines
```

---

## Full Workflows

### Design → Code (most common)

```
1. Update the design in Claude Design and re-export to your local directory
2. codeferry diff                        ← detect changes, AI classifies intent
3. codeferry sync --to code --copy       ← generate prompt, copy to clipboard
4. Paste into a Claude Code conversation
5. Claude Code edits local code files
6. Review and confirm the result looks correct
7. codeferry snapshot --after-sync       ← lock baseline, status → synced
```

### Code → Design (reverse)

```
1. Edit code files
2. codeferry diff --side code            ← detect code-side changes
3. codeferry sync --to design --copy     ← generate reverse-direction prompt
4. Paste into a Claude Design conversation
5. Claude Design updates and re-exports the design
6. codeferry snapshot --after-sync       ← lock baseline
```

### Conflict resolution (both sides changed)

```
codeferry diff                                   ← shows "⚠ CONFLICT"
codeferry sync --to code --component TopNav      ← generates merge prompt with both diffs
# Let Claude Code merge both sets of changes
codeferry snapshot --after-sync
```

---

## Command Reference

### `codeferry init`

Initialize codeferry.

```
Options:
  --design <path>   Design root directory (required)
  --code <path>     Code project root directory (required)
  --force           Force re-initialization (overwrites existing config)
  --skip-detect     Skip tech stack auto-detection
```

### `codeferry map`

Manage component-to-code mappings.

```
codeferry map                          # View all mappings (alias for codeferry map list)
codeferry map list [--unmapped]        # Show only unmapped components
codeferry map auto                     # Run auto-mapping strategies
codeferry map set <id> <path>          # Manually set a mapping
codeferry map unset <id>               # Remove a mapping
```

### `codeferry status`

View a summary of all component sync states.

```
Options:
  --refresh           Re-scan the filesystem for latest hashes
  --filter <status>   Filter by state: synced | design-ahead | code-ahead |
                      both-changed | never-synced | new-design | new-code
```

### `codeferry diff`

Scan both directories for changes, display diffs, and run AI semantic analysis. Results are written to the sync queue.

```
Options:
  --no-ai             Skip AI analysis (no API key needed)
  --side <side>       Only scan one side: design | code
  --component <name>  Only scan a specific component
```

> **AI analysis** requires the `ANTHROPIC_API_KEY` environment variable. Without it, the tool gracefully falls back to structural diff only.

### `codeferry sync`

Read the sync queue and generate bidirectional sync prompts with full context.

```
Options:
  --to <target>        Sync direction: code (design→code) | design (code→design) (required)
  --copy               Copy prompt to clipboard (default)
  --out <dir>          Write to a directory (one .md file per component)
  --component <name>   Generate prompt for a specific component only
  --no-ai              Skip AI analysis, use generic conversion hints
```

### `codeferry snapshot`

Mark the current state of both sides as the new baseline. **Every sync loop must end with this command.**

```
Options:
  --component <name>  Only update the baseline for a specific component
  --after-sync        Only update in-progress components (recommended after codeferry sync)
```

### `codeferry log`

View sync history and queue state.

```
Options:
  --component <name>  Show records for a specific component only
  --last <n>          Show only the most recent N entries
  --status <status>   Filter by status: pending | in-progress | done | skipped | conflict
```

### `codeferry workspace` (alias: `ws`)

Manage multiple design↔code workspace pairs within a single `.codeferry/` directory.

```
codeferry workspace list                    # List all workspaces (default subcommand)
codeferry workspace current                 # Show the active workspace name
codeferry workspace use <name>              # Switch the active workspace
codeferry workspace create <name>           # Create and initialize a new workspace
  Options: --design <path>  --code <path>
codeferry workspace remove <name>           # Remove a workspace (--force to remove 'default')
```

**Workspace resolution order** (highest to lowest priority):
1. `-w / --workspace <name>` flag on any command
2. `CODEFERRY_WORKSPACE` environment variable
3. `.codeferry/state.json` (set by `workspace use`)
4. `"default"` fallback

```bash
# One-off override without changing the active workspace
codeferry status -w mobile-app

# CI: set workspace via environment variable
CODEFERRY_WORKSPACE=mobile-app codeferry diff --no-ai
```

---

## Configuration

`codeferry init` generates `codeferry.config.json` inside the `.codeferry/` directory. You can edit it manually:

```jsonc
{
  "version": "2.0",

  "design": {
    "root": "~/Downloads/my-design",
    "include": ["**/*.jsx", "**/*.tsx"],
    "exclude": ["design-canvas.jsx"]
  },

  "code": {
    "root": "~/my-project",
    "include": ["**/*.tsx", "**/*.ts"],
    "exclude": ["**/node_modules/**", "**/dist/**"]
  },

  "ai": {
    "model": "claude-sonnet-4-20250514",   // model used for analysis
    "batchSize": 5,                         // components analyzed per batch
    "maxConcurrency": 3                     // concurrent API requests
  },

  "project": {
    "stack": "Next.js 15 + TypeScript + Tailwind CSS",
    "conventions": [
      "Components use CSS Modules with *.module.scss file names",
      "Routing uses App Router; pages live under src/app/"
    ],
    // Auto-generated by codeferry init; can also be edited manually
    "designToCodeHints": [
      "Convert inline styles to Tailwind class names",
      "Add TypeScript type annotations",
      "Preserve existing project structure and naming conventions"
    ],
    "codeToDesignHints": [
      "Design files use browser-native JSX — no import/export needed",
      "Convert Tailwind class names back to inline styles or CSS variables",
      "Remove TypeScript type annotations",
      "Replace API calls and hooks with hardcoded mock data"
    ]
  }
}
```

---

## Sync States

| State | Meaning | Recommended action |
|---|---|---|
| `synced` | Both sides match the baseline | Nothing to do |
| `design-ahead` | Design updated, code not yet synced | `codeferry sync --to code` |
| `code-ahead` | Code updated, design not yet synced | `codeferry sync --to design` |
| `both-changed` | Both sides changed (conflict) | `codeferry sync --to code` (generates merge prompt) |
| `never-synced` | Mapped but never synced | `codeferry snapshot` to establish initial baseline |
| `new-design` | New design component, no code mapping | `codeferry map set` to create mapping |
| `new-code` | New code file, no design mapping | `codeferry map set` (optional) |

---

## AI Analysis

`codeferry diff` and `codeferry sync` can call the Claude API to analyze changes semantically:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
codeferry diff
```

Analysis output includes:

- **Intent**: `feature-add` / `style-change` / `interaction-change` / `layout-change` / `refactor` / `props-change` / `logic-change` / `content-change`
- **Impact**: `high` / `medium` / `low`
- **One-line summary**
- **Sync guide**: concrete step-by-step instructions

Without an API key, the tool works fully — AI analysis simply degrades to generic structural diff and generic conversion hints.

---

## `.codeferry/` Directory Structure

```
.codeferry/
├── state.json                        # Active workspace pointer
└── workspaces/
    ├── default/                      # Default workspace (created by codeferry init)
    │   ├── codeferry.config.json     # Config (design/code paths, AI settings, stack info)
    │   ├── registry.json             # Component registry (extracted components + mappings)
    │   ├── queue.json                # Sync queue (pending / in-progress / done / skipped)
    │   ├── snapshots/
    │   │   ├── latest.json           # Latest snapshot (baseline for diff)
    │   │   └── snap_*.json           # Snapshot history
    │   └── history/
    │       └── *.md                  # Generated prompt history
    └── mobile-app/                   # Additional workspace (codeferry workspace create)
        └── ...
```

The `.codeferry/` directory is independent of both projects — it won't pollute your code's git history and won't be overwritten by Claude Design exports.

> **Upgrading from v0.4.x?** The first command you run after upgrading will automatically migrate the old flat `.codeferry/` layout to `workspaces/default/` with no data loss.

---

## Stack Detection

`codeferry init` auto-detects the code-side tech stack. Supported dimensions:

| Dimension | Supported |
|---|---|
| Framework | Next.js · Nuxt · SvelteKit · Vite+React · Vue · Angular |
| Language | TypeScript · JavaScript |
| Styling | Tailwind CSS · CSS Modules · styled-components · Emotion · SCSS |
| State management | Zustand · Redux · Jotai · Pinia · TanStack Query · MobX |
| Routing | App Router · Pages Router · React Router · Vue Router |
| Component pattern | function declaration · arrow function |

Detection results are stored in `codeferry.config.json`. All dimensions can be corrected during the interactive confirmation step in `codeferry init`.

---

## Development

```bash
git clone https://github.com/JiangDing1990/codeferry
cd codeferry
pnpm install

pnpm run build      # build
pnpm run dev        # watch mode
pnpm run test       # run tests (watch mode)
pnpm run test:run   # run all tests once
pnpm run lint       # TypeScript type check
```

---

## Documentation

| Document | Description |
|---|---|
| [Complete Usage Guide](./docs/USAGE.md) | Every scenario with annotated terminal output |
| [Architecture](./docs/ARCHITECTURE.md) | System design, module breakdown, data model |
| [Roadmap](./ROADMAP.md) | Development plan: v0.5.0 → v1.0.0 |
| [Changelog](./CHANGELOG.md) | Release history |
| [Contributing](./CONTRIBUTING.md) | Development setup and PR process |

---

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full development plan, including upcoming features for v0.6.0–v1.0.0.

---

## Contributing

Issues and PRs are welcome. For architecture context, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

For development setup, commit style, and PR process, see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT © 2026
