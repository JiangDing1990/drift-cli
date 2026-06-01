import chalk from 'chalk';
import chokidar from 'chokidar';
import { resolveStore } from '../state/resolve-store.js';
import { refreshHashes, computeAllStatuses } from '../core/differ.js';
import { resolvePath } from '../utils/path.js';
import { statusIcon } from '../output/reporter.js';
import type { ComponentSyncStatus } from '../types/index.js';

interface WatchOptions {
  debounce?: number;
  workspace?: string;
}

function timestamp(): string {
  return chalk.gray(new Date().toLocaleTimeString());
}

function formatSummaryLine(summary: {
  synced: number;
  designAhead: number;
  codeAhead: number;
  conflicts: number;
  neverSynced: number;
}): string {
  const parts: string[] = [];
  if (summary.designAhead > 0)
    parts.push(chalk.yellow(`◐ design-ahead ${summary.designAhead}`));
  if (summary.codeAhead > 0)
    parts.push(chalk.blue(`◑ code-ahead ${summary.codeAhead}`));
  if (summary.conflicts > 0)
    parts.push(chalk.red(`⚠ conflict ${summary.conflicts}`));
  if (summary.neverSynced > 0)
    parts.push(chalk.gray(`○ never-synced ${summary.neverSynced}`));

  const actionable = summary.designAhead + summary.codeAhead + summary.conflicts + summary.neverSynced;
  if (actionable === 0) {
    return chalk.green(`✔ synced ${summary.synced}`);
  }
  return parts.join(chalk.gray(' · ')) + chalk.gray(`  (${summary.synced} synced)`);
}

export async function watchCommand(opts: WatchOptions = {}): Promise<void> {
  const debounceMs = opts.debounce ?? 800;
  const { store } = await resolveStore(opts.workspace);

  const config = await store.getConfig();
  if (!config) {
    console.error(chalk.red('配置缺失，请先运行 codeferry init'));
    process.exit(1);
  }

  const designRoot = resolvePath(config.design.root);
  const codeRoot = resolvePath(config.code.root);

  // Scan from disk on startup so the initial status reflects the real filesystem state.
  const bootRegistry = await store.getRegistry();
  const bootSnapshot = await store.getLatestSnapshot();
  if (!bootRegistry) {
    console.error(chalk.red('注册表缺失，请先运行 codeferry init'));
    process.exit(1);
  }

  const bootResult = await refreshHashes(bootRegistry, config, bootSnapshot);

  console.log();
  console.log(chalk.bold('  codeferry watch') + chalk.gray(' — design ↔ code'));
  console.log(chalk.gray(`  监听中：${designRoot}  ·  ${codeRoot}`));
  console.log(chalk.gray(`  防抖：${debounceMs}ms  ·  按 Ctrl+C 退出`));
  console.log();
  console.log(`  ${timestamp()}  ${formatSummaryLine(computeAllStatuses(bootResult.registry).summary)}`);
  console.log();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  // When a scan arrives while another is in progress, we set this flag instead
  // of discarding the event. Once the active scan finishes we run one more pass.
  let dirty = false;

  const runScan = async () => {
    running = true;
    dirty = false;
    try {
      // Reload registry and snapshot from disk before each scan so we never
      // overwrite state written by concurrent commands (snapshot --after-sync, map set, …).
      const [registry, snapshot] = await Promise.all([
        store.getRegistry(),
        store.getLatestSnapshot(),
      ]);
      if (!registry) {
        console.log(`  ${timestamp()}  ${chalk.red('注册表读取失败，跳过本次扫描')}`);
        return;
      }

      const result = await refreshHashes(registry, config, snapshot);
      const diff = computeAllStatuses(result.registry);
      const { summary, componentStatuses } = diff;

      const changedIds = [...result.designChanged, ...result.codeChanged];
      const uniqueChanged = [...new Set(changedIds)];

      console.log(`  ${timestamp()}  ${formatSummaryLine(summary)}`);

      if (uniqueChanged.length > 0) {
        for (const id of uniqueChanged) {
          const entry = result.registry.components[id];
          if (!entry) continue;
          const st: ComponentSyncStatus = componentStatuses[id] ?? 'synced';
          const icon = statusIcon(st);
          const codeFile = entry.codeFiles[0] ?? chalk.gray('(未映射)');
          console.log(
            `         ${icon}  ${chalk.bold(entry.name.padEnd(24))}  ${chalk.gray(entry.designFile)} → ${chalk.gray(codeFile)}`,
          );
        }
        console.log();
        await store.saveRegistry(result.registry);
      }
    } catch (err) {
      console.log(
        `  ${timestamp()}  ${chalk.red('扫描失败：')}${String(err).slice(0, 80)}`,
      );
    } finally {
      running = false;
      // If another file event arrived while we were scanning, run once more.
      if (dirty) {
        timer = setTimeout(() => { void runScan(); }, debounceMs);
      }
    }
  };

  const scheduleRun = () => {
    if (running) {
      // Mark dirty so the active scan triggers a follow-up pass when it finishes.
      dirty = true;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void runScan(); }, debounceMs);
  };

  const watcher = chokidar.watch([designRoot, codeRoot], {
    ignoreInitial: true,
    ignored: /(^|[/\\])\..|(node_modules)/,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  watcher.on('change', scheduleRun);
  watcher.on('add', scheduleRun);
  watcher.on('unlink', scheduleRun);

  const shutdown = () => {
    console.log();
    console.log(chalk.gray('  停止监听，再见。'));
    void watcher.close().then(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
