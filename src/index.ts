import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { mapListCommand, mapAutoCommand, mapSetCommand, mapUnsetCommand, mapSuggestCommand } from './commands/map.js';
import { statusCommand } from './commands/status.js';
import { diffCommand } from './commands/diff.js';
import { syncCommand } from './commands/sync.js';
import { snapshotCommand } from './commands/snapshot.js';
import { logCommand } from './commands/log.js';
import {
  workspaceListCommand,
  workspaceCurrentCommand,
  workspaceUseCommand,
  workspaceCreateCommand,
  workspaceRemoveCommand,
} from './commands/workspace.js';
import type { ComponentSyncStatus } from './types/index.js';

const program = new Command();

program
  .name('codeferry')
  .description('CLI tool for bidirectional sync between Claude Design and Claude Code')
  .version('0.7.0')
  .option('-w, --workspace <name>', '指定工作区（覆盖 state.json 中的当前工作区）');

// ── codeferry init ───────────────────────────────────────────────────────────────

program
  .command('init')
  .description('初始化 codeferry，创建工作区目录和初始快照')
  .requiredOption('--design <path>', '设计稿根目录路径')
  .requiredOption('--code <path>', '代码项目根目录路径')
  .option('--force', '强制重新初始化', false)
  .option('--skip-detect', '跳过技术栈自动检测', false)
  .action(async (opts) => {
    const globalOpts = program.opts();
    try {
      await initCommand({ ...opts, workspace: globalOpts.workspace });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── codeferry map ────────────────────────────────────────────────────────────────

const mapCmd = program
  .command('map')
  .description('管理设计组件与代码文件的映射关系');

mapCmd
  .command('list', { isDefault: true })
  .description('显示所有映射关系')
  .option('--unmapped', '仅显示未映射的组件', false)
  .action(async (opts) => {
    const globalOpts = program.opts();
    try {
      await mapListCommand({ ...opts, workspace: globalOpts.workspace });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

mapCmd
  .command('auto')
  .description('运行自动映射策略（文件名匹配 + 导出名匹配 + HTML bridge）')
  .action(async () => {
    const globalOpts = program.opts();
    try {
      await mapAutoCommand({ workspace: globalOpts.workspace });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

mapCmd
  .command('set <id> <path>')
  .description('手动设置组件到代码文件的映射')
  .action(async (id: string, path: string) => {
    const globalOpts = program.opts();
    try {
      await mapSetCommand(id, path, { workspace: globalOpts.workspace });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

mapCmd
  .command('unset <id>')
  .description('移除组件映射')
  .action(async (id: string) => {
    const globalOpts = program.opts();
    try {
      await mapUnsetCommand(id, { workspace: globalOpts.workspace });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

mapCmd
  .command('suggest')
  .description('AI 辅助映射：自动策略 + Claude API 推断，逐条交互确认')
  .option('--no-ai', '跳过 AI 推断，仅使用自动策略候选')
  .action(async (opts) => {
    const globalOpts = program.opts();
    try {
      await mapSuggestCommand({ noAi: !opts.ai, workspace: globalOpts.workspace });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── codeferry status ─────────────────────────────────────────────────────────────

const VALID_STATUSES: ComponentSyncStatus[] = [
  'synced', 'design-ahead', 'code-ahead', 'both-changed',
  'never-synced', 'new-design', 'new-code',
];

program
  .command('status')
  .description('查看所有组件的同步状态总览')
  .option('--refresh', '重新扫描文件系统以获取最新哈希', false)
  .option('--filter <status>', `按状态过滤：${VALID_STATUSES.join(' | ')}`)
  .action(async (opts) => {
    const globalOpts = program.opts();
    try {
      if (opts.filter && !VALID_STATUSES.includes(opts.filter)) {
        console.error(`无效的状态过滤值：${opts.filter}`);
        console.error(`有效值：${VALID_STATUSES.join(', ')}`);
        process.exit(1);
      }
      await statusCommand({
        filter: opts.filter as ComponentSyncStatus | undefined,
        refresh: opts.refresh,
        workspace: globalOpts.workspace,
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── codeferry diff ───────────────────────────────────────────────────────────────

program
  .command('diff')
  .description('扫描双目录变更并展示 diff，含 AI 语义分析（使用 --no-ai 跳过）')
  .option('--no-ai', '跳过 AI 语义分析，仅展示结构 diff')
  .option('--side <side>', '仅检测指定侧变更：design | code')
  .option('--component <name>', '仅检测指定组件')
  .option('--format <format>', '输出格式：text（默认彩色终端）或 json（机器可读，适合 CI）', 'text')
  .action(async (opts) => {
    const globalOpts = program.opts();
    if (opts.side && !['design', 'code'].includes(opts.side)) {
      console.error(`--side 只接受 "design" 或 "code"，收到：${opts.side}`);
      process.exit(1);
    }
    if (opts.format && !['text', 'json'].includes(opts.format)) {
      console.error(`--format 只接受 "text" 或 "json"，收到：${opts.format}`);
      process.exit(1);
    }
    try {
      await diffCommand({
        noAi: !opts.ai,
        side: opts.side as 'design' | 'code' | undefined,
        component: opts.component,
        format: opts.format as 'text' | 'json',
        workspace: globalOpts.workspace,
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── codeferry sync ───────────────────────────────────────────────────────────────

program
  .command('sync')
  .description('生成双向同步 Prompt（复制到剪贴板或写入文件），直接交给 Claude Code / Claude Design')
  .requiredOption('--to <target>', '同步方向：code（设计 → 代码）或 design（代码 → 设计）')
  .option('--copy', '将 Prompt 复制到剪贴板（默认行为）', false)
  .option('--out <dir>', '将 Prompt 写入指定目录（每组件一个 .md 文件）')
  .option('--component <name>', '仅为指定组件生成 Prompt')
  .option('--no-ai', '跳过 AI 语义分析，使用通用同步指引')
  .action(async (opts) => {
    const globalOpts = program.opts();
    if (!['code', 'design'].includes(opts.to)) {
      console.error(`--to 只接受 "code" 或 "design"，收到：${opts.to}`);
      process.exit(1);
    }
    try {
      await syncCommand({
        to: opts.to as 'code' | 'design',
        copy: opts.copy || !opts.out,
        out: opts.out,
        component: opts.component,
        noAi: !opts.ai,
        workspace: globalOpts.workspace,
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── codeferry snapshot ───────────────────────────────────────────────────────────

program
  .command('snapshot')
  .description('将当前双侧状态标记为新基线，闭合同步循环')
  .option('--component <name>', '只更新指定组件的基线')
  .option('--after-sync', '仅更新同步队列中 in-progress 状态的组件（codeferry sync 执行后使用）', false)
  .action(async (opts) => {
    const globalOpts = program.opts();
    try {
      await snapshotCommand({
        component: opts.component,
        afterSync: opts.afterSync,
        workspace: globalOpts.workspace,
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── codeferry log ────────────────────────────────────────────────────────────────

const VALID_QUEUE_STATUSES = ['pending', 'in-progress', 'done', 'skipped', 'conflict'];

program
  .command('log')
  .description('查看同步操作历史记录和队列状态')
  .option('--component <name>', '仅显示指定组件的记录')
  .option('--last <n>', '仅显示最新 N 条记录', (v) => parseInt(v, 10))
  .option('--status <status>', `按状态过滤：${VALID_QUEUE_STATUSES.join(' | ')}`)
  .action(async (opts) => {
    const globalOpts = program.opts();
    if (opts.status && !VALID_QUEUE_STATUSES.includes(opts.status)) {
      console.error(`无效的状态：${opts.status}`);
      console.error(`有效值：${VALID_QUEUE_STATUSES.join(', ')}`);
      process.exit(1);
    }
    try {
      await logCommand({
        component: opts.component,
        last: opts.last,
        status: opts.status,
        workspace: globalOpts.workspace,
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── codeferry workspace ──────────────────────────────────────────────────────────

const wsCmd = program
  .command('workspace')
  .alias('ws')
  .description(
    '管理多工作区（每个工作区对应一对 design+code 目录）\n' +
    '提示：也可通过 CODEFERRY_WORKSPACE 环境变量指定活跃工作区，等效于 -w 参数',
  );

wsCmd
  .command('list', { isDefault: true })
  .description('列出所有工作区')
  .action(async () => {
    try {
      await workspaceListCommand();
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

wsCmd
  .command('current')
  .description('显示当前活跃工作区名称')
  .action(async () => {
    try {
      await workspaceCurrentCommand();
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

wsCmd
  .command('use <name>')
  .description('切换当前工作区')
  .action(async (name: string) => {
    try {
      await workspaceUseCommand(name);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

wsCmd
  .command('create <name>')
  .description('创建并初始化新工作区')
  .option('--design <path>', '设计稿根目录路径')
  .option('--code <path>', '代码项目根目录路径')
  .option('--skip-detect', '跳过技术栈自动检测', false)
  .action(async (name: string, opts) => {
    try {
      await workspaceCreateCommand(name, opts);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

wsCmd
  .command('remove <name>')
  .description('删除工作区（交互式确认，default 工作区需要 --force）')
  .option('--force', '跳过确认直接删除', false)
  .action(async (name: string, opts) => {
    try {
      await workspaceRemoveCommand(name, opts);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
