import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { resolveStore } from '../state/resolve-store.js';
import { autoMap } from '../core/mapper.js';
import { computeStatus } from '../core/differ.js';
import { hashMultiple } from '../utils/hash.js';
import { resolvePath } from '../utils/path.js';
import { log } from '../utils/logger.js';
import { spinner, statusLabel } from '../output/reporter.js';
import type { ComponentRegistry } from '../types/index.js';

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
    log.error('配置或注册表缺失，请重新运行 drift init');
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

  const s = spinner(`正在对 ${unmappedEntries.length} 个未映射组件运行自动映射...`);
  s.start();

  const result = await autoMap(unmappedEntries, searchFiles, codeRoot);

  s.succeed(`自动映射完成：${result.mapped.length} 个成功，${result.unmapped.length} 个未匹配`);

  if (result.mapped.length === 0) {
    log.warn('未找到任何匹配。尝试 drift map set <id> <path> 手动建立映射');
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
    log.dim(`  ${result.unmapped.length} 个组件未找到匹配，可用 drift map set 手动指定`);
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
    log.dim('  可使用 drift map 查看所有组件 ID');
    process.exit(1);
  }

  const codeRoot = resolvePath(config.code.root);

  // Compute code hash
  let codeHash = '';
  try {
    const content = await readFile(join(codeRoot, codePath), 'utf8');
    codeHash = hashMultiple([content]);
  } catch {
    log.warn(`无法读取代码文件：${codePath}，继续但 hash 为空`);
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
