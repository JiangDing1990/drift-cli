[English](./USAGE.md) | [简体中文](./USAGE.zh-CN.md)

# codeferry — Complete Usage Guide

> This guide walks through every feature and scenario with annotated terminal output.  
> For a quick overview, see the [README](../README.md).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Project Setup — `codeferry init`](#3-project-setup--drift-init)
4. [Component Mapping — `codeferry map`](#4-component-mapping--drift-map)
5. [Baseline Snapshot — `codeferry snapshot`](#5-baseline-snapshot--drift-snapshot)
6. [Scenario A — Design → Code (most common)](#6-scenario-a--design--code-most-common)
7. [Scenario B — Code → Design (reverse sync)](#7-scenario-b--code--design-reverse-sync)
8. [Scenario C — Conflict Resolution (both sides changed)](#8-scenario-c--conflict-resolution-both-sides-changed)
9. [Scenario D — Batch Sync (multiple components)](#9-scenario-d--batch-sync-multiple-components)
10. [Scenario E — Single Component Targeting](#10-scenario-e--single-component-targeting)
11. [Scenario F — Working Without AI](#11-scenario-f--working-without-ai)
12. [Scenario G — Syncing a New Design Component](#12-scenario-g--syncing-a-new-design-component)
13. [Scenario H — Code-only additions (new-code)](#13-scenario-h--code-only-additions-new-code)
14. [Checking Sync Status — `codeferry status`](#14-checking-sync-status--drift-status)
15. [Viewing History — `codeferry log`](#15-viewing-history--drift-log)
16. [Configuration File Reference](#16-configuration-file-reference)
17. [Re-initialization and Reset](#17-re-initialization-and-reset)
18. [Multi-Workspace Management — `codeferry workspace`](#18-multi-workspace-management--codeferry-workspace)
19. [Environment Variables](#19-environment-variables)
20. [Troubleshooting](#20-troubleshooting)
21. [FAQ](#21-faq)

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | >= 18.0.0 | LTS recommended |
| **Claude Design** | any | Source of JSX prototype files |
| **Anthropic API Key** | optional | Enables AI semantic analysis; tool works without it |

**Directory layout before you start:**

```
~/Downloads/my-design/          ← Claude Design export directory
  components/
    pages.jsx                   ← design-side JSX (multiple components per file)
    shared.jsx
    extras.jsx

~/my-project/                   ← production code (any framework)
  src/
    app/
      account/page.tsx
      gallery/page.tsx
    components/
      shared/index.tsx
```

> **Claude Design exports** a flat JSX file with zero imports, using browser-compiled Babel. One file often contains multiple page-level components. codeferry understands this format natively.

---

## 2. Installation

### Global (recommended)

```bash
# npm
npm install -g codeferry

# pnpm
pnpm add -g codeferry

# Verify
codeferry --version
# 0.4.0
```

### Local (per project)

```bash
npm install --save-dev codeferry
# Then use: npx drift <command>
```

### From source

```bash
git clone https://github.com/JiangDing1990/codeferry.git
cd codeferry
pnpm install
pnpm run build
npm link     # makes `codeferry` available globally
```

---

## 3. Project Setup — `codeferry init`

`codeferry init` is a one-time setup that creates the `.codeferry/` state directory, detects your tech stack, extracts design components, scans code files, and takes an initial snapshot.

### Basic usage

```bash
# Run from any directory — .codeferry/ is created in your CWD
codeferry init \
  --design ~/Downloads/my-design/components \
  --code   ~/my-project
```

### Full interactive session

```
$ codeferry init --design ~/Downloads/picture-hub/components --code ~/danqing

- Creating .codeferry/ directory...
✔ .codeferry/ directory created

- Analyzing code-side tech stack...
✔ Stack detection complete

  Tech Stack Detection Results

  ✔ Framework     Next.js 15.0.0       (high confidence · package.json dependencies)
  ✔ Language      TypeScript           (high confidence · tsconfig.json found)
  ✔ Styling       Tailwind CSS         (high confidence · tailwind.config.ts)
  ? State mgmt    TanStack Query       (medium · package.json dependencies)
  ? Routing       App Router           (medium · directory structure)
  ? Component     function declaration (medium · sampled 10 files)

? Are the results above correct?
❯ Confirm and continue
  Correct specific items
  Enter all manually
  Skip (don't configure stack info)
```

**Choose "Confirm and continue"** when the detection is accurate.

**Choose "Correct specific items"** when you need to fix one or two dimensions:

```
? Select items to correct: (space to select, enter to confirm)
◻ Framework     Next.js 15
◻ Language      TypeScript
◻ Styling       Tailwind CSS
◼ State mgmt    TanStack Query → Enter correct state management: zustand
◻ Routing       App Router

✔ Tech stack updated
```

**Choose "Skip"** when running in a non-interactive environment (or use `--skip-detect`):

```bash
codeferry init --design ~/Downloads/my-design --code ~/my-project --skip-detect
```

### After confirmation

```
? Add project conventions? (These are injected into prompts to help AI translate more accurately)
  Example: "CSS class names use BEM naming", "Components organized under features/ by domain"

> Components use CSS Modules with *.module.scss
> Routing uses App Router; pages under src/app/
> (Enter to finish)

✔ 2 conventions saved

- Extracting design components...
✔ Design extraction complete
✔ Scanned 18 files, extracted 139 components
  Breakdown: 29 pages, 69 shared, 41 helpers

- Scanning code files...
✔ Code scan complete: 66 files

✔ Initialization complete
  Registered: 139 components
  Initial snapshot: snap_2026-05-31T04-12-15

ℹ Next: run codeferry map auto to establish component mappings
```

### What gets created

```
.codeferry/
├── codeferry.config.json      # Config: paths, AI settings, stack info
├── registry.json          # All 139 extracted components (no mappings yet)
├── queue.json             # Empty sync queue
└── snapshots/
    └── latest.json        # Initial snapshot (all hashes captured)
```

### Flags

| Flag | Description |
|---|---|
| `--design <path>` | Design root directory (required) |
| `--code <path>` | Code root directory (required) |
| `--force` | Re-initialize even if `.codeferry/` already exists |
| `--skip-detect` | Skip tech stack detection (useful in CI or scripted setup) |

---

## 4. Component Mapping — `codeferry map`

Mapping connects design components to their code counterparts. Without a mapping, codeferry cannot generate sync prompts.

### Step 1 — Run auto-mapping

```bash
codeferry map auto
```

Output:

```
- Running auto-mapping for 139 unmapped components...
✔ Auto-mapping complete: 49 matched, 90 unmatched

┌──────────────────────┬──────────────────────────────────┬──────────┬────────────────────────────┐
│ Component            │ Code File                        │ Confidence│ Reason                     │
├──────────────────────┼──────────────────────────────────┼──────────┼────────────────────────────┤
│ AccountPage          │ src/app/(dashboard)/account/pag… │ 60%      │ Filename + export name     │
│ TopNav               │ src/components/shared/index.tsx  │ 95%      │ Export name match "TopNav" │
│ Seal                 │ src/components/shared/index.tsx  │ 95%      │ Export name match "Seal"   │
│ GalleryPage          │ src/server/api/routers/gallery.… │ 85%      │ Filename match "gallery"   │
│ LoginPage            │ src/app/(auth)/login/page.tsx    │ 60%      │ Filename + export name     │
└──────────────────────┴──────────────────────────────────┴──────────┴────────────────────────────┘

? Confirm 49 mappings and write to registry? (Y/n) Y

✔ Registry updated
✔ Mapping complete: 49 components mapped
  90 components unmatched — use codeferry map set to assign manually
```

### Step 2 — Review the mapping table

```bash
codeferry map          # full table
codeferry map --unmapped   # only unmatched components
```

Full table excerpt:

```
┌─────────────────────────┬──────────────────────┬──────────────────────────────────┬─────────────┬────────────┐
│ Component               │ Design File          │ Code File(s)                     │ Status      │ Mapping    │
├─────────────────────────┼──────────────────────┼──────────────────────────────────┼─────────────┼────────────┤
│ AccountPage             │ extras.jsx:3-162     │ src/app/(dashboard)/account/…    │ never-synced│ auto 60%   │
│ TopNav                  │ shared.jsx:6-27      │ src/components/shared/index.tsx  │ never-synced│ auto 95%   │
│ GalleryPage             │ other-pages.jsx:81…  │ src/server/api/routers/gallery…  │ never-synced│ auto 85%   │
│ WorkDetailPage          │ extras.jsx:449-536   │ src/lib/ai.ts                    │ never-synced│ auto 50%   │
│ TemplatesGrid           │ (unmapped)           │ —                                │ new-design  │ —          │
└─────────────────────────┴──────────────────────┴──────────────────────────────────┴─────────────┴────────────┘
```

### Step 3 — Fix wrong mappings

Auto-mapping sometimes hits wrong files (e.g., `GalleryPage` mapping to the API router instead of the page component). Fix them manually:

```bash
# Syntax: codeferry map set "<file>::<ComponentName>" "<relative-code-path>"
codeferry map set "other-pages.jsx::GalleryPage" "src/app/(dashboard)/gallery/page.tsx"
codeferry map set "extras.jsx::WorkDetailPage"   "src/app/(dashboard)/gallery/[id]/page.tsx"
codeferry map set "admin.jsx::AdminPage"         "src/app/(admin)/admin/page.tsx"
```

Output:

```
✔ Manual mapping set: GalleryPage → src/app/(dashboard)/gallery/page.tsx
✔ Manual mapping set: WorkDetailPage → src/app/(dashboard)/gallery/[id]/page.tsx
✔ Manual mapping set: AdminPage → src/app/(admin)/admin/page.tsx
```

### Step 4 — Map remaining unmapped components

```bash
codeferry map --unmapped
```

For components that genuinely don't have a code counterpart yet, you can skip them or map them to the closest file:

```bash
# Skip a component (it won't appear in sync suggestions)
codeferry map unset "extras3.jsx::UnmappedWidget"

# Map a component that shares a file with another
codeferry map set "admin.jsx::AdminSidebar" "src/app/(admin)/admin/content.tsx"
```

### Component ID format

Every component has a stable ID based on its source file and name:

```
<relative-design-file>::<ComponentName>
```

Examples:
- `extras.jsx::AccountPage`
- `shared.jsx::TopNav`
- `other-pages.jsx::GalleryPage`

Use `codeferry map` to look up IDs at any time.

---

## 5. Baseline Snapshot — `codeferry snapshot`

After setting up mappings, you must take a baseline snapshot. This records the current hash of both sides, so future `codeferry diff` runs know what "unchanged" looks like.

```bash
codeferry snapshot
```

Output:

```
- Updating baseline snapshot for all mapped components...
✔ Baseline update complete: 49 components
  90 unmapped components skipped
✔ Snapshot saved: snap_2026-05-31T04-12-15
  State locked as synced baseline; next codeferry diff compares from here
```

Now `codeferry status` shows:

```
✔ synced 49  ·  ◐ design-ahead 0  ·  ◑ code-ahead 0  ·  ⚠ conflict 0
```

> **Important:** If you skip this step, all components stay in `never-synced` state and `codeferry diff` will report no changes on either side.

---

## 6. Scenario A — Design → Code (most common)

This is the everyday workflow: the designer updates a prototype in Claude Design, and you need to bring the production code up to date.

### Full walkthrough

**Step 1 — Update the design in Claude Design**

In your Claude Design conversation, describe the changes you want. Claude Design regenerates the JSX files and overwrites the local export directory.

For this example, suppose `AccountPage` in `extras.jsx` now has a new "API Token" row in the security section.

**Step 2 — Detect changes**

```bash
codeferry diff
```

With `ANTHROPIC_API_KEY` set:

```
- Scanning both directories for changes...
✔ Scan complete: 1 design change, 0 code changes · 1 component affected

  codeferry diff — design ↔ code

  ✔ synced 48  ◐ design-ahead 1  ◑ code-ahead 0  ⚠ conflict 0


  ◐ DESIGN AHEAD  AccountPage  (design-ahead)
  design: extras.jsx:3-162
  code:   src/app/(dashboard)/account/page.tsx

  Intent:   feature-add
  Impact:   medium
  Summary:  Added "API Token" management entry to the security settings panel

  Sync guide:
    1. In SecurityTab, add { key: "token", t: "API 令牌", d: "2 tokens active", a: "Manage" }
       to the items array
    2. Add a "token" case to handleAction() — for now show a "coming soon" modal like 2FA
    3. Optionally add an ApiTokenModal component similar to DeviceModal

ℹ 1 component design-ahead — run codeferry sync --to code to sync to code
```

Without `ANTHROPIC_API_KEY` (structural diff only):

```
  ◐ DESIGN AHEAD  AccountPage  (design-ahead)

  ◐ Design current content:
    function AccountPage() {
      ...
      { t: 'API 令牌', d: '已生成 2 个访问令牌', a: '管理', k: 'token' },
      ...
    }

  Diff (from baseline):
    +                  { t: 'API 令牌', d: '已生成 2 个访问令牌', a: '管理', k: 'token' },
```

**Step 3 — Generate the sync prompt**

```bash
# Copy to clipboard (default)
codeferry sync --to code

# Or write to a file
codeferry sync --to code --out ./prompts/
```

Output:

```
- Scanning for changes (Design → Code)...
✔ Scan complete

  codeferry sync — Design → Code

  1 component to sync:
    ◐ AccountPage  extras.jsx

- Reading component content...
✔ Content loaded
- Generating prompt...
✔ Prompt copied to clipboard

ℹ Next steps:

  1. Paste the clipboard content into a Claude Code conversation
  2. Wait for Claude Code to apply the changes
  3. Review and confirm the result looks correct
  4. Run codeferry snapshot --after-sync to update the baseline
```

**Step 4 — Paste into Claude Code**

Open a Claude Code session (or your AI coding assistant). Paste the clipboard content. The prompt includes:
- The full design component source (with the new API Token row)
- The full production code (`SecurityTab` function)
- Tech stack context (Next.js, Tailwind, TypeScript)
- Framework-specific conversion hints
- AI-generated step-by-step sync guide

Claude Code will add the API Token item to `SecurityTab` following the existing code patterns.

**Step 5 — Review the change**

After Claude Code finishes, verify the change looks correct in your editor.

**Step 6 — Close the loop**

```bash
codeferry snapshot --after-sync
```

Output:

```
- Updating baseline for in-progress components...
✔ Baseline updated: 1 component (AccountPage)
✔ Snapshot saved: snap_2026-05-31T10-44-22
  1 component marked as synced
```

Now `codeferry status` is back to `✔ synced 49`.

---

## 7. Scenario B — Code → Design (reverse sync)

When the engineering team adds a feature directly in code (without going through the design prototype first), you may want to bring the design up to date.

### Walkthrough

**Step 1 — Make code changes**

Suppose a developer adds a dark-mode toggle to `PrefsTab` in `account/page.tsx`.

**Step 2 — Detect the code-side change**

```bash
codeferry diff --side code
```

```
- Scanning code side for changes...
✔ Scan complete: 0 design changes, 1 code change · 1 component affected

  ◑ CODE AHEAD  AccountPage  (code-ahead)
  design: extras.jsx:3-162
  code:   src/app/(dashboard)/account/page.tsx

  Intent:   feature-add
  Summary:  Added dark-mode toggle to PrefsTab
```

**Step 3 — Generate the reverse-direction prompt**

```bash
codeferry sync --to design
```

The generated prompt instructs Claude Design to:
- Take the production TypeScript implementation of the dark-mode toggle
- Convert it to browser-native JSX (no imports, inline styles, no TypeScript types)
- Replace tRPC/API calls with hardcoded mock state
- Maintain the design file's existing visual style

**Step 4 — Paste into Claude Design**

Paste the prompt into your Claude Design conversation. Claude Design will update the design prototype and re-export the files.

**Step 5 — After Claude Design re-exports, update the baseline**

```bash
# Make sure Claude Design has written the new files to disk first!
codeferry snapshot --after-sync
```

---

## 8. Scenario C — Conflict Resolution (both sides changed)

A conflict occurs when **both** the design and the code are modified since the last baseline — they can no longer be automatically reconciled.

### How conflicts appear

```bash
codeferry diff
```

```
  ⚠ CONFLICT  TopNav  (both-changed)
  design: shared.jsx:6-27
  code:   src/components/shared/index.tsx

  Intent:   both-changed
  Summary:  Design added a search icon; Code added a notifications badge

  Design diff (from baseline):
    + <SearchIcon size={20} />

  Code diff (from baseline):
    + <NotificationBadge count={unreadCount} />
```

### Resolution

**Step 1 — Generate a merge prompt**

```bash
codeferry sync --to code --component "shared.jsx::TopNav"
```

The conflict prompt contains:
- Both the design diff and the code diff
- Explicit instruction to **merge both changes**, not pick one side

**Step 2 — Paste into Claude Code**

Claude Code will merge the search icon (from design) and the notification badge (from code) into a single updated `TopNav`.

**Step 3 — Update baseline**

```bash
codeferry snapshot --after-sync
```

> **Tip:** For complex conflicts, you can also resolve manually by editing the code file yourself before running `codeferry snapshot`.

---

## 9. Scenario D — Batch Sync (multiple components)

When multiple components are design-ahead (e.g., after a large design refresh), you can sync them all in one operation.

```bash
codeferry diff
```

```
  ✔ synced 35  ◐ design-ahead 8  ◑ code-ahead 2  ⚠ conflict 1
```

**Sync all design-ahead components at once:**

```bash
codeferry sync --to code --out ./prompts/
```

```
- Scanning for changes (Design → Code)...
✔ Scan complete

  8 components to sync:
    ◐ AccountPage     extras.jsx
    ◐ CreatePage      create.jsx
    ◐ GalleryPage     other-pages.jsx
    ◐ LoginPage       login.jsx
    ◐ SearchPage      search.jsx
    ◐ TopNav          shared.jsx
    ◐ Footer          shared.jsx
    ◐ PricingPage     pricing.jsx

- Writing 8 prompt files to ./prompts/...
✔ 8 files written to ./prompts/
  → AccountPage_d2c_2026-05-31.md
  → CreatePage_d2c_2026-05-31.md
  → GalleryPage_d2c_2026-05-31.md
  ...
```

Open each `.md` file and paste it into Claude Code one by one (or in parallel Claude Code sessions).

After all changes are applied:

```bash
codeferry snapshot --after-sync
```

> **Workflow tip:** Start with high-impact components (check `codeferry diff` for `impact: high`) and do them first.

---

## 10. Scenario E — Single Component Targeting

When you only care about one component:

```bash
# Diff only one component
codeferry diff --component "extras.jsx::AccountPage"

# Generate prompt for only one component
codeferry sync --to code --component "extras.jsx::AccountPage" --copy

# Update baseline for only one component after applying
codeferry snapshot --component "extras.jsx::AccountPage"
```

This is useful when:
- You're rapidly iterating on a single UI element
- You want to preview what a sync prompt looks like before batch syncing
- You've manually resolved a conflict and just need to update that component's baseline

---

## 11. Scenario F — Working Without AI

If you don't have an `ANTHROPIC_API_KEY`, or want faster execution without API calls:

```bash
codeferry diff --no-ai        # structural diff only
codeferry sync --to code --no-ai   # generic conversion hints (no intent analysis)
```

The prompt still contains:
- Full design component source
- Full code file content
- Tech stack context (Next.js, Tailwind, etc. — from your `codeferry.config.json`)
- Framework-specific conversion rules (generated at `codeferry init` time)

What's missing without AI:
- Change intent classification (`feature-add`, `style-change`, etc.)
- Impact assessment
- Step-by-step sync guide

This mode is reliable enough for most changes. Enable AI for complex logic changes or conflict resolution.

### Setup for AI analysis

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# For persistent setup, add to your shell profile:
echo 'export ANTHROPIC_API_KEY="sk-ant-api03-..."' >> ~/.zshrc
source ~/.zshrc
```

---

## 12. Scenario G — Syncing a New Design Component

When Claude Design creates a brand-new page that doesn't exist in your codebase yet.

**Step 1 — After `codeferry diff`:**

```
  + NEW DESIGN (3) — not mapped to any code file
    TemplateEditPage   extras.jsx:539-684
    CommentSection     author.jsx:668-733
    BrushSelector      create.jsx:120-180
```

**Step 2 — Map to a new (not yet created) code file:**

```bash
codeferry map set "extras.jsx::TemplateEditPage" "src/app/(dashboard)/templates/[id]/edit/page.tsx"
```

Even if the file doesn't exist yet, you can set the mapping in advance.

**Step 3 — Generate a creation prompt:**

```bash
codeferry sync --to code --component "extras.jsx::TemplateEditPage"
```

The prompt instructs Claude Code to **create** the file, because the code target doesn't exist. Claude Code will scaffold the new route with proper TypeScript types and framework conventions.

**Step 4 — After the file is created:**

```bash
codeferry snapshot --component "extras.jsx::TemplateEditPage"
```

---

## 13. Scenario H — Code-only additions (new-code)

When the engineering team creates files that have no corresponding design component.

```
codeferry status

  + NEW CODE (5) — not mapped to design
    src/app/api-docs/page.tsx
    src/app/help/page.tsx
    src/components/admin/DangerZone.tsx
    ...
```

These files appear in the status output but codeferry won't try to sync them unless you explicitly map them.

**Option 1 — Map to an existing design component:**

```bash
codeferry map set "other-pages.jsx::HelpPage" "src/app/help/page.tsx"
```

**Option 2 — Leave unmapped (codeferry will track them as `new-code` but do nothing):**

No action needed. They'll stay as `new-code` until you map them.

---

## 14. Checking Sync Status — `codeferry status`

`codeferry status` gives you a bird's-eye view without scanning files.

```bash
codeferry status              # shows cached state
codeferry status --refresh    # re-scans file system first
```

```
  codeferry status — design ↔ code

  Totals: 49 mapped · 90 unmapped design · 35 unmapped code

  ✔ synced 43  ·  ◐ design-ahead 3  ·  ◑ code-ahead 1  ·  ⚠ conflict 1  ·  ○ never-synced 1

  ⚠ CONFLICTS (1)
    TopNav       shared.jsx ↔ src/components/shared/index.tsx
    design: +search icon   code: +notification badge

  ◐ DESIGN AHEAD (3)
    AccountPage  extras.jsx → src/app/(dashboard)/account/page.tsx   +api-token
    CreatePage   create.jsx → src/app/(dashboard)/create/page.tsx    brush-palette-update
    PricingPage  pricing.jsx → src/app/pricing/page.tsx              new-tier-layout

  ◑ CODE AHEAD (1)
    PrefsTab     extras.jsx ← src/app/(dashboard)/account/page.tsx   dark-mode-toggle
```

**Filter by state:**

```bash
codeferry status --filter design-ahead
codeferry status --filter conflict
codeferry status --filter never-synced
```

---

## 15. Viewing History — `codeferry log`

```bash
codeferry log                           # all history (newest first)
codeferry log --last 5                  # last 5 entries
codeferry log --component "extras.jsx::AccountPage"   # one component
codeferry log --status done             # only completed syncs
```

```
  codeferry log — sync history

  [2026-05-31 10:44]  AccountPage       design→code   done     feature-add   API Token management
  [2026-05-30 15:22]  TopNav            design→code   done     style-change  search icon added
  [2026-05-30 09:11]  GalleryPage       design→code   done     layout-change grid → masonry
  [2026-05-29 18:03]  CreatePage        conflict      done     both-changed  merged brush selector
  [2026-05-28 22:15]  PricingPage       design→code   pending  feature-add   new tier card
```

---

## 16. Configuration File Reference

`codeferry.config.json` is located at `.codeferry/codeferry.config.json`. You can edit it directly.

```jsonc
{
  "version": "2.0",

  // Design side — Claude Design export directory
  "design": {
    "root": "~/Downloads/picture-hub/components",
    "include": ["**/*.jsx", "**/*.tsx", "**/*.html", "**/*.css"],
    "exclude": [
      "design-canvas.jsx"   // Exclude the canvas wrapper itself
    ]
  },

  // Code side — production project
  "code": {
    "root": "~/danqing",
    "include": ["**/*.tsx", "**/*.ts"],
    "exclude": [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/prisma/**",       // Exclude generated Prisma types
      "**/*.test.*",        // Exclude test files
      "**/*.spec.*"
    ]
  },

  // AI settings
  "ai": {
    "model": "claude-sonnet-4-20250514",  // Model for semantic analysis
    "batchSize": 5,                        // Components analyzed per API call
    "maxConcurrency": 3                    // Concurrent API requests
  },

  // Project context — injected into all sync prompts
  "project": {
    // Auto-detected by codeferry init; edit if your stack changes
    "stack": "Next.js 15 + TypeScript + Tailwind CSS",

    // Free-form conventions; injected verbatim into prompts
    "conventions": [
      "Components use CSS Modules with *.module.scss",
      "Routing uses App Router; pages under src/app/",
      "State management: tRPC + TanStack Query for server state",
      "Auth via next-auth v5 (beta)"
    ],

    // Conversion hints for Design → Code direction
    // Auto-generated from stack info; can be customized
    "designToCodeHints": [
      "Convert inline styles to Tailwind class names",
      "Add TypeScript type annotations",
      "Replace hardcoded mock data with tRPC API calls (api.xxx.useQuery)",
      "Use next/link for internal navigation instead of <a href>",
      "Remove React.useState → use useState from 'react'",
      "Preserve existing project structure and naming conventions"
    ],

    // Conversion hints for Code → Design direction
    "codeToDesignHints": [
      "Design files are browser-native JSX — no import/export statements",
      "Convert Tailwind class names to equivalent inline styles",
      "Remove TypeScript type annotations",
      "Replace tRPC queries with hardcoded mock data arrays",
      "Replace next/link with plain <a href> tags",
      "Replace next/image with regular <img> tags"
    ]
  }
}
```

### Customizing include/exclude globs

By default, codeferry scans `**/*.jsx`, `**/*.tsx`, `**/*.ts` on both sides. To exclude specific directories:

```jsonc
"code": {
  "include": ["src/**/*.tsx", "src/**/*.ts"],
  "exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "src/server/**",          // Exclude server-only code
    "src/types/**",           // Exclude type-only files
    "**/*.stories.*"          // Exclude Storybook stories
  ]
}
```

---

## 17. Re-initialization and Reset

### Re-detect tech stack only

If you migrate your styling from CSS Modules to Tailwind, you can update the stack info without touching mappings or snapshots:

```bash
codeferry init --force
# Answer the detection prompts with updated info
# Existing mappings and snapshots are preserved
```

> Note: `--force` re-runs the full init. If you want to preserve existing mappings, back up `registry.json` first.

### Full reset

```bash
rm -rf .codeferry/
codeferry init --design ~/Downloads/my-design --code ~/my-project
codeferry map auto
codeferry snapshot
```

### Update conventions only

Edit `codeferry.config.json` directly:

```json
"conventions": [
  "Migrated to Tailwind CSS v4 — use @apply sparingly",
  "New component directory: src/features/ instead of src/components/"
]
```

No re-initialization needed. The next `codeferry sync` will pick up the updated conventions.

---

## 18. Multi-Workspace Management — `codeferry workspace`

If you maintain multiple design↔code pairs (e.g. a web app and a mobile app), you can create multiple workspaces inside a single `.codeferry/` directory. Each workspace has its own config, registry, and snapshots.

### Create a second workspace

```bash
# Create and initialize a workspace named 'mobile-app'
codeferry workspace create mobile-app --design ~/mobile-design --code ~/mobile-src

# 'workspace' can be abbreviated to 'ws'
codeferry ws create mobile-app --design ~/mobile-design --code ~/mobile-src
```

### List all workspaces

```bash
codeferry workspace list
# Output:
#  WORKSPACE     DESIGN              CODE                COMPONENTS
#  default       ./design            ./src               12
# *mobile-app    ./mobile-design     ./mobile-src        8
# (* = active workspace)
```

### Switch workspaces

```bash
codeferry workspace use default      # Persistent switch (writes to state.json)
codeferry workspace current          # Show the active workspace name

# One-off override without changing persistent state
codeferry status -w mobile-app
codeferry diff -w default
```

### Remove a workspace

```bash
codeferry workspace remove mobile-app          # Interactive confirmation
codeferry workspace remove mobile-app --force  # Skip confirmation
codeferry workspace remove default --force     # 'default' requires --force
```

### Workspace resolution order

```
-w flag > CODEFERRY_WORKSPACE env var > state.json > "default"
```

### Auto-migration from v0.4.x

v0.4.x used a flat `.codeferry/` layout. On the first command after upgrading to v0.5.0+, your existing data is **automatically migrated** to `workspaces/default/`:

```
.codeferry/codeferry.config.json  →  .codeferry/workspaces/default/codeferry.config.json
.codeferry/registry.json          →  .codeferry/workspaces/default/registry.json
.codeferry/snapshots/             →  .codeferry/workspaces/default/snapshots/
```

Migration is idempotent — running it multiple times is safe.

---

## 19. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Optional | Enables AI semantic analysis in `codeferry diff` and `codeferry sync` |
| `CODEFERRY_WORKSPACE` | Optional | Specifies the active workspace, equivalent to passing `-w <name>` on every command |

```bash
# Temporary (current session only)
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# Permanent (add to ~/.zshrc or ~/.bashrc)
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
source ~/.zshrc

# Project-scoped (.env file — never commit this!)
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env
# codeferry reads .env automatically
```

---

## 20. Troubleshooting

### `codeferry init` fails to detect the tech stack

**Symptom:** All dimensions show "low confidence" or are empty.

**Causes and fixes:**

```bash
# Wrong directory — make sure --code points to the project root
codeferry init --design ~/design --code ~/my-project   # ✓ project root
codeferry init --design ~/design --code ~/my-project/src  # ✗ src subdir

# Missing package.json — ensure the code directory has one
ls ~/my-project/package.json   # must exist

# Skip detection and set manually
codeferry init --skip-detect
# Then edit .codeferry/codeferry.config.json directly
```

### `codeferry diff` reports no changes after I updated the design

**Cause 1 — Snapshot not yet taken:**

```bash
codeferry snapshot   # Take an initial baseline first
codeferry diff       # Now changes will show up
```

**Cause 2 — Files are excluded:**

Check if the changed design file matches your `include` glob:

```bash
# In codeferry.config.json, design.include is usually:
"include": ["**/*.jsx", "**/*.tsx"]
# Make sure your file extension matches
```

**Cause 3 — Design file is outside the `design.root`:**

```bash
cat .codeferry/codeferry.config.json | grep "root"
# Confirm the design root is correct
```

### Auto-mapping points to API router instead of page component

**Symptom:** `GalleryPage` maps to `src/server/api/routers/gallery.ts` instead of `src/app/(dashboard)/gallery/page.tsx`.

**Fix:**

```bash
codeferry map set "other-pages.jsx::GalleryPage" "src/app/(dashboard)/gallery/page.tsx"
```

**Why it happens:** The filename similarity strategy scores `gallery.ts` and `gallery/page.tsx` similarly. App Router's nested `(route-groups)` reduce the score further. This is a known limitation being improved in v0.6.0.

### `codeferry sync` clipboard output is empty

**Symptom:** The clipboard command runs but nothing is pasted.

**Fix:**

```bash
# Write to a file instead
codeferry sync --to code --out ./prompts/
# Then open the .md file manually
```

### `codeferry snapshot --after-sync` updates 0 components

**Symptom:** The output says "0 components updated".

**Cause:** `codeferry sync` marks components as `in-progress`, but if you ran `codeferry snapshot` (without `--after-sync`) before this, it already cleared the queue.

**Fix:**

```bash
# Use --component to force-update the specific component
codeferry snapshot --component "extras.jsx::AccountPage"
```

### Component extracted with wrong line ranges

**Symptom:** `AccountPage` shows lines 3–120 but the actual component ends at line 162.

**Cause:** The extractor uses brace-depth counting. Deeply nested conditional blocks (e.g., a modal with many nested divs) can confuse the boundary detection.

**Fix:** Check if the design JSX has mismatched braces. The extractor is reliable for standard Claude Design output, but unusual patterns (e.g., commented-out closing braces) can throw it off.

---

## 21. FAQ

**Q: Does codeferry modify my code files directly?**  
A: No. codeferry only generates Markdown prompt files. All actual code changes are performed by Claude Code or Claude Design when you paste the prompt. codeferry is a "prompt factory" — it never touches your source code.

**Q: Where should I run `codeferry init`?**  
A: From any directory. The `.codeferry/` folder is created in your **current working directory** (CWD). A common choice is a parent directory that sits above both your design and code directories, e.g.:

```
~/projects/             ← run codeferry init here
  design-exports/       ← --design path
  my-app/               ← --code path
  .codeferry/               ← created here
```

**Q: Can I use codeferry with a Vue or Svelte project?**  
A: Yes. The core sync engine is framework-agnostic. Stack detection supports Vue + Nuxt and Svelte + SvelteKit. The generated prompts include framework-specific conversion hints based on what was detected.

**Q: What if my design exports HTML files alongside JSX?**  
A: codeferry scans HTML files for `<script type="text/babel">` blocks and extracts JSX components from them. Include `**/*.html` in `design.include` to enable this.

**Q: The AI analysis keeps timing out. What should I do?**  
A: Reduce the batch size:

```json
"ai": {
  "batchSize": 2,
  "maxConcurrency": 1
}
```

Or skip AI for routine changes:

```bash
codeferry diff --no-ai
codeferry sync --to code --no-ai
```

**Q: Can multiple developers share a `.codeferry/` directory?**  
A: It's designed to be used by one developer per design↔code pair. For team use, commit `.codeferry/codeferry.config.json` and `.codeferry/registry.json` to source control (they're stable state), but add `.codeferry/queue.json` and `.codeferry/snapshots/` to `.gitignore` (they're ephemeral state).

**Q: How do I update codeferry?**  
A: `npm update -g codeferry` or `pnpm update -g codeferry`.

**Q: What happens when Claude Design exports and overwrites all files?**  
A: codeferry detects file-level hash changes first (fast path), then re-extracts only the components that actually changed. Even if Claude Design rewrites 20 JSX files, only the components with genuine content changes will appear in `codeferry diff` output. This avoids false positives from Claude Design's full-directory export.

**Q: Can I run codeferry in CI?**  
A: Yes, for drift detection (not sync). Use `--format json` for reliable machine-readable output:

```bash
# Structured JSON output — easy to parse in CI scripts
codeferry diff --no-ai --format json | jq '.summary'

# Example: fail the build if any actionable drift is detected
SUMMARY=$(codeferry diff --no-ai --format json | jq '.summary')
DRIFT=$(echo "$SUMMARY" | jq '.designAhead + .codeAhead + .conflicts')
if [ "$DRIFT" -gt 0 ]; then
  echo "Drift detected ($DRIFT component(s) need syncing). Run codeferry sync to resolve."
  exit 1
fi
```

JSON output shape:

```json
{
  "summary": {
    "synced": 48,
    "designAhead": 1,
    "codeAhead": 0,
    "conflicts": 0,
    "neverSynced": 0,
    "newDesign": 2,
    "newCode": 0
  },
  "components": [
    {
      "id": "extras.jsx::AccountPage",
      "name": "AccountPage",
      "status": "design-ahead",
      "designFile": "extras.jsx",
      "codeFiles": ["src/app/(dashboard)/account/page.tsx"],
      "designDiff": "--- baseline@abc12345\n+++ current\n@@ -10,6 +10,7 @@\n ...",
      "codeDiff": null
    }
  ]
}
```

> `--ci` (non-zero exit on drift) is planned for v0.8.0. For now use the `jq` pattern above.

---

*← Back to [README](../README.md) · See also: [Architecture](./ARCHITECTURE.md) · [Roadmap](../ROADMAP.md)*
