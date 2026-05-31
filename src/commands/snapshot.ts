import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { resolveStore } from '../state/resolve-store.js';
import type { StateStore } from '../state/store.js';
import { scan } from '../core/scanner.js';
import { extractComponents } from '../core/extractor.js';
import { hashMultiple } from '../utils/hash.js';
import { resolvePath } from '../utils/path.js';
import { log } from '../utils/logger.js';
import { spinner } from '../output/reporter.js';
import type { ComponentEntry, ComponentRegistry, DriftConfig, FullSnapshot, SyncQueue } from '../types/index.js';

interface SnapshotOptions {
  component?: string;
  afterSync?: boolean;
  workspace?: string;
}

// ── Baseline update logic ────────────────────────────────────────────────────

/**
 * Refresh all component hashes from the filesystem, then mark them as the new baseline.
 * This "closes the sync loop": after a drift sync prompt has been applied, running
 * `drift snapshot` anchors both sides' current state so future diffs detect only new changes.
 *
 * Safety check: warns if a component had pending changes before re-reading but still
 * shows no change — which likely means the user ran `snapshot` before applying the sync.
 *
 * Design files are re-extracted once per file (not once per component) to avoid
 * O(N×1) redundant I/O when multiple components share the same JSX file.
 */
async function updateBaselines(
  registry: ComponentRegistry,
  config: DriftConfig,
  filter?: (entry: ComponentEntry) => boolean,
): Promise<{ updated: number; skipped: number; warned: number }> {
  const designRoot = resolvePath(config.design.root);
  const codeRoot = resolvePath(config.code.root);

  let updated = 0;
  let skipped = 0;
  let warned = 0;

  // Collect entries to process
  const toProcess = Object.values(registry.components).filter((entry) => {
    if (filter && !filter(entry)) return false;
    if (entry.codeFiles.length === 0) {
      skipped++;
      return false;
    }
    return true;
  });

  // Group by design file to extract each file at most once
  const fileToEntries = new Map<string, ComponentEntry[]>();
  for (const entry of toProcess) {
    const list = fileToEntries.get(entry.designFile) ?? [];
    list.push(entry);
    fileToEntries.set(entry.designFile, list);
  }

  // Re-extract design files and update per-component hashes
  const freshDesignHashes = new Map<string, string>(); // componentId → fresh hash
  for (const [file, entries] of fileToEntries) {
    try {
      const result = await extractComponents(join(designRoot, file));
      for (const entry of entries) {
        const freshComp = result.components.find((c) => c.name === entry.name);
        if (freshComp) {
          freshDesignHashes.set(entry.id, freshComp.hash);
          // Update line positions while we have fresh data
          entry.designStartLine = freshComp.startLine;
          entry.designEndLine = freshComp.endLine;
        }
      }
    } catch {
      // keep existing hashes if extraction fails
    }
  }

  // Re-read code files and apply baseline updates
  for (const entry of toProcess) {
    const freshDesignHash = freshDesignHashes.get(entry.id) ?? entry.designHash;

    let freshCodeHash = entry.codeHash;
    try {
      const contents = await Promise.all(
        entry.codeFiles.map((f) => readFile(join(codeRoot, f), 'utf8')),
      );
      freshCodeHash = hashMultiple(contents);
    } catch {
      // keep existing code hash
    }

    // Detect whether this component had pending changes BEFORE this re-read.
    // Only warn if there were changes that apparently haven't been applied yet.
    const hadPendingChange =
      entry.designHashAtSync !== null && (
        entry.designHash !== entry.designHashAtSync ||
        entry.codeHash !== entry.codeHashAtSync
      );

    const designUnchanged = freshDesignHash === entry.designHashAtSync;
    const codeUnchanged = freshCodeHash === entry.codeHashAtSync;

    if (hadPendingChange && designUnchanged && codeUnchanged) {
      // Had changes but neither side moved — user may have snapshot'd too early
      log.warn(`${chalk.bold(entry.name)}: 两侧 hash 未变化 — 确认同步已应用后再运行 snapshot`);
      warned++;
      continue;
    }

    // Check if baseline actually needs updating (skip silently for already-synced components)
    const baselineChanged =
      entry.designHashAtSync !== freshDesignHash ||
      entry.codeHashAtSync !== freshCodeHash;

    if (!baselineChanged) continue; // already up-to-date, no action needed

    // Update baseline
    entry.designHash = freshDesignHash;
    entry.codeHash = freshCodeHash;
    entry.designHashAtSync = freshDesignHash;
    entry.codeHashAtSync = freshCodeHash;
    entry.lastSyncedAt = Date.now();

    updated++;
  }

  return { updated, skipped, warned };
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function snapshotCommand(opts: SnapshotOptions = {}): Promise<void> {
  const { store } = await resolveStore(opts.workspace);

  const [config, registry, queue] = await Promise.all([
    store.getConfig(),
    store.getRegistry(),
    store.getQueue(),
  ]);

  if (!config || !registry) {
    log.error('配置或注册表缺失，请重新运行 drift init');
    process.exit(1);
  }

  // Build filter based on options
  let filter: ((entry: ComponentEntry) => boolean) | undefined;

  if (opts.component) {
    const query = opts.component.toLowerCase();
    filter = (entry) =>
      entry.name.toLowerCase() === query ||
      entry.id.toLowerCase().includes(query);

    const matched = Object.values(registry.components).filter(filter);
    if (matched.length === 0) {
      log.error(`未找到组件：${opts.component}`);
      process.exit(1);
    }
  } else if (opts.afterSync) {
    // Only process components that are currently "in-progress" in the sync queue
    const inProgressIds = new Set(
      queue.items
        .filter((item) => item.status === 'in-progress')
        .map((item) => item.componentId),
    );

    if (inProgressIds.size === 0) {
      log.warn('同步队列中没有进行中（in-progress）的组件');
      log.dim('  请先运行 drift sync 生成并发送同步 Prompt');
      return;
    }

    filter = (entry) => inProgressIds.has(entry.id);
    log.info(`--after-sync: 仅更新 ${inProgressIds.size} 个进行中的组件基线`);
  }

  const targetDesc = opts.component
    ? `组件 "${opts.component}"`
    : opts.afterSync
      ? '进行中（in-progress）的组件'
      : '所有已映射组件';

  const s = spinner(`正在更新 ${targetDesc} 的基线快照...`);
  s.start();

  let stats;
  try {
    stats = await updateBaselines(registry, config, filter);
  } catch (err) {
    s.fail('快照更新失败');
    log.error(String(err));
    process.exit(1);
  }

  if (stats.warned > 0) {
    s.warn(`基线更新完成（${stats.updated} 个更新，${stats.warned} 个警告，${stats.skipped} 个跳过）`);
  } else {
    s.succeed(`基线更新完成：${stats.updated} 个组件`);
  }

  if (stats.skipped > 0) {
    log.dim(`  ${stats.skipped} 个未映射组件已跳过（无代码文件）`);
  }

  if (stats.updated === 0 && stats.warned === 0) {
    log.info('无需更新：所有组件基线已是最新状态');
    return;
  }

  // Save updated registry
  registry.updatedAt = Date.now();
  await store.saveRegistry(registry);

  // Create new snapshot record capturing current file-level hashes
  const designRoot = resolvePath(config.design.root);
  const codeRoot = resolvePath(config.code.root);

  const [designScan, codeScan] = await Promise.all([
    scan({ root: designRoot, include: config.design.include, exclude: config.design.exclude }),
    scan({ root: codeRoot, include: config.code.include, exclude: config.code.exclude }),
  ]);

  const snapshotId = `snap_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const snapshot: FullSnapshot = {
    id: snapshotId,
    capturedAt: Date.now(),
    components: {},
    designFileHashes: Object.fromEntries(
      Object.entries(designScan.files).map(([k, v]) => [k, v.hash]),
    ),
    codeFileHashes: Object.fromEntries(
      Object.entries(codeScan.files).map(([k, v]) => [k, v.hash]),
    ),
  };

  for (const [id, entry] of Object.entries(registry.components)) {
    const designFileInfo = designScan.files[entry.designFile];
    const codeMtime = entry.codeFiles.reduce((max, f) => {
      const fi = codeScan.files[f];
      return fi ? Math.max(max, fi.mtime) : max;
    }, 0);

    snapshot.components[id] = {
      designHash: entry.designHash,
      codeHash: entry.codeHash,
      designMtime: designFileInfo?.mtime ?? 0,
      codeMtime,
    };
  }

  await store.saveSnapshot(snapshot);

  log.success(`快照已保存：${chalk.gray(snapshotId)}`);
  log.dim('  状态已锁定为 synced 基线，下次 drift diff 将从此处开始比较');

  // If --after-sync: mark in-progress queue items as done
  if (opts.afterSync) {
    // Collect the IDs that were actually processed by updateBaselines in this run.
    // These are the in-progress components from the queue (the same set used to build the filter).
    const inProgressIds = new Set(
      queue.items
        .filter((item) => item.status === 'in-progress')
        .map((item) => item.componentId),
    );
    await markQueueItemsDone(store, queue, inProgressIds);
  }
}

/**
 * Mark "in-progress" queue items as "done" for the given set of component IDs.
 * Only marks items that belong to components explicitly updated in this snapshot run.
 */
async function markQueueItemsDone(
  store: StateStore,
  queue: SyncQueue,
  updatedIds: Set<string>,
): Promise<void> {
  let marked = 0;
  const now = Date.now();

  for (const item of queue.items) {
    if (item.status === 'in-progress' && updatedIds.has(item.componentId)) {
      item.status = 'done';
      item.resolvedAt = now;
      marked++;
    }
  }

  if (marked > 0) {
    queue.updatedAt = now;
    await store.saveQueue(queue);
    log.success(`同步队列已更新：${marked} 个组件标记为 done`);
  }
}
