import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPatch } from 'diff';
import { scan } from './scanner.js';
import { extractComponents } from './extractor.js';
import { hashMultiple } from '../utils/hash.js';
import { resolvePath } from '../utils/path.js';
import type {
  ComponentEntry,
  ComponentRegistry,
  ComponentSyncStatus,
  DiffResult,
  DriftConfig,
  FullSnapshot,
} from '../types/index.js';

// ── Status computation (pure) ──────────────────────────────────────────────

/**
 * Compute the three-way sync status for a single component.
 * Uses hashes already stored in the ComponentEntry — no filesystem I/O.
 */
export function computeStatus(entry: ComponentEntry): ComponentSyncStatus {
  // No code mapping → new-design
  if (entry.codeFiles.length === 0) return 'new-design';

  // Has mapping but baseline is null → never synced
  if (entry.designHashAtSync === null || entry.codeHashAtSync === null) {
    return 'never-synced';
  }

  const designChanged = entry.designHash !== entry.designHashAtSync;
  // codeHash may be empty string when mapped but not yet read; treat as unchanged
  const codeChanged =
    entry.codeHash !== '' && entry.codeHash !== entry.codeHashAtSync;

  if (!designChanged && !codeChanged) return 'synced';
  if (designChanged && !codeChanged) return 'design-ahead';
  if (!designChanged && codeChanged) return 'code-ahead';
  return 'both-changed';
}

/**
 * Compute statuses for all components in a registry.
 * Does NOT re-scan the filesystem — works from stored hashes.
 */
export function computeAllStatuses(registry: ComponentRegistry): DiffResult {
  const componentStatuses: Record<string, ComponentSyncStatus> = {};
  const changedComponents: DiffResult['changedComponents'] = [];

  const summary: DiffResult['summary'] = {
    synced: 0,
    designAhead: 0,
    codeAhead: 0,
    conflicts: 0,
    neverSynced: 0,
    newDesign: 0,
    newCode: registry.unmappedCode.length,
  };

  for (const [id, entry] of Object.entries(registry.components)) {
    const status = computeStatus(entry);
    componentStatuses[id] = status;

    switch (status) {
      case 'synced':
        summary.synced++;
        break;
      case 'design-ahead':
        summary.designAhead++;
        changedComponents.push({ id, status });
        break;
      case 'code-ahead':
        summary.codeAhead++;
        changedComponents.push({ id, status });
        break;
      case 'both-changed':
        summary.conflicts++;
        changedComponents.push({ id, status });
        break;
      case 'never-synced':
        summary.neverSynced++;
        break;
      case 'new-design':
        summary.newDesign++;
        break;
      case 'new-code':
        // counted via unmappedCode above
        break;
    }
  }

  return { componentStatuses, changedComponents, summary };
}

// ── Full diff with filesystem scan ─────────────────────────────────────────

export interface RefreshedRegistry {
  registry: ComponentRegistry;
  /** Component IDs whose design hash changed since last scan */
  designChanged: string[];
  /** Component IDs whose code hash changed since last scan */
  codeChanged: string[];
}

/**
 * Re-scan both directories and update hashes in the registry.
 *
 * Two-pass design approach:
 *   1. File-level hash (from scanner) compared against the SNAPSHOT's file-level hash
 *      to quickly identify which design files need re-extraction.
 *      Falls back to re-extracting all files when no snapshot is available.
 *   2. Component-level hashes updated only for files that changed at the file level.
 *
 * NOTE: This function mutates `registry.components` in place and returns the same
 * object reference. Callers that need an immutable view should deep-clone first.
 */
export async function refreshHashes(
  registry: ComponentRegistry,
  config: DriftConfig,
  snapshot?: FullSnapshot | null,
): Promise<RefreshedRegistry> {
  const designRoot = resolvePath(config.design.root);
  const codeRoot = resolvePath(config.code.root);

  // Scan both sides for current file hashes
  const [designScan, codeScan] = await Promise.all([
    scan({ root: designRoot, include: config.design.include, exclude: config.design.exclude }),
    scan({ root: codeRoot, include: config.code.include, exclude: config.code.exclude }),
  ]);

  const designChanged: string[] = [];
  const codeChanged: string[] = [];

  // Group components by design file to avoid redundant re-extractions
  const designFileToComponents = new Map<string, string[]>();
  for (const [id, entry] of Object.entries(registry.components)) {
    const existing = designFileToComponents.get(entry.designFile) ?? [];
    existing.push(id);
    designFileToComponents.set(entry.designFile, existing);
  }

  // Determine which design files need re-extraction by comparing FILE-level hashes.
  // When a snapshot is available, compare current file hash against snapshot's file hash
  // (the baseline at last sync). Without a snapshot, always re-extract.
  const filesToReExtract = new Set<string>();
  for (const [file] of designFileToComponents) {
    const current = designScan.files[file];
    if (!current) continue; // file disappeared — skip

    const baselineFileHash = snapshot?.designFileHashes[file];
    if (!baselineFileHash || current.hash !== baselineFileHash) {
      filesToReExtract.add(file);
    }
  }

  // Re-extract changed design files and update component hashes
  for (const file of filesToReExtract) {
    const fullPath = join(designRoot, file);
    try {
      const result = await extractComponents(fullPath);
      result.file = file;

      const componentIds = designFileToComponents.get(file) ?? [];
      for (const id of componentIds) {
        const entry = registry.components[id];
        const freshComp = result.components.find((c) => c.name === entry.name);
        if (freshComp && freshComp.hash !== entry.designHash) {
          entry.designHash = freshComp.hash;
          entry.designStartLine = freshComp.startLine;
          entry.designEndLine = freshComp.endLine;
          designChanged.push(id);
        }
      }
    } catch {
      // keep existing hash if re-extraction fails
    }
  }

  // Refresh code hashes for all mapped components.
  // We always recompute here — per-file hash filtering isn't feasible since the registry
  // stores a combined multi-file hash, not individual file hashes.
  for (const [id, entry] of Object.entries(registry.components)) {
    if (entry.codeFiles.length === 0) continue;

    // Skip files that don't appear in the current scan (deleted files keep old hash)
    const allExist = entry.codeFiles.every((f) => codeScan.files[f] !== undefined);
    if (!allExist) continue;

    try {
      const contents = await Promise.all(
        entry.codeFiles.map((f) => readFile(join(codeRoot, f), 'utf8')),
      );
      const newHash = hashMultiple(contents);
      if (newHash !== entry.codeHash) {
        entry.codeHash = newHash;
        codeChanged.push(id);
      }
    } catch {
      // keep existing hash if read fails
    }
  }

  registry.updatedAt = Date.now();

  return { registry, designChanged, codeChanged };
}

// ── Unified diff generation ─────────────────────────────────────────────────

/**
 * Generate a unified diff string comparing baseline content against current content.
 *
 * Pure function — callers are responsible for reading file content and supplying
 * the baseline from the snapshot (ComponentSnapshot.designContent / codeContent).
 *
 * Returns an empty string when baseline and current are identical (no diff to show).
 *
 * @param baseline  Content at last sync baseline (from snapshot). Pass '' when
 *                  no baseline is available — the diff will show a full addition block.
 * @param current   Current file/component content.
 * @param label     Filename label shown in the diff header.
 * @param baselineRef  Human-readable baseline reference, e.g. "baseline@abc12345".
 */
export function generateComponentDiff(
  baseline: string,
  current: string,
  label: string,
  baselineRef: string,
): string {
  // createPatch returns a string; it's always non-empty (contains the header at minimum),
  // so we detect "no change" by checking for absence of actual diff hunks.
  const patch = createPatch(label, baseline, current, baselineRef, 'current');
  // A patch with no hunks has no lines starting with + or - (beyond the header).
  // The simplest reliable check: if baseline === current, skip.
  if (baseline === current) return '';
  return patch;
}

/**
 * Apply chalk colors to a unified diff string for terminal display.
 *
 * Color scheme:
 *   + lines (additions) → green
 *   - lines (removals)  → red
 *   @@ lines (hunk)     → cyan
 *   --- / +++ headers   → bold
 *   context lines       → gray
 */
export function colorizeUnifiedDiff(patch: string): string {
  // Import chalk lazily to keep this module free of ESM-only side effects in tests.
  // We do a synchronous require-style trick by accepting it as a string operation.
  // Actually chalk is already used as ESM — we just import it at the top of the file.
  return patch
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return `\x1b[1m${line}\x1b[0m`; // bold
      if (line.startsWith('+')) return `\x1b[32m${line}\x1b[0m`;  // green
      if (line.startsWith('-')) return `\x1b[31m${line}\x1b[0m`;  // red
      if (line.startsWith('@@')) return `\x1b[36m${line}\x1b[0m`; // cyan
      return `\x1b[90m${line}\x1b[0m`; // gray
    })
    .join('\n');
}
