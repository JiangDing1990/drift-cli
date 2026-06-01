# Roadmap

This document outlines the planned development path for codeferry. Priorities may shift based on user feedback.

For completed work, see [CHANGELOG.md](./CHANGELOG.md).
For architecture details, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## Current Status: v0.7.0 — Diff Quality

All phases are fully implemented and tested (115 unit tests, 0 TypeScript errors):

| Phase | Status | Highlights |
|---|---|---|
| Phase 1 — Foundation | ✅ Done | `codeferry init`, StateStore, Scanner, Extractor, snapshot system |
| Phase 2 — Mapping & Diff | ✅ Done | Mapper (2 strategies), StackDetector, Differ (7 states), `codeferry status` |
| Phase 3 — AI + Prompts | ✅ Done | Analyzer (Claude API), PromptBuilder (bidirectional), `codeferry sync`, queue |
| Phase 4 — Polish | ✅ Done | `codeferry log`, large-file truncation, test coverage, bug fixes |
| Phase 5 — Multi-Workspace | ✅ Done | `codeferry workspace`, WorkspaceManager, auto-migration, `-w` global flag |
| Phase 6 — Mapping Accuracy | ✅ Done | HTML Bridge strategy, AI-assisted fallback, `codeferry map suggest`, threshold config |
| Phase 7 — Diff Quality | ✅ Done | Snapshot content storage, colored unified diff, `--format json` CI output |

---

## Upcoming

---

### v0.8.0 — Editor & CI Integration

**Goal:** Meet developers where they already work.

- [ ] VS Code extension — status bar indicator, right-click context menu for `codeferry sync`
- [ ] GitHub Actions workflow template — run `codeferry diff` in CI and post a comment with sync status
- [ ] `codeferry diff --ci` — exits with non-zero status when actionable changes are detected (for CI gates)
- [ ] Watch mode — `drift watch` for continuous background monitoring

---

### v1.0.0 — Stable API

**Goal:** Signal production-readiness and API stability.

- [ ] Stable CLI interface (no more breaking flag changes)
- [ ] End-to-end integration tests using fixture design + code directories
- [ ] Plugin API for custom mapping strategies
- [ ] Full documentation site (VitePress or Docusaurus)
- [ ] `drift migrate` — migrate `.drift/` state between codeferry major versions

---

## Ideas Under Consideration

These are not yet scheduled but may be picked up based on demand:

- **Figma / Sketch bridge** — export design tokens from design tools into the snapshot system
- **Merge prompt improvements** — smarter conflict resolution that generates both-sides-aware instructions
- **`codeferry undo`** — revert the last snapshot (restore previous baseline)
- **Telemetry (opt-in)** — anonymous usage stats to prioritize features

---

## Contributing

Issues and PRs are welcome. Before submitting a large feature, please open an issue to discuss the approach.

For architecture context, read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).
