# Contributing to drift-cli

Thank you for your interest in contributing! This document covers how to get started.

## Development Setup

```bash
git clone https://github.com/JiangDing1990/drift-cli.git
cd drift-cli
pnpm install
pnpm run build
```

## Project Structure

```
src/
├── commands/       # CLI command implementations (init, diff, sync, …)
├── core/           # Core logic (extractor, scanner, mapper, differ, analyzer)
├── output/         # Terminal UI and prompt generation
├── state/          # .drift/ directory management (StateStore)
├── types/          # Shared TypeScript types
└── utils/          # hash, path, logger helpers

tests/              # Vitest unit tests
docs/               # Architecture and design documents
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for a full breakdown of the module design.

## Development Workflow

```bash
pnpm run dev        # Build in watch mode
pnpm run test       # Run tests in watch mode
pnpm run test:run   # Run all tests once
pnpm run lint       # TypeScript type check (0 errors expected)
pnpm run build      # Production build
```

All commands should pass before submitting a PR:

```bash
pnpm run lint && pnpm run test:run && pnpm run build
```

## Submitting Changes

1. **Open an issue first** for any non-trivial change — it helps align on approach before implementation.
2. Fork the repo and create a branch from `main`.
3. Make your changes with tests where applicable.
4. Ensure `pnpm run lint && pnpm run test:run` passes.
5. Open a pull request with a clear description of what changed and why.

## Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add drift config command
fix: correct direction routing in prompt builder
docs: update README installation steps
chore: remove unused zod dependency
test: add edge case coverage for extractor
```

## Reporting Bugs

Please open an issue at [github.com/JiangDing1990/drift-cli/issues](https://github.com/JiangDing1990/drift-cli/issues) with:

- drift-cli version (`drift --version`)
- Node.js version (`node --version`)
- Steps to reproduce
- Expected vs actual behaviour

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
