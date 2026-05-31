import chalk from 'chalk';
import { computeAllStatuses, refreshHashes } from '../core/differ.js';
import { resolveStore } from '../state/resolve-store.js';
import { log } from '../utils/logger.js';
import { spinner, statusIcon } from '../output/reporter.js';
import type { ComponentEntry, ComponentSyncStatus, DiffResult } from '../types/index.js';

interface StatusOptions {
  filter?: ComponentSyncStatus;
  refresh?: boolean;
  workspace?: string;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function statusBadge(status: ComponentSyncStatus, count: number): string {
  const icon = statusIcon(status);
  const labels: Record<ComponentSyncStatus, string> = {
    synced: 'synced',
    'design-ahead': 'design-ahead',
    'code-ahead': 'code-ahead',
    'both-changed': 'conflict',
    'never-synced': 'never-synced',
    'new-design': 'new-design',
    'new-code': 'new-code',
  };
  return `${icon} ${chalk.bold(labels[status])} ${chalk.bold(String(count))}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Filter components from the registry by a given sync status. */
function byStatus(
  result: DiffResult,
  registry: { components: Record<string, ComponentEntry> },
  status: ComponentSyncStatus,
): ComponentEntry[] {
  return Object.entries(result.componentStatuses)
    .filter(([, s]) => s === status)
    .map(([id]) => registry.components[id])
    .filter((e): e is ComponentEntry => e !== undefined);
}

function printSummaryLine(summary: DiffResult['summary']): void {
  const total =
    summary.synced + summary.designAhead + summary.codeAhead +
    summary.conflicts + summary.neverSynced + summary.newDesign;
  const mapped = total - summary.newDesign;

  console.log();
  console.log(chalk.bold('  drift status') + chalk.gray(' — design ↔ code'));
  console.log();
  console.log(
    `  ${chalk.gray('Totals:')} ${chalk.bold(String(mapped))} mapped · ` +
    `${chalk.bold(String(summary.newDesign))} unmapped design · ` +
    `${chalk.bold(String(summary.newCode))} unmapped code`,
  );
  console.log();

  const badges = [
    statusBadge('synced', summary.synced),
    statusBadge('design-ahead', summary.designAhead),
    statusBadge('code-ahead', summary.codeAhead),
    statusBadge('both-changed', summary.conflicts),
    statusBadge('never-synced', summary.neverSynced),
  ].join(chalk.gray('  ·  '));

  console.log(`  ${badges}`);
  console.log();
}

function printChangedSection(
  sectionStatus: ComponentSyncStatus,
  heading: string,
  components: ComponentEntry[],
): void {
  if (components.length === 0) return;

  const icon = statusIcon(sectionStatus);
  console.log(chalk.bold(`  ${icon} ${heading}`));

  for (const c of components) {
    const design = truncate(c.designFile, 24);
    const code = c.codeFiles.length > 0
      ? truncate(c.codeFiles[0], 28)
      : chalk.gray('(未映射)');
    console.log(`    ${chalk.bold(truncate(c.name, 20).padEnd(22))}  ${chalk.gray(design)} → ${chalk.gray(code)}`);
  }
  console.log();
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function statusCommand(opts: StatusOptions = {}): Promise<void> {
  const { store, workspaceName } = await resolveStore(opts.workspace);

  const [config, registry, snapshot] = await Promise.all([
    store.getConfig(),
    store.getRegistry(),
    store.getLatestSnapshot(),
  ]);

  if (!registry) {
    log.error('未找到注册表，请先运行 codeferry init');
    process.exit(1);
  }

  // Optionally refresh hashes from filesystem
  let currentRegistry = registry;
  if (opts.refresh && config) {
    const s = spinner('正在扫描双目录变更...');
    s.start();
    try {
      // Pass snapshot so design-file change detection compares against the correct baseline
      const { registry: refreshed, designChanged, codeChanged } = await refreshHashes(
        registry,
        config,
        snapshot,
      );
      currentRegistry = refreshed;
      s.succeed(
        `扫描完成：${designChanged.length} 个设计组件变更，${codeChanged.length} 个代码组件变更`,
      );
      await store.saveRegistry(currentRegistry);
    } catch (err) {
      s.fail('扫描失败');
      log.warn(String(err));
    }
  } else if (!opts.refresh) {
    log.dim('  提示：使用 --refresh 参数重新扫描文件系统以获取最新状态');
  }

  const diffResult = computeAllStatuses(currentRegistry);
  const { summary } = diffResult;

  printSummaryLine(summary);

  // Apply filter if provided
  const filterStatus = opts.filter;
  if (filterStatus) {
    const filtered = byStatus(diffResult, currentRegistry, filterStatus);
    if (filtered.length === 0) {
      log.info(`无 ${filterStatus} 状态的组件`);
    } else {
      printChangedSection(filterStatus, `${filterStatus.toUpperCase()} (${filtered.length})`, filtered);
    }
    return;
  }

  // Print all sections
  const conflicts = byStatus(diffResult, currentRegistry, 'both-changed');
  printChangedSection('both-changed', `CONFLICTS (${conflicts.length})`, conflicts);

  const designAhead = byStatus(diffResult, currentRegistry, 'design-ahead');
  printChangedSection('design-ahead', `DESIGN AHEAD → code (${designAhead.length})`, designAhead);

  const codeAhead = byStatus(diffResult, currentRegistry, 'code-ahead');
  printChangedSection('code-ahead', `CODE AHEAD → design (${codeAhead.length})`, codeAhead);

  const neverSynced = byStatus(diffResult, currentRegistry, 'never-synced');
  if (neverSynced.length > 0) {
    const icon = statusIcon('never-synced');
    console.log(chalk.bold(`  ${icon} NEVER SYNCED (${neverSynced.length})`));
    for (const c of neverSynced) {
      const code = c.codeFiles.length > 0
        ? chalk.gray(truncate(c.codeFiles[0], 28))
        : chalk.gray('(未映射)');
      console.log(`    ${chalk.bold(truncate(c.name, 20).padEnd(22))}  ${code}`);
    }
    console.log();
  }

  // Unmapped design components
  const newDesign = Object.values(currentRegistry.components).filter(
    (e) => e.codeFiles.length === 0,
  );
  if (newDesign.length > 0) {
    const icon = statusIcon('new-design');
    console.log(chalk.bold(`  ${icon} NEW DESIGN (${newDesign.length}) — 未映射到代码文件`));
    for (const c of newDesign.slice(0, 10)) {
      console.log(`    ${chalk.bold(truncate(c.name, 20))}  ${chalk.gray(c.designFile)}`);
    }
    if (newDesign.length > 10) log.dim(`    ... 还有 ${newDesign.length - 10} 个`);
    console.log();
    log.info(
      `运行 ${chalk.bold('drift map auto')} 自动建立映射，` +
      `或 ${chalk.bold('drift map set <id> <path>')} 手动指定`,
    );
  }

  // All clear
  if (
    conflicts.length === 0 &&
    designAhead.length === 0 &&
    codeAhead.length === 0 &&
    neverSynced.length === 0 &&
    newDesign.length === 0
  ) {
    console.log(`  ${statusIcon('synced')} ${chalk.green('全部同步，无需操作')}`);
    console.log();
  }
}
