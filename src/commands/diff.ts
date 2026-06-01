import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { resolveStore } from '../state/resolve-store.js';
import {
  computeAllStatuses,
  refreshHashes,
  generateComponentDiff,
  colorizeUnifiedDiff,
} from '../core/differ.js';
import { analyzeComponents } from '../core/analyzer.js';
import { resolvePath } from '../utils/path.js';
import { log } from '../utils/logger.js';
import { spinner, statusIcon, statusLabel } from '../output/reporter.js';
import type {
  ComponentEntry,
  ComponentSyncStatus,
  SyncQueueItem,
  AIAnalysisResult,
  DiffResult,
  IntentType,
} from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface DiffOptions {
  noAi?: boolean;
  side?: 'design' | 'code';
  component?: string;
  format?: 'text' | 'json';
  workspace?: string;
}

/** Shape of the --format json output. */
interface DiffJsonOutput {
  summary: DiffResult['summary'];
  components: Array<{
    id: string;
    name: string;
    status: ComponentSyncStatus;
    designFile: string;
    codeFiles: string[];
    /** Unified diff text (uncolored). null when no diff is available. */
    designDiff: string | null;
    /** Unified diff text (uncolored). null when no diff is available. */
    codeDiff: string | null;
  }>;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const STATUS_HEADING: Partial<Record<ComponentSyncStatus, string>> = {
  'design-ahead': 'DESIGN AHEAD',
  'code-ahead': 'CODE AHEAD',
  'both-changed': 'CONFLICT',
  'never-synced': 'NEVER SYNCED',
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

const IMPACT_COLOR: Record<'high' | 'medium' | 'low', (s: string) => string> = {
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.gray,
};

function printComponentHeader(entry: ComponentEntry, status: ComponentSyncStatus): void {
  const icon = statusIcon(status);
  const label = statusLabel(status);
  const heading = STATUS_HEADING[status] ?? status.toUpperCase();
  console.log(
    `\n${chalk.bold(`  ${icon} ${heading}`)}  ` +
    `${chalk.bold(entry.name)}  ${chalk.gray(`(${label})`)}`,
  );
  console.log(
    `  ${chalk.gray('design:')} ${entry.designFile}` +
    `:${entry.designStartLine}-${entry.designEndLine}`,
  );
  if (entry.codeFiles.length > 0) {
    console.log(`  ${chalk.gray('code:')}   ${entry.codeFiles.join(', ')}`);
  }
  console.log();
}

function printAiAnalysis(analysis: AIAnalysisResult): void {
  const intentLabel = INTENT_LABEL[analysis.intent] ?? analysis.intent;
  const impactFn = IMPACT_COLOR[analysis.impact] ?? chalk.gray;

  console.log(`  ${chalk.bold('AI 分析：')}`);
  console.log(`    ${chalk.cyan('变更类型：')} ${intentLabel}  ${impactFn(`[${analysis.impact}]`)}`);
  console.log(`    ${chalk.cyan('摘要：')}     ${analysis.summary}`);

  if (analysis.syncGuide && analysis.syncGuide.length > 0) {
    console.log(`    ${chalk.cyan('同步建议：')}`);
    for (const step of analysis.syncGuide.slice(0, 3)) {
      console.log(`      ${chalk.gray('•')} ${step}`);
    }
    if (analysis.syncGuide.length > 3) {
      log.dim(`      ... 还有 ${analysis.syncGuide.length - 3} 条建议（见 codeferry sync 生成的 prompt）`);
    }
  }

  if (analysis.analysisNote) {
    log.dim(`    注：${analysis.analysisNote}`);
  }
  console.log();
}

// ── Content readers ──────────────────────────────────────────────────────────

async function readDesignContent(entry: ComponentEntry, designRoot: string): Promise<string> {
  try {
    const content = await readFile(join(designRoot, entry.designFile), 'utf8');
    const lines = content.split('\n');
    return lines.slice(entry.designStartLine - 1, entry.designEndLine).join('\n');
  } catch {
    return '';
  }
}

async function readCodeContent(entry: ComponentEntry, codeRoot: string): Promise<string> {
  if (entry.codeFiles.length === 0) return '';
  try {
    const contents = await Promise.all(
      entry.codeFiles.map((f) => readFile(join(codeRoot, f), 'utf8').catch(() => '')),
    );
    return contents.filter(Boolean).join('\n\n// ── next file ──\n\n');
  } catch {
    return '';
  }
}

// ── Queue helpers ────────────────────────────────────────────────────────────

function makeQueueId(componentId: string): string {
  const ts = Date.now().toString(36);
  const safe = componentId.replace(/[^a-z0-9]/gi, '_').slice(0, 20);
  return `diff_${safe}_${ts}`;
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function diffCommand(opts: DiffOptions = {}): Promise<void> {
  const isJson = opts.format === 'json';
  const { store } = await resolveStore(opts.workspace);

  const [config, registry, snapshot, queue] = await Promise.all([
    store.getConfig(),
    store.getRegistry(),
    store.getLatestSnapshot(),
    store.getQueue(),
  ]);

  if (!config || !registry) {
    log.error('配置或注册表缺失，请重新运行 codeferry init');
    process.exit(1);
  }

  // Step 1: Refresh hashes by scanning both directories
  // In JSON mode suppress the spinner so stdout stays clean for piping
  const scanSpinner = isJson ? null : spinner('正在扫描双目录变更...');
  scanSpinner?.start();

  let refreshResult;
  try {
    refreshResult = await refreshHashes(registry, config, snapshot);
  } catch (err) {
    scanSpinner?.fail('扫描失败');
    log.error(String(err));
    process.exit(1);
  }

  const { registry: currentRegistry, designChanged, codeChanged } = refreshResult;
  const totalChanged = new Set([...designChanged, ...codeChanged]).size;
  scanSpinner?.succeed(
    `扫描完成：${designChanged.length} 个设计变更，${codeChanged.length} 个代码变更` +
    (totalChanged > 0 ? ` · ${totalChanged} 个组件受影响` : ''),
  );

  // Step 2: Compute statuses
  const diffResult = computeAllStatuses(currentRegistry);
  const { summary, componentStatuses } = diffResult;

  // Step 3: Collect actionable components (filter by --side if provided)
  const actionableStatuses: ComponentSyncStatus[] = opts.side === 'design'
    ? ['design-ahead', 'both-changed']
    : opts.side === 'code'
      ? ['code-ahead', 'both-changed']
      : ['design-ahead', 'code-ahead', 'both-changed', 'never-synced'];

  let candidates = Object.entries(componentStatuses)
    .filter(([, st]) => actionableStatuses.includes(st))
    .map(([id]) => ({ entry: currentRegistry.components[id], status: componentStatuses[id] }))
    .filter((x): x is { entry: ComponentEntry; status: ComponentSyncStatus } =>
      x.entry !== undefined,
    );

  // Filter by --component if provided
  if (opts.component) {
    const query = opts.component.toLowerCase();
    candidates = candidates.filter(
      ({ entry }) =>
        entry.name.toLowerCase() === query ||
        entry.id.toLowerCase().includes(query),
    );
    if (candidates.length === 0) {
      log.warn(`未找到组件：${opts.component}`);
      process.exit(1);
    }
  }

  // Step 4: Print summary header (text mode only)
  if (!isJson) {
    console.log();
    console.log(chalk.bold('  codeferry diff') + chalk.gray(' — design ↔ code'));
    console.log();
    console.log(
      `  ${chalk.green(`✔ synced ${summary.synced}`)}  ` +
      `${chalk.yellow(`◐ design-ahead ${summary.designAhead}`)}  ` +
      `${chalk.blue(`◑ code-ahead ${summary.codeAhead}`)}  ` +
      `${chalk.red(`⚠ conflict ${summary.conflicts}`)}  ` +
      `${chalk.gray(`○ never-synced ${summary.neverSynced}`)}`,
    );
    console.log();
  }

  if (candidates.length === 0) {
    if (isJson) {
      process.stdout.write(JSON.stringify({ summary, components: [] }, null, 2) + '\n');
    } else {
      console.log(`  ${chalk.green('✔')} 无变更，所有已映射组件均已同步`);
      console.log();
    }
    await store.saveRegistry(currentRegistry);
    return;
  }

  // Step 5: Read current file contents for changed components
  const designRoot = resolvePath(config.design.root);
  const codeRoot = resolvePath(config.code.root);

  const contentMap = new Map<string, { design: string; code: string }>();
  await Promise.all(
    candidates.map(async ({ entry }) => {
      const [design, code] = await Promise.all([
        readDesignContent(entry, designRoot),
        readCodeContent(entry, codeRoot),
      ]);
      contentMap.set(entry.id, { design, code });
    }),
  );

  // Step 6: AI analysis (unless --no-ai or json mode)
  const analysisMap = new Map<string, AIAnalysisResult>();

  if (!opts.noAi && !isJson) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (apiKey) {
      const aiSpinner = spinner(`正在对 ${candidates.length} 个变更组件进行 AI 语义分析...`);
      aiSpinner.start();
      try {
        const inputs = candidates.map(({ entry, status }) => {
          const content = contentMap.get(entry.id)!;
          return { entry, status, designContent: content.design, codeContent: content.code };
        });
        const results = await analyzeComponents(inputs, config);
        for (const [id, result] of results) analysisMap.set(id, result);
        aiSpinner.succeed(`AI 分析完成（${results.size} 个组件）`);
      } catch (err) {
        aiSpinner.warn(`AI 分析失败，继续展示结构 diff：${String(err).slice(0, 60)}`);
      }
    } else {
      log.dim('  未设置 ANTHROPIC_API_KEY，跳过 AI 分析（使用 --no-ai 消除此提示）');
    }
  }

  // Step 7: Compute diffs and render output
  //
  // For each component, we attempt to produce a unified diff using:
  //   - baseline: ComponentSnapshot.designContent / codeContent (stored at last snapshot)
  //   - current:  freshly read file content
  //
  // When baseline content is unavailable (old snapshot format or 100 KB size cap exceeded),
  // we fall back to showing the current content preview with a notice.
  const jsonComponents: DiffJsonOutput['components'] = [];

  for (const { entry, status } of candidates) {
    const content = contentMap.get(entry.id)!;
    const snap = snapshot?.components[entry.id];

    // Compute design-side diff
    let designDiff: string | null = null;
    if (status === 'design-ahead' || status === 'both-changed') {
      const baselineDesign = snap?.designContent ?? '';
      if (baselineDesign) {
        designDiff = generateComponentDiff(
          baselineDesign,
          content.design,
          `${entry.designFile} [${entry.name}]`,
          `baseline@${entry.designHashAtSync?.slice(0, 8) ?? 'never'}`,
        ) || null;
      }
    }

    // Compute code-side diff
    let codeDiff: string | null = null;
    if ((status === 'code-ahead' || status === 'both-changed') && entry.codeFiles.length > 0) {
      const baselineCode = snap?.codeContent ?? '';
      if (baselineCode) {
        codeDiff = generateComponentDiff(
          baselineCode,
          content.code,
          entry.codeFiles.join(', '),
          `baseline@${entry.codeHashAtSync?.slice(0, 8) ?? 'never'}`,
        ) || null;
      }
    }

    if (isJson) {
      jsonComponents.push({
        id: entry.id,
        name: entry.name,
        status,
        designFile: entry.designFile,
        codeFiles: entry.codeFiles,
        designDiff,
        codeDiff,
      });
      continue;
    }

    // ── Text output ─────────────────────────────────────────────────────────
    printComponentHeader(entry, status);

    const analysis = analysisMap.get(entry.id);
    if (analysis) {
      printAiAnalysis(analysis);
    }

    if (status === 'design-ahead' || status === 'both-changed') {
      if (designDiff) {
        console.log(`  ${chalk.yellow('◐ 设计侧变更（baseline → current）：')}`);
        console.log(colorizeUnifiedDiff(designDiff));
        console.log();
      } else if (content.design) {
        // No baseline content in snapshot — show current content with a notice
        console.log(`  ${chalk.yellow('◐ 设计侧当前内容：')}`);
        const lines = content.design.split('\n');
        const preview = lines.slice(0, 20).map((l) => `    ${chalk.gray(l)}`).join('\n');
        console.log(preview);
        if (lines.length > 20) log.dim(`    ... 还有 ${lines.length - 20} 行`);
        console.log();
        if (entry.designHashAtSync) {
          log.dim('  [快照无内容记录，无法生成 diff — 请重新运行 codeferry snapshot 建立基线]');
        }
      }
    }

    if ((status === 'code-ahead' || status === 'both-changed') && entry.codeFiles.length > 0) {
      if (codeDiff) {
        console.log(`  ${chalk.blue('◑ 代码侧变更（baseline → current）：')}`);
        console.log(colorizeUnifiedDiff(codeDiff));
        console.log();
      } else if (content.code) {
        console.log(`  ${chalk.blue('◑ 代码侧当前内容：')}`);
        const lines = content.code.split('\n');
        const preview = lines.slice(0, 20).map((l) => `    ${chalk.gray(l)}`).join('\n');
        console.log(preview);
        if (lines.length > 20) log.dim(`    ... 还有 ${lines.length - 20} 行`);
        console.log();
        if (entry.codeHashAtSync) {
          log.dim('  [快照无内容记录，无法生成 diff — 请重新运行 codeferry snapshot 建立基线]');
        }
      }
    }

    if (status === 'never-synced') {
      console.log(
        `  ${chalk.gray('○')} 有映射关系但从未同步 — ` +
        `运行 ${chalk.bold('codeferry snapshot')} 建立基线，然后 ${chalk.bold('codeferry sync')} 生成同步 Prompt`,
      );
      console.log();
    }
  }

  // Step 8: Write to queue (upsert pending items)
  const now = Date.now();
  const processedIds = new Set(candidates.map(({ entry }) => entry.id));

  const survivingItems = queue.items.filter((item) => {
    if (!processedIds.has(item.componentId)) return true;
    return item.status === 'done' || item.status === 'skipped';
  });

  const newItems: SyncQueueItem[] = candidates.map(({ entry, status }) => {
    const analysis = analysisMap.get(entry.id);
    const direction = (status === 'code-ahead')
      ? 'code-to-design' as const
      : 'design-to-code' as const;

    return {
      id: makeQueueId(entry.id),
      componentId: entry.id,
      direction,
      status: 'pending' as const,
      intent: analysis?.intent,
      summary: analysis?.summary,
      impact: analysis?.impact,
      syncGuide: analysis?.syncGuide,
      diff: `status:${status}`,
      createdAt: now,
    };
  });

  queue.items = [...survivingItems, ...newItems];
  queue.updatedAt = now;
  await store.saveQueue(queue);

  // Step 9: Save refreshed registry
  await store.saveRegistry(currentRegistry);

  // Step 10: JSON output or text next-steps
  if (isJson) {
    const output: DiffJsonOutput = { summary, components: jsonComponents };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return;
  }

  if (summary.conflicts > 0) {
    log.warn(
      `发现 ${summary.conflicts} 个冲突组件 — 两侧均有修改，运行 ${chalk.bold('codeferry sync --to code')} 生成合并 Prompt`,
    );
  }
  if (summary.designAhead > 0) {
    log.info(
      `${summary.designAhead} 个组件设计侧领先 — 运行 ${chalk.bold('codeferry sync --to code')} 同步到代码`,
    );
  }
  if (summary.codeAhead > 0) {
    log.info(
      `${summary.codeAhead} 个组件代码侧领先 — 运行 ${chalk.bold('codeferry sync --to design')} 同步到设计稿`,
    );
  }
  if (summary.neverSynced > 0) {
    log.info(
      `${summary.neverSynced} 个组件有映射但从未同步 — ` +
      `运行 ${chalk.bold('codeferry snapshot')} 建立基线`,
    );
  }
  console.log();
}
