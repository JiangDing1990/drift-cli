import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { resolveStore } from '../state/resolve-store.js';
import { autoMap } from '../core/mapper.js';
import { suggestMappings } from '../core/ai-mapper.js';
import { computeStatus } from '../core/differ.js';
import { hashMultiple } from '../utils/hash.js';
import { resolvePath } from '../utils/path.js';
import { log } from '../utils/logger.js';
import { spinner, statusLabel } from '../output/reporter.js';
import type { ComponentEntry, ComponentRegistry } from '../types/index.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function mappingLabel(type: 'auto' | 'manual', confidence: number): string {
  if (type === 'manual') return chalk.cyan('manual');
  const pct = Math.round(confidence * 100);
  const color = pct >= 90 ? chalk.green : pct >= 60 ? chalk.yellow : chalk.gray;
  return color(`auto ${pct}%`);
}

function designLabel(entry: { designFile: string; designStartLine: number; designEndLine: number }): string {
  return `${entry.designFile}:${entry.designStartLine}-${entry.designEndLine}`;
}

/** Collect the full set of code files to search: unmapped + already-mapped (for 1:N support). */
function allKnownCodeFiles(registry: ComponentRegistry): string[] {
  const mapped = Object.values(registry.components).flatMap((e) => e.codeFiles);
  return [...new Set([...registry.unmappedCode, ...mapped])];
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function mapListCommand(opts: { unmapped?: boolean; workspace?: string }): Promise<void> {
  const { store } = await resolveStore(opts.workspace);

  const registry = await store.getRegistry();
  if (!registry) {
    log.error('未找到 registry.json，请先运行 codeferry init');
    process.exit(1);
  }

  const entries = Object.values(registry.components);
  const filtered = opts.unmapped
    ? entries.filter((e) => e.codeFiles.length === 0)
    : entries;

  if (filtered.length === 0) {
    log.info(opts.unmapped ? '所有组件均已映射 ✔' : '注册表为空');
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan('组件'),
      chalk.cyan('设计文件'),
      chalk.cyan('代码文件'),
      chalk.cyan('状态'),
      chalk.cyan('映射'),
    ],
    style: { head: [], border: [] },
    colWidths: [22, 26, 32, 14, 12],
    wordWrap: true,
  });

  for (const entry of filtered) {
    const status = computeStatus(entry);
    const codeCol = entry.codeFiles.length > 0
      ? entry.codeFiles.map((f) => truncate(f, 30)).join('\n')
      : chalk.gray('(未映射)');

    table.push([
      truncate(entry.name, 20),
      truncate(designLabel(entry), 24),
      codeCol,
      statusLabel(status),
      entry.codeFiles.length > 0 ? mappingLabel(entry.mappingType, entry.mappingConfidence) : chalk.gray('-'),
    ]);
  }

  console.log();
  console.log(table.toString());

  const mapped = entries.filter((e) => e.codeFiles.length > 0).length;
  const unmappedDesign = entries.filter((e) => e.codeFiles.length === 0).length;
  log.dim(`  共 ${entries.length} 个组件 · 已映射 ${mapped} · 未映射 ${unmappedDesign}`);
  if (registry.unmappedCode.length > 0) {
    log.dim(`  代码侧无映射文件：${registry.unmappedCode.length} 个`);
  }
  console.log();
}

// ── Auto mapping ─────────────────────────────────────────────────────────────

export async function mapAutoCommand(opts: { workspace?: string } = {}): Promise<void> {
  const { store } = await resolveStore(opts.workspace);

  const [config, registry] = await Promise.all([
    store.getConfig(),
    store.getRegistry(),
  ]);

  if (!config || !registry) {
    log.error('配置或注册表缺失，请重新运行 codeferry init');
    process.exit(1);
  }

  const codeRoot = resolvePath(config.code.root);

  // Only auto-map components that don't have a mapping yet
  const unmappedEntries = Object.values(registry.components).filter(
    (e) => e.codeFiles.length === 0,
  );

  if (unmappedEntries.length === 0) {
    log.info('所有组件均已有映射关系');
    return;
  }

  // Search ALL known code files (unmapped + already-mapped) to support 1:N mapping,
  // where the same code file maps to multiple design components.
  const searchFiles = allKnownCodeFiles(registry);

  const threshold = config.mapping?.autoThreshold ?? 0.5;
  const s = spinner(`正在对 ${unmappedEntries.length} 个未映射组件运行自动映射...`);
  s.start();

  const result = await autoMap(unmappedEntries, searchFiles, codeRoot, {
    threshold,
    designRoot: resolvePath(config.design.root),
  });

  s.succeed(`自动映射完成：${result.mapped.length} 个成功，${result.unmapped.length} 个未匹配`);

  if (result.mapped.length === 0) {
    log.warn('未找到任何匹配。尝试 codeferry map suggest（AI 辅助）或 codeferry map set <id> <path> 手动指定');
    return;
  }

  // Preview and confirm
  console.log();
  const table = new Table({
    head: [chalk.cyan('组件'), chalk.cyan('匹配的代码文件'), chalk.cyan('置信度'), chalk.cyan('理由')],
    style: { head: [], border: [] },
    colWidths: [22, 34, 10, 28],
    wordWrap: true,
  });

  for (const { componentId, candidate } of result.mapped) {
    const entry = registry.components[componentId];
    const pct = Math.round(candidate.confidence * 100);
    const color = pct >= 90 ? chalk.green : pct >= 60 ? chalk.yellow : chalk.gray;
    table.push([
      truncate(entry.name, 20),
      truncate(candidate.codePath, 32),
      color(`${pct}%`),
      truncate(candidate.reason, 26),
    ]);
  }
  console.log(table.toString());

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
    type: 'confirm',
    name: 'confirm',
    message: `确认以上 ${result.mapped.length} 个映射关系并写入注册表？`,
    default: true,
  }]);

  if (!confirm) {
    log.info('已取消，注册表未修改');
    return;
  }

  // Apply mappings: update registry entries and compute code hashes
  const applySpinner = spinner('正在计算代码文件哈希...');
  applySpinner.start();

  const newlyMapped = new Set<string>();
  const newlyMappedCodeFiles = new Set<string>();

  for (const { componentId, candidate } of result.mapped) {
    const entry = registry.components[componentId];
    entry.codeFiles = [candidate.codePath];
    entry.mappingType = 'auto';
    entry.mappingConfidence = candidate.confidence;

    try {
      const content = await readFile(join(codeRoot, candidate.codePath), 'utf8');
      entry.codeHash = hashMultiple([content]);
    } catch {
      entry.codeHash = '';
    }

    newlyMapped.add(componentId);
    newlyMappedCodeFiles.add(candidate.codePath);
  }

  // Update unmappedDesign: remove newly mapped
  registry.unmappedDesign = registry.unmappedDesign.filter((id) => !newlyMapped.has(id));

  // Update unmappedCode: remove files that are now mapped.
  // A code file stays in unmappedCode only if no component maps to it.
  const allMappedFiles = new Set(
    Object.values(registry.components).flatMap((e) => e.codeFiles),
  );
  registry.unmappedCode = registry.unmappedCode.filter((f) => !allMappedFiles.has(f));

  registry.updatedAt = Date.now();
  await store.saveRegistry(registry);

  applySpinner.succeed('注册表已更新');
  log.success(`映射完成：${result.mapped.length} 个组件已建立映射关系`);
  if (result.unmapped.length > 0) {
    log.dim(`  ${result.unmapped.length} 个组件未找到匹配，可运行 codeferry map suggest 使用 AI 辅助匹配`);
  }
}

// ── Set mapping ──────────────────────────────────────────────────────────────

export async function mapSetCommand(componentId: string, codePath: string, opts: { workspace?: string } = {}): Promise<void> {
  const { store } = await resolveStore(opts.workspace);

  const [config, registry] = await Promise.all([store.getConfig(), store.getRegistry()]);
  if (!config || !registry) {
    log.error('配置或注册表缺失');
    process.exit(1);
  }

  // Support partial ID match: if user gives just "ComponentName", find matching entry
  const entry = findEntry(registry, componentId);
  if (!entry) {
    log.error(`未找到组件：${componentId}`);
    log.dim('  可使用 codeferry map list 查看所有组件 ID');
    process.exit(1);
  }

  const codeRoot = resolvePath(config.code.root);

  // Compute code hash — fail hard if the target file doesn't exist.
  // Allowing an empty hash would cause differ.ts to permanently ignore code-side changes.
  let codeHash = '';
  try {
    const content = await readFile(join(codeRoot, codePath), 'utf8');
    codeHash = hashMultiple([content]);
  } catch (err) {
    const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (isNotFound) {
      log.error(`代码文件不存在：${codePath}`);
      log.dim(`  请确认路径相对于 code.root（${config.code.root}）正确后重试`);
    } else {
      log.error(`无法读取代码文件：${codePath}（${(err as NodeJS.ErrnoException).code ?? '未知错误'}）`);
      log.dim('  如为权限问题，请检查文件读取权限');
    }
    process.exit(1);
  }

  const wasUnmapped = entry.codeFiles.length === 0;
  const prevCodeFiles = entry.codeFiles;

  entry.codeFiles = [codePath];
  entry.codeHash = codeHash;
  entry.mappingType = 'manual';
  entry.mappingConfidence = 1.0;

  if (wasUnmapped) {
    registry.unmappedDesign = registry.unmappedDesign.filter((id) => id !== entry.id);
  } else {
    // Remapping: return old code files to unmappedCode if nothing else maps to them
    const stillMapped = new Set(
      Object.values(registry.components).flatMap((e) => e.codeFiles),
    );
    for (const f of prevCodeFiles) {
      if (!stillMapped.has(f) && !registry.unmappedCode.includes(f)) {
        registry.unmappedCode.push(f);
      }
    }
  }

  // Remove the new target from unmappedCode (it's now mapped)
  registry.unmappedCode = registry.unmappedCode.filter((f) => f !== codePath);

  registry.updatedAt = Date.now();
  await store.saveRegistry(registry);

  log.success(`已手动设置映射：${chalk.bold(entry.name)} → ${chalk.bold(codePath)}`);
}

// ── Unset mapping ────────────────────────────────────────────────────────────

export async function mapUnsetCommand(componentId: string, opts: { workspace?: string } = {}): Promise<void> {
  const { store } = await resolveStore(opts.workspace);

  const registry = await store.getRegistry();
  if (!registry) {
    log.error('未找到注册表');
    process.exit(1);
  }

  const entry = findEntry(registry, componentId);
  if (!entry) {
    log.error(`未找到组件：${componentId}`);
    process.exit(1);
  }

  const prevFiles = entry.codeFiles;

  // Reset entry to "unmapped" state
  entry.codeFiles = [];
  entry.codeHash = '';
  entry.mappingType = 'auto';
  entry.mappingConfidence = 0;
  entry.lastSyncedAt = null;
  entry.designHashAtSync = null;
  entry.codeHashAtSync = null;

  if (!registry.unmappedDesign.includes(entry.id)) {
    registry.unmappedDesign.push(entry.id);
  }

  // Return previous code files to unmappedCode if no other component maps to them
  const stillMapped = new Set(
    Object.values(registry.components).flatMap((e) => e.codeFiles),
  );
  for (const f of prevFiles) {
    if (!stillMapped.has(f) && !registry.unmappedCode.includes(f)) {
      registry.unmappedCode.push(f);
    }
  }

  registry.updatedAt = Date.now();
  await store.saveRegistry(registry);

  log.success(`已移除映射：${chalk.bold(entry.name)}`);
}

// ── Suggest mapping (AI-assisted) ────────────────────────────────────────────

/** Source of a mapping suggestion: auto-strategy or AI fallback. */
type SuggestionSource = 'auto' | 'ai';

interface MappingSuggestion {
  component: ComponentEntry;
  codePath: string;
  confidence: number;
  reason: string;
  source: SuggestionSource;
}

/**
 * Interactive AI-assisted mapping command.
 *
 * Flow:
 *   1. Run Strategy 1+2+3 (auto) on all unmapped components
 *   2. For components still unmapped: call AI mapper (unless --no-ai)
 *   3. Present all suggestions in a summary table
 *   4. For each suggestion: Accept / Skip / Enter path manually
 *   5. Write accepted mappings to registry in one atomic save
 */
export async function mapSuggestCommand(opts: { noAi?: boolean; workspace?: string } = {}): Promise<void> {
  const { store } = await resolveStore(opts.workspace);

  const [config, registry] = await Promise.all([
    store.getConfig(),
    store.getRegistry(),
  ]);

  if (!config || !registry) {
    log.error('配置或注册表缺失，请重新运行 codeferry init');
    process.exit(1);
  }

  const codeRoot = resolvePath(config.code.root);
  const designRoot = resolvePath(config.design.root);

  const unmappedEntries = Object.values(registry.components).filter(
    (e) => e.codeFiles.length === 0,
  );

  if (unmappedEntries.length === 0) {
    log.info('所有组件均已有映射关系 ✔');
    return;
  }

  const searchFiles = allKnownCodeFiles(registry);
  const suggestions: MappingSuggestion[] = [];

  // ── Step 1: Run auto strategies ─────────────────────────────────────────────

  const autoSpinner = spinner(`正在对 ${unmappedEntries.length} 个未映射组件运行自动策略...`);
  autoSpinner.start();

  // Use threshold=0 so we surface ALL auto candidates (user decides what to accept)
  const autoResult = await autoMap(unmappedEntries, searchFiles, codeRoot, {
    threshold: 0,
    designRoot,
  });

  autoSpinner.succeed(
    `自动策略完成：${autoResult.mapped.length} 个找到候选，${autoResult.unmapped.length} 个未找到`,
  );

  // Collect auto suggestions
  for (const { componentId, candidate } of autoResult.mapped) {
    const component = registry.components[componentId];
    if (!component) continue;
    suggestions.push({
      component,
      codePath: candidate.codePath,
      confidence: candidate.confidence,
      reason: candidate.reason,
      source: 'auto',
    });
  }

  // ── Step 2: AI fallback for still-unmapped components ────────────────────────

  const stillUnmappedIds = new Set(autoResult.unmapped);
  const stillUnmapped = unmappedEntries.filter((e) => stillUnmappedIds.has(e.id));

  if (stillUnmapped.length > 0 && !opts.noAi) {
    const hasApiKey = Boolean(process.env['ANTHROPIC_API_KEY']);
    if (!hasApiKey) {
      log.dim(`  ${stillUnmapped.length} 个组件未找到候选（跳过 AI：未设置 ANTHROPIC_API_KEY）`);
    } else {
      const aiSpinner = spinner(`调用 AI 对 ${stillUnmapped.length} 个组件进行推断...`);
      aiSpinner.start();

      const aiResults = await suggestMappings(stillUnmapped, searchFiles, config);

      const aiCount = aiResults.size;
      aiSpinner.succeed(`AI 推断完成：${aiCount} 个找到建议，${stillUnmapped.length - aiCount} 个无合适候选`);

      for (const [componentId, result] of aiResults) {
        const component = registry.components[componentId];
        if (!component) continue;
        suggestions.push({
          component,
          codePath: result.codePath,
          confidence: result.confidence,
          reason: result.reasoning,
          source: 'ai',
        });
      }
    }
  } else if (stillUnmapped.length > 0 && opts.noAi) {
    log.dim(`  ${stillUnmapped.length} 个组件未找到候选（已跳过 AI，使用 --no-ai）`);
  }

  if (suggestions.length === 0) {
    log.warn('未找到任何可用建议。请使用 codeferry map set <id> <path> 手动建立映射。');
    return;
  }

  // ── Step 3: Display summary table ───────────────────────────────────────────

  console.log();
  const table = new Table({
    head: [
      chalk.cyan('#'),
      chalk.cyan('组件'),
      chalk.cyan('建议代码文件'),
      chalk.cyan('置信度'),
      chalk.cyan('来源'),
      chalk.cyan('理由'),
    ],
    style: { head: [], border: [] },
    colWidths: [4, 20, 34, 8, 6, 28],
    wordWrap: true,
  });

  suggestions.forEach((s, i) => {
    const pct = Math.round(s.confidence * 100);
    const confColor = pct >= 90 ? chalk.green : pct >= 65 ? chalk.yellow : chalk.gray;
    const srcLabel = s.source === 'ai' ? chalk.magenta('AI') : chalk.cyan('auto');
    table.push([
      String(i + 1),
      truncate(s.component.name, 18),
      truncate(s.codePath, 32),
      confColor(`${pct}%`),
      srcLabel,
      truncate(s.reason, 26),
    ]);
  });

  console.log(table.toString());
  console.log();

  // ── Step 4: Interactive review ───────────────────────────────────────────────

  interface AcceptedMapping {
    component: ComponentEntry;
    codePath: string;
    mappingType: 'auto' | 'manual';
    mappingConfidence: number;
  }
  const accepted: AcceptedMapping[] = [];

  for (const suggestion of suggestions) {
    const pct = Math.round(suggestion.confidence * 100);
    const srcTag = suggestion.source === 'ai'
      ? chalk.magenta('[AI]')
      : chalk.cyan('[auto]');

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: `${chalk.bold(suggestion.component.name)} → ${chalk.dim(suggestion.codePath)} ${srcTag} ${pct}%`,
      choices: [
        { name: `✔ 接受`, value: 'accept' },
        { name: `↩ 跳过`, value: 'skip' },
        { name: `✎ 手动输入路径`, value: 'manual' },
      ],
    }]);

    if (action === 'skip') continue;

    if (action === 'manual') {
      const { customPath } = await inquirer.prompt<{ customPath: string }>([{
        type: 'input',
        name: 'customPath',
        message: `输入代码文件路径（相对于 code.root: ${config.code.root}）：`,
        validate: (v: string) => v.trim().length > 0 || '路径不能为空',
      }]);
      accepted.push({
        component: suggestion.component,
        codePath: customPath.trim(),
        mappingType: 'manual',
        mappingConfidence: 1.0,
      });
    } else {
      // accept — preserve the AI/auto confidence so map list shows accurate quality
      accepted.push({
        component: suggestion.component,
        codePath: suggestion.codePath,
        mappingType: 'auto',
        mappingConfidence: suggestion.confidence,
      });
    }
  }

  if (accepted.length === 0) {
    log.info('未接受任何建议，注册表未修改。');
    return;
  }

  // ── Step 5: Write accepted mappings ─────────────────────────────────────────

  const applySpinner = spinner(`正在写入 ${accepted.length} 个映射关系...`);
  applySpinner.start();

  const newlyMapped = new Set<string>();

  for (const { component, codePath, mappingType, mappingConfidence } of accepted) {
    const entry = registry.components[component.id];
    if (!entry) continue;

    let codeHash = '';
    try {
      const content = await readFile(join(codeRoot, codePath), 'utf8');
      codeHash = hashMultiple([content]);
    } catch {
      // File may not exist yet (e.g., user typed a planned path) — allow empty hash
    }

    entry.codeFiles = [codePath];
    entry.codeHash = codeHash;
    entry.mappingType = mappingType;
    entry.mappingConfidence = mappingConfidence;

    newlyMapped.add(component.id);
  }

  // Update unmappedDesign
  registry.unmappedDesign = registry.unmappedDesign.filter((id) => !newlyMapped.has(id));

  // Update unmappedCode: remove files that are now mapped
  const allMappedFiles = new Set(
    Object.values(registry.components).flatMap((e) => e.codeFiles),
  );
  registry.unmappedCode = registry.unmappedCode.filter((f) => !allMappedFiles.has(f));

  registry.updatedAt = Date.now();
  await store.saveRegistry(registry);

  applySpinner.succeed('注册表已更新');
  log.success(`已建立 ${accepted.length} 个映射关系`);

  const remaining = unmappedEntries.length - accepted.length;
  if (remaining > 0) {
    log.dim(`  仍有 ${remaining} 个组件未映射，可用 codeferry map set <id> <path> 手动指定`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find a ComponentEntry by exact ID, or by component name if no exact match.
 */
function findEntry(registry: ComponentRegistry, idOrName: string) {
  // Exact match first
  if (registry.components[idOrName]) return registry.components[idOrName];
  // Name-only match (case-insensitive)
  return Object.values(registry.components).find(
    (e) => e.name.toLowerCase() === idOrName.toLowerCase(),
  );
}
