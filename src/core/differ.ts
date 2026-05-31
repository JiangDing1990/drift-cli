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
 * Generate a unified diff string for a component between its baseline and current content.
 *
 * LIMITATION: The design side "baseline" is synthesised from the stored hash string
 * (not real content) because codeferry does not cache component content across snapshots.
 * This produces a cosmetically correct but not text-diff-accurate output.
 * Real content diffing will be added in Phase 3 when PromptBuilder stores content.
 */
export async function generateComponentDiff(
  entry: ComponentEntry,
  config: DriftConfig,
  direction: 'design' | 'code',
): Promise<string> {
  if (direction === 'design') {
    const fullPath = join(resolvePath(config.design.root), entry.designFile);
    try {
      const content = await readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      const current = lines.slice(entry.designStartLine - 1, entry.designEndLine).join('\n');
      // We don't have stored baseline content — use a placeholder so callers get
      // the current content in the diff output while the baseline shows as empty.
      const baseline = '';
      return createPatch(
        `${entry.designFile} [${entry.name}]`,
        baseline,
        current,
        `baseline@${entry.designHashAtSync?.slice(0, 8) ?? 'never'}`,
        'current',
      );
    } catch {
      return '';
    }
  }

  // code direction
  if (entry.codeFiles.length === 0) return '';
  try {
    const codeRoot = resolvePath(config.code.root);
    const contents = await Promise.all(
      entry.codeFiles.map((f) => readFile(join(codeRoot, f), 'utf8').catch(() => '')),
    );
    const current = contents.join('\n\n// ---\n\n');
    const baseline = '';
    return createPatch(
      entry.codeFiles.join(', '),
      baseline,
      current,
      `baseline@${entry.codeHashAtSync?.slice(0, 8) ?? 'never'}`,
      'current',
    );
  } catch {
    return '';
  }
}
