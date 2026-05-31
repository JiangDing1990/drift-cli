import { resolve } from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { StateStore } from '../state/store.js';
import { WorkspaceManager } from '../state/workspace.js';
import { scan } from '../core/scanner.js';
import { extractAll } from '../core/extractor.js';
import { detectStack, generateDesignToCodeHints, generateCodeToDesignHints } from '../core/stack-detector.js';
import { resolvePath } from '../utils/path.js';
import { log } from '../utils/logger.js';
import { spinner, printExtractionSummary, printScanSummary, printInitComplete } from '../output/reporter.js';
import type { DriftConfig, ComponentRegistry, FullSnapshot, StackInfo, DetectedItem } from '../types/index.js';

export interface InitOptions {
  design: string;
  code: string;
  force?: boolean;
  skipDetect?: boolean;
  /** Target workspace name (default: 'default') */
  workspace?: string;
}

function confidenceIcon(c: DetectedItem['confidence']): string {
  switch (c) {
    case 'high': return chalk.green('✔');
    case 'medium': return chalk.yellow('?');
    case 'low': return chalk.gray('○');
  }
}

function formatDetectedLine(label: string, item: DetectedItem | undefined): string {
  if (!item) return `  ${chalk.gray('○')} ${label.padEnd(10)} ${chalk.gray('(未检测到)')}`;
  return `  ${confidenceIcon(item.confidence)} ${label.padEnd(10)} ${item.value.padEnd(20)} ${chalk.gray(`(${item.confidence === 'high' ? '高' : item.confidence === 'medium' ? '中' : '低'}置信 · ${item.evidence})`)}`;
}

async function confirmStack(stackInfo: StackInfo): Promise<{ confirmed: StackInfo; conventions: string[] }> {
  log.blank();
  console.log(chalk.bold('  技术栈检测结果'));
  console.log();
  console.log(formatDetectedLine('框架', stackInfo.framework));
  console.log(formatDetectedLine('语言', stackInfo.language));
  console.log(formatDetectedLine('样式', stackInfo.styling));
  console.log(formatDetectedLine('状态管理', stackInfo.stateManagement));
  console.log(formatDetectedLine('路由', stackInfo.routing));
  console.log(formatDetectedLine('组件模式', stackInfo.componentPattern));
  console.log();

  const { action } = await inquirer.prompt<{ action: string }>([{
    type: 'list',
    name: 'action',
    message: '以上检测结果是否正确？',
    choices: [
      { name: '确认并继续', value: 'confirm' },
      { name: '修正某些项', value: 'edit' },
      { name: '全部手动填写', value: 'manual' },
      { name: '跳过（不配置技术栈信息）', value: 'skip' },
    ],
  }]);

  if (action === 'skip') {
    return { confirmed: { designToCodeHints: [], codeToDesignHints: [] }, conventions: [] };
  }

  let confirmed = stackInfo;

  if (action === 'edit' || action === 'manual') {
    const dimensions = [
      { key: 'framework', label: '框架' },
      { key: 'language', label: '语言' },
      { key: 'styling', label: '样式方案' },
      { key: 'stateManagement', label: '状态管理' },
      { key: 'routing', label: '路由' },
      { key: 'componentPattern', label: '组件模式' },
    ] as const;

    const toEdit = action === 'manual'
      ? dimensions.map((d) => d.key)
      : await selectDimensionsToEdit(dimensions, stackInfo);

    for (const key of toEdit) {
      const dim = dimensions.find((d) => d.key === key)!;
      const current = stackInfo[key as keyof StackInfo] as DetectedItem | undefined;
      const { value } = await inquirer.prompt<{ value: string }>([{
        type: 'input',
        name: 'value',
        message: `${dim.label}:`,
        default: current?.value ?? '',
      }]);

      if (value.trim()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (confirmed as any)[key] = {
          value: value.trim(),
          confidence: 'high' as const,
          evidence: '用户手动输入',
        };
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (confirmed as any)[key] = undefined;
      }
    }
  }

  // Regenerate hints to reflect any user-edited fields (e.g., Emotion → Tailwind CSS)
  if (action === 'edit' || action === 'manual') {
    confirmed.designToCodeHints = generateDesignToCodeHints(confirmed);
    confirmed.codeToDesignHints = generateCodeToDesignHints(confirmed);
  }

  // collect project conventions
  const conventions = await collectConventions();

  return { confirmed, conventions };
}

async function selectDimensionsToEdit(
  dimensions: readonly { key: string; label: string }[],
  stackInfo: StackInfo,
): Promise<string[]> {
  const { selected } = await inquirer.prompt<{ selected: string[] }>([{
    type: 'checkbox',
    name: 'selected',
    message: '选择需要修正的项:',
    choices: dimensions.map((d) => ({
      name: `${d.label}: ${(stackInfo[d.key as keyof StackInfo] as DetectedItem | undefined)?.value ?? '(未检测到)'}`,
      value: d.key,
    })),
  }]);
  return selected;
}

async function collectConventions(): Promise<string[]> {
  const { wantConventions } = await inquirer.prompt<{ wantConventions: boolean }>([{
    type: 'confirm',
    name: 'wantConventions',
    message: '是否有项目特殊约定需要补充？（会写入 prompt 帮助 AI 更准确地翻译代码）',
    default: false,
  }]);

  if (!wantConventions) return [];

  const conventions: string[] = [];
  log.dim('  每行输入一条约定，直接回车结束输入');

  while (true) {
    const { line } = await inquirer.prompt<{ line: string }>([{
      type: 'input',
      name: 'line',
      message: '>',
    }]);
    if (!line.trim()) break;
    conventions.push(line.trim());
  }

  if (conventions.length > 0) {
    log.success(`已保存 ${conventions.length} 条项目约定`);
  }

  return conventions;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();
  const wsName = options.workspace ?? 'default';
  const manager = new WorkspaceManager(resolve(cwd, '.codeferry'));

  // Migrate legacy flat structure if needed (no-op if already new layout or brand new)
  await manager.migrateIfNeeded();

  const wsPath = manager.workspacePath(wsName);
  const store = new StateStore(wsPath);

  // check existing
  if (await store.exists() && !options.force) {
    log.warn(`工作区 '${wsName}' 已存在。使用 --force 强制重新初始化`);
    return;
  }

  const designRoot = resolvePath(options.design);
  const codeRoot = resolvePath(options.code);

  // Step 1: create workspace directory
  const s1 = spinner(`创建工作区 '${wsName}'...`);
  s1.start();
  await manager.create(wsName).catch(() => store.init()); // if already exists (--force), just init
  await store.init();
  s1.succeed(`已创建工作区 '${wsName}'`);

  // Step 2: detect stack (with interactive confirmation)
  let stackInfo: StackInfo = { designToCodeHints: [], codeToDesignHints: [] };
  let conventions: string[] = [];

  if (!options.skipDetect) {
    const s2 = spinner('正在分析代码侧技术栈...');
    s2.start();
    stackInfo = await detectStack(codeRoot);
    s2.succeed('技术栈检测完成');

    const result = await confirmStack(stackInfo);
    stackInfo = result.confirmed;
    conventions = result.conventions;
  }

  // Step 3: write config
  const config: DriftConfig = {
    version: '2.0',
    design: {
      root: options.design,
      include: ['**/*.jsx', '**/*.tsx', '**/*.html', '**/*.css'],
      exclude: ['design-canvas.jsx', 'i18n.jsx'],
    },
    code: {
      root: options.code,
      include: ['**/*.tsx', '**/*.ts', '**/*.jsx', '**/*.js', '**/*.vue', '**/*.svelte', '**/*.css', '**/*.scss'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.nuxt/**'],
    },
    ai: {
      model: 'claude-sonnet-4-20250514',
      batchSize: 5,
      maxConcurrency: 3,
    },
  };

  const stackSummary = [
    stackInfo.framework?.value,
    stackInfo.language?.value,
    stackInfo.styling?.value,
  ].filter(Boolean).join(' + ');

  const hasProjectInfo =
    stackSummary ||
    conventions.length > 0 ||
    stackInfo.designToCodeHints.length > 0 ||
    stackInfo.codeToDesignHints.length > 0;

  if (hasProjectInfo) {
    config.project = {};
    if (stackSummary) config.project.stack = stackSummary;
    if (conventions.length > 0) config.project.conventions = conventions;
    // Persist framework-specific hints so `drift sync` can use them without re-running detectStack
    if (stackInfo.designToCodeHints.length > 0) {
      config.project.designToCodeHints = stackInfo.designToCodeHints;
    }
    if (stackInfo.codeToDesignHints.length > 0) {
      config.project.codeToDesignHints = stackInfo.codeToDesignHints;
    }
  }

  await store.saveConfig(config);
  log.success('配置已写入 codeferry.config.json');

  // Step 4: extract design components
  const s4 = spinner('正在提取设计稿组件...');
  s4.start();
  const designInclude = config.design.include.filter((p) => p.endsWith('.jsx') || p.endsWith('.tsx'));
  const extractions = await extractAll(designRoot, designInclude, config.design.exclude);
  s4.succeed('设计稿组件提取完成');
  printExtractionSummary(extractions);

  // Step 5: scan code files
  const s5 = spinner('正在扫描代码文件...');
  s5.start();
  const codeScan = await scan({ root: codeRoot, include: config.code.include, exclude: config.code.exclude });
  s5.succeed('代码文件扫描完成');
  printScanSummary('code', Object.keys(codeScan.files).length);

  // Step 6: scan design files
  const designScan = await scan({ root: designRoot, include: config.design.include, exclude: config.design.exclude });

  // Step 7: build initial registry (no mapping yet — that's Phase 2)
  const registry: ComponentRegistry = {
    version: '2.0',
    updatedAt: Date.now(),
    components: {},
    unmappedDesign: [],
    unmappedCode: Object.keys(codeScan.files),
  };

  for (const extraction of extractions) {
    for (const comp of extraction.components) {
      const id = `${extraction.file}::${comp.name}`;
      registry.components[id] = {
        id,
        name: comp.name,
        designFile: extraction.file,
        designStartLine: comp.startLine,
        designEndLine: comp.endLine,
        designHash: comp.hash,
        codeFiles: [],
        codeHash: '',
        mappingType: 'auto',
        mappingConfidence: 0,
        lastSyncedAt: null,
        designHashAtSync: null,
        codeHashAtSync: null,
        kind: comp.kind,
      };
      registry.unmappedDesign.push(id);
    }
  }

  await store.saveRegistry(registry);

  // Step 8: create initial snapshot
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
    snapshot.components[id] = {
      designHash: entry.designHash,
      codeHash: '',
      designMtime: designFileInfo?.mtime ?? 0,
      codeMtime: 0,
    };
  }

  await store.saveSnapshot(snapshot);

  // Done
  printInitComplete(Object.keys(registry.components).length, snapshotId);
  log.info(`下一步：运行 ${chalk.bold('codeferry map auto')} 自动建立组件映射关系`);
}
