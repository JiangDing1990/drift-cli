import chalk from 'chalk';
import { resolveStore } from '../state/resolve-store.js';
import { log } from '../utils/logger.js';
import type { SyncQueueItem, QueueStatus, IntentType } from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface LogOptions {
  component?: string;
  last?: number;
  status?: QueueStatus;
  workspace?: string;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const STATUS_ICON: Record<QueueStatus, string> = {
  done: chalk.green('✔'),
  'in-progress': chalk.yellow('●'),
  pending: chalk.gray('○'),
  skipped: chalk.gray('⊘'),
  conflict: chalk.red('⚠'),
};

const DIRECTION_LABEL: Record<string, string> = {
  'design-to-code': chalk.yellow('design → code'),
  'code-to-design': chalk.blue('code → design'),
};

const INTENT_LABEL: Record<IntentType, string> = {
  'feature-add': '新增功能',
  'style-change': '样式调整',
  'interaction-change': '交互变化',
  'layout-change': '布局调整',
  'refactor': '代码重构',
  'props-change': '接口变化',
  'logic-change': '逻辑变化',
  'content-change': '内容变更',
};

const IMPACT_COLOR: Record<string, (s: string) => string> = {
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.gray,
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function printItem(item: SyncQueueItem, componentName: string): void {
  const icon = STATUS_ICON[item.status];
  const dirLabel = DIRECTION_LABEL[item.direction] ?? item.direction;
  const intentLabel = item.intent
    ? INTENT_LABEL[item.intent] ?? item.intent
    : chalk.gray('—');
  const impactFn = item.impact ? (IMPACT_COLOR[item.impact] ?? chalk.gray) : chalk.gray;
  const impactStr = item.impact ? impactFn(`[${item.impact}]`) : '';

  const timeStr = item.resolvedAt
    ? chalk.gray(`${formatTime(item.createdAt)} → ${formatTime(item.resolvedAt)}`)
    : chalk.gray(formatTime(item.createdAt));

  console.log(
    `  ${icon}  ` +
    `${chalk.bold(truncate(componentName, 22).padEnd(24))}  ` +
    `${dirLabel.padEnd(26)}  ` +
    `${intentLabel.padEnd(12)}  ${impactStr.padEnd(10)}  ` +
    `${timeStr}`,
  );

  if (item.summary) {
    console.log(`       ${chalk.gray(truncate(item.summary, 80))}`);
  }
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function logCommand(opts: LogOptions = {}): Promise<void> {
  const { store } = await resolveStore(opts.workspace);

  const [queue, registry] = await Promise.all([
    store.getQueue(),
    store.getRegistry(),
  ]);

  if (!registry) {
    log.error('未找到注册表');
    process.exit(1);
  }

  let items = [...queue.items].sort((a, b) => b.createdAt - a.createdAt);

  // Apply filters — track pre-slice count for accurate pagination hint
  if (opts.component) {
    const query = opts.component.toLowerCase();
    items = items.filter((item) => {
      const entry = registry.components[item.componentId];
      return (
        item.componentId.toLowerCase().includes(query) ||
        (entry && entry.name.toLowerCase().includes(query))
      );
    });
    if (items.length === 0) {
      log.info(`无记录：组件 "${opts.component}"`);
      return;
    }
  }

  if (opts.status) {
    items = items.filter((item) => item.status === opts.status);
    if (items.length === 0) {
      log.info(`无 ${opts.status} 状态的记录`);
      return;
    }
  }

  // Record count after component/status filters but before --last truncation,
  // so the pagination hint can accurately say "showing N of M filtered results"
  const filteredTotal = items.length;

  if (opts.last !== undefined && opts.last > 0) {
    items = items.slice(0, opts.last);
  }

  if (items.length === 0) {
    console.log();
    log.info('同步队列为空 — 运行 codeferry diff 开始追踪变更');
    console.log();
    return;
  }

  // Compute stats from full queue (not filtered)
  const all = queue.items;
  const counts: Record<QueueStatus, number> = {
    done: 0, 'in-progress': 0, pending: 0, skipped: 0, conflict: 0,
  };
  for (const item of all) counts[item.status]++;

  console.log();
  console.log(chalk.bold('  codeferry log') + chalk.gray(' — 同步历史'));
  console.log();
  console.log(
    `  ${chalk.gray('队列统计：')} ` +
    `总计 ${chalk.bold(String(all.length))}  ·  ` +
    `${chalk.green(`✔ done ${counts.done}`)}  ` +
    `${chalk.yellow(`● in-progress ${counts['in-progress']}`)}  ` +
    `${chalk.gray(`○ pending ${counts.pending}`)}  ` +
    `${chalk.gray(`⊘ skipped ${counts.skipped}`)}` +
    (counts.conflict > 0 ? `  ${chalk.red(`⚠ conflict ${counts.conflict}`)}` : ''),
  );
  console.log();

  // Group by status for display
  const DISPLAY_ORDER: QueueStatus[] = ['conflict', 'in-progress', 'pending', 'done', 'skipped'];
  const grouped = new Map<QueueStatus, SyncQueueItem[]>();
  for (const status of DISPLAY_ORDER) grouped.set(status, []);
  for (const item of items) {
    grouped.get(item.status)?.push(item);
  }

  // Column header
  console.log(
    `  ${chalk.gray('  ')}  ` +
    `${chalk.gray('组件'.padEnd(24))}  ` +
    `${chalk.gray('方向'.padEnd(20))}  ` +
    `${chalk.gray('类型'.padEnd(12))}  ` +
    `${chalk.gray('影响'.padEnd(10))}  ` +
    `${chalk.gray('时间')}`,
  );
  console.log(`  ${chalk.gray('─'.repeat(100))}`);

  let printed = 0;
  for (const status of DISPLAY_ORDER) {
    const group = grouped.get(status) ?? [];
    if (group.length === 0) continue;

    // Use the raw key for toUpperCase to avoid corrupting ANSI escape codes
    // (chalk.green('done').toUpperCase() turns '\x1b[32m' → '\x1b[32M', which breaks terminals)
    const sectionHeading = status.toUpperCase().replace(/-/g, ' ');
    console.log();
    console.log(
      `  ${STATUS_ICON[status]}  ${chalk.bold(sectionHeading)} ` +
      `${chalk.gray(`(${group.length})`)}`,
    );
    console.log();

    for (const item of group) {
      const entry = registry.components[item.componentId];
      const componentName = entry?.name ?? item.componentId;
      printItem(item, componentName);
      printed++;
    }
  }

  console.log();

  if (opts.last !== undefined && filteredTotal > opts.last) {
    const scope = (opts.component || opts.status) ? '筛选结果' : '记录';
    log.dim(`  仅显示最新 ${opts.last} 条，共 ${filteredTotal} 条${scope}`);
  }

  // Actionable hints
  const pendingCount = counts.pending;
  const inProgressCount = counts['in-progress'];

  if (inProgressCount > 0) {
    log.info(`${inProgressCount} 个组件同步中 — 应用 Prompt 后运行 ${chalk.bold('codeferry snapshot --after-sync')}`);
  }
  if (pendingCount > 0) {
    log.info(`${pendingCount} 个组件等待处理 — 运行 ${chalk.bold('codeferry sync --to code')} 生成 Prompt`);
  }
  if (printed > 0) console.log();
}
