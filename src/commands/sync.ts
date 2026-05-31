import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { resolveStore } from '../state/resolve-store.js';
import { computeAllStatuses, refreshHashes } from '../core/differ.js';
import { analyzeComponents } from '../core/analyzer.js';
import { buildSyncPrompt, buildPromptFilename } from '../output/prompt-builder.js';
import { resolvePath } from '../utils/path.js';
import { log } from '../utils/logger.js';
import { spinner, statusIcon } from '../output/reporter.js';
import type {
  AIAnalysisResult,
  ComponentEntry,
  ComponentSyncStatus,
  SyncDirection,
  SyncQueueItem,
  DriftConfig,
  StackInfo,
} from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface SyncOptions {
  to: 'code' | 'design';
  copy?: boolean;
  out?: string;
  component?: string;
  noAi?: boolean;
  workspace?: string;
}

// ── Direction mapping ────────────────────────────────────────────────────────

/**
 * Map --to target to the sync direction string.
 */
function toDirection(to: 'code' | 'design'): SyncDirection {
  return to === 'code' ? 'design-to-code' : 'code-to-design';
}

/**
 * Statuses that are actionable for a given direction.
 */
function actionableStatuses(direction: SyncDirection): ComponentSyncStatus[] {
  if (direction === 'design-to-code') {
    return ['design-ahead', 'both-changed', 'never-synced'];
  }
  return ['code-ahead', 'both-changed', 'never-synced'];
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

// ── Queue management ─────────────────────────────────────────────────────────

function makeQueueId(componentId: string, direction: SyncDirection): string {
  const ts = Date.now().toString(36);
  const safe = componentId.replace(/[^a-z0-9]/gi, '_').slice(0, 20);
  return `sync_${safe}_${direction === 'design-to-code' ? 'd2c' : 'c2d'}_${ts}`;
}

// ── Load stack info ──────────────────────────────────────────────────────────

/**
 * Load the persisted StackInfo from config.project.
 *
 * `drift init` runs StackDetector and writes:
 *   - `project.stack`           — human-readable summary
 *   - `project.designToCodeHints` — framework-specific hints for design→code prompts
 *   - `project.codeToDesignHints` — framework-specific hints for code→design prompts
 *
 * We intentionally do NOT re-run StackDetector here (it's a slow I/O pass).
 * Returns null if no project info is configured, so prompt-builder falls back
 * to its generic conversion hints.
 */
function tryLoadStackInfo(config: DriftConfig): StackInfo | null {
  const project = config.project;
  if (!project) return null;

  const hasHints =
    (project.designToCodeHints?.length ?? 0) > 0 ||
    (project.codeToDesignHints?.length ?? 0) > 0;

  // If we have no hints AND no stack description, nothing useful to pass along
  if (!hasHints && !project.stack && !project.conventions?.length) return null;

  return {
    designToCodeHints: project.designToCodeHints ?? [],
    codeToDesignHints: project.codeToDesignHints ?? [],
  };
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function syncCommand(opts: SyncOptions): Promise<void> {
  const { store } = await resolveStore(opts.workspace);

  const [config, registry, snapshot, queue] = await Promise.all([
    store.getConfig(),
    store.getRegistry(),
    store.getLatestSnapshot(),
    store.getQueue(),
  ]);

  if (!config || !registry) {
    log.error('配置或注册表缺失，请重新运行 drift init');
    process.exit(1);
  }

  const direction = toDirection(opts.to);
  const dirLabel = direction === 'design-to-code' ? 'Design → Code' : 'Code → Design';

  // ── Step 1: Refresh registry ──
  const scanSpinner = spinner(`正在扫描双目录变更（${dirLabel}）...`);
  scanSpinner.start();

  let currentRegistry = registry;
  try {
    const { registry: refreshed } = await refreshHashes(registry, config, snapshot);
    currentRegistry = refreshed;
    scanSpinner.succeed('扫描完成');
  } catch (err) {
    scanSpinner.fail('扫描失败');
    log.error(String(err));
    process.exit(1);
  }

  // ── Step 2: Find actionable components ──
  const diffResult = computeAllStatuses(currentRegistry);
  const allowed = new Set(actionableStatuses(direction));

  let candidates = Object.entries(diffResult.componentStatuses)
    .filter(([, s]) => allowed.has(s))
    .map(([id]) => ({
      entry: currentRegistry.components[id],
      status: diffResult.componentStatuses[id],
    }))
    .filter((x): x is { entry: ComponentEntry; status: ComponentSyncStatus } =>
      x.entry !== undefined,
    );

  // Apply --component filter
  if (opts.component) {
    const query = opts.component.toLowerCase();
    candidates = candidates.filter(
      ({ entry }) =>
        entry.name.toLowerCase() === query ||
        entry.id.toLowerCase().includes(query),
    );
    if (candidates.length === 0) {
      log.warn(`未找到符合条件的组件：${opts.component}`);
      log.dim(`  方向：${dirLabel}，可处理状态：${[...allowed].join(', ')}`);
      process.exit(1);
    }
  }

  if (candidates.length === 0) {
    console.log();
    console.log(
      `  ${chalk.green('✔')} 无需同步（${dirLabel} 方向没有待处理的组件）`,
    );
    console.log();
    log.dim('  运行 drift status 查看各状态详情');
    await store.saveRegistry(currentRegistry);
    return;
  }

  console.log();
  console.log(chalk.bold(`  drift sync`) + chalk.gray(` — ${dirLabel}`));
  console.log();
  console.log(
    `  找到 ${chalk.bold(String(candidates.length))} 个组件需要同步：`,
  );
  for (const { entry, status } of candidates) {
    console.log(
      `    ${statusIcon(status)} ${chalk.bold(entry.name)}  ` +
      `${chalk.gray(entry.designFile)}`,
    );
  }
  console.log();

  // ── Step 3: Read file contents ──
  const designRoot = resolvePath(config.design.root);
  const codeRoot = resolvePath(config.code.root);

  const contentSpinner = spinner('正在读取组件内容...');
  contentSpinner.start();

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
  contentSpinner.succeed('内容读取完成');

  // ── Step 4: AI analysis (optional) ──
  const analysisMap = new Map<string, AIAnalysisResult>();

  if (!opts.noAi) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (apiKey) {
      const aiSpinner = spinner(`正在对 ${candidates.length} 个组件进行 AI 语义分析...`);
      aiSpinner.start();
      try {
        const inputs = candidates.map(({ entry, status }) => {
          const content = contentMap.get(entry.id)!;
          return {
            entry,
            status,
            designContent: content.design,
            codeContent: content.code,
          };
        });
        const results = await analyzeComponents(inputs, config);
        for (const [id, result] of results) analysisMap.set(id, result);
        aiSpinner.succeed(`AI 分析完成（${results.size} 个组件）`);
      } catch (err) {
        aiSpinner.warn(`AI 分析失败，将使用默认指引：${String(err).slice(0, 60)}`);
      }
    } else {
      log.dim('  未设置 ANTHROPIC_API_KEY，跳过 AI 分析（使用通用指引）');
    }
  } else {
    log.dim('  已指定 --no-ai，跳过 AI 分析');
  }

  // ── Step 5: Build prompts ──
  const stackInfo = tryLoadStackInfo(config);
  const prompts: Array<{ entry: ComponentEntry; filename: string; content: string }> = [];

  for (const { entry, status } of candidates) {
    const content = contentMap.get(entry.id)!;
    const analysis = analysisMap.get(entry.id) ?? null;

    const promptContent = buildSyncPrompt({
      entry,
      direction,
      designContent: content.design,
      codeContent: content.code,
      status,
      config,
      stackInfo,
      analysis,
    });

    prompts.push({
      entry,
      filename: buildPromptFilename(entry, direction),
      content: promptContent,
    });
  }

  // ── Step 6: Output ──
  let outputMode = 'none';

  // Write to files if --out is specified
  if (opts.out) {
    const outDir = resolve(opts.out);
    await mkdir(outDir, { recursive: true });

    const writeSpinner = spinner(`正在写入 ${prompts.length} 个 prompt 文件到 ${opts.out}...`);
    writeSpinner.start();

    for (const { filename, content } of prompts) {
      await writeFile(join(outDir, filename), content, 'utf8');
    }
    writeSpinner.succeed(`已写入 ${prompts.length} 个文件到 ${chalk.bold(opts.out)}`);

    for (const { filename } of prompts) {
      log.dim(`  → ${join(opts.out, filename)}`);
    }
    outputMode = 'file';
  }

  // Copy to clipboard if --copy is specified (or default when neither specified)
  const shouldCopy = opts.copy || (!opts.out);
  if (shouldCopy) {
    const combined = prompts
      .map(({ content }) => content)
      .join('\n\n---\n\n');

    try {
      const { default: clipboardy } = await import('clipboardy');
      await clipboardy.write(combined);

      console.log();
      if (prompts.length === 1) {
        log.success(`✔ 已复制到剪贴板：${chalk.bold(prompts[0].entry.name)} 的同步 Prompt`);
      } else {
        log.success(`✔ 已复制到剪贴板：${prompts.length} 个组件的合并 Prompt`);
      }
      outputMode = 'clipboard';
    } catch {
      log.warn('剪贴板操作失败，改为输出到终端');
      outputMode = 'terminal';
    }
  }

  // Fallback: print to terminal
  if (outputMode === 'terminal' || (outputMode === 'none' && !opts.out && !opts.copy)) {
    console.log();
    console.log(chalk.bold('  ── 生成的同步 Prompt ──'));
    console.log();
    for (const { content } of prompts) {
      console.log(content);
      console.log('\n---\n');
    }
  }

  // ── Step 7: Update queue ──
  const now = Date.now();
  const updatedIds = new Set(candidates.map(({ entry }) => entry.id));

  // Mark existing items for these components + direction as superseded
  const survivingItems = queue.items.filter((item) => {
    const sameComponent = updatedIds.has(item.componentId);
    const sameDirection = item.direction === direction;
    // Keep items from other directions or already done/skipped
    if (!sameComponent || !sameDirection) return true;
    return item.status === 'done' || item.status === 'skipped';
  });

  // Create new in-progress items
  const newItems: SyncQueueItem[] = candidates.map(({ entry, status }) => {
    const analysis = analysisMap.get(entry.id);
    return {
      id: makeQueueId(entry.id, direction),
      componentId: entry.id,
      direction,
      status: 'in-progress',
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
  await store.saveRegistry(currentRegistry);

  // ── Step 8: Next-steps hints ──
  console.log();
  log.info('下一步：');
  console.log();

  if (outputMode === 'clipboard') {
    console.log(
      `  ${chalk.bold('1.')} 打开 ${direction === 'design-to-code' ? 'Claude Code' : 'Claude Design'} 对话框`,
    );
    console.log(`  ${chalk.bold('2.')} 粘贴剪贴板内容（⌘V / Ctrl+V）`);
    console.log(`  ${chalk.bold('3.')} 等待 AI 完成修改`);
  } else if (outputMode === 'file' && opts.out) {
    console.log(`  ${chalk.bold('1.')} 打开 ${chalk.gray(opts.out)} 中的 .md 文件`);
    console.log(`  ${chalk.bold('2.')} 将内容粘贴给 ${direction === 'design-to-code' ? 'Claude Code' : 'Claude Design'}`);
    console.log(`  ${chalk.bold('3.')} 等待 AI 完成修改`);
  }

  console.log(
    `  ${chalk.bold('4.')} 确认修改正确后，运行 ` +
    `${chalk.bold('drift snapshot --after-sync')} ` +
    `更新同步基线（自动标记本次同步的 ${candidates.length} 个组件为 done）`,
  );
  console.log();
}
