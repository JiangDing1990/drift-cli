import { resolve } from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Table from 'cli-table3';
import { WorkspaceManager, validateWorkspaceName } from '../state/workspace.js';
import { initCommand } from './init.js';
import { log } from '../utils/logger.js';
import type { InitOptions } from './init.js';

function getManager(): WorkspaceManager {
  return new WorkspaceManager(resolve(process.cwd(), '.codeferry'));
}

// ── workspace list ────────────────────────────────────────────────────────────

export async function workspaceListCommand(): Promise<void> {
  const manager = getManager();

  if (!(await manager.exists())) {
    log.error('未找到 .codeferry/ 目录，请先运行 codeferry init');
    process.exit(1);
  }

  await manager.migrateIfNeeded();
  const workspaces = await manager.list();

  if (workspaces.length === 0) {
    log.info('暂无工作区，运行 codeferry init 创建第一个工作区');
    return;
  }

  const table = new Table({
    head: ['', 'WORKSPACE', 'DESIGN', 'CODE', 'COMPONENTS'].map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  for (const ws of workspaces) {
    table.push([
      ws.isCurrent ? chalk.green('*') : ' ',
      ws.isCurrent ? chalk.green(ws.name) : ws.name,
      ws.designRoot ? chalk.gray(truncate(ws.designRoot, 30)) : chalk.dim('—'),
      ws.codeRoot ? chalk.gray(truncate(ws.codeRoot, 30)) : chalk.dim('—'),
      String(ws.componentCount),
    ]);
  }

  console.log();
  console.log(table.toString());
  console.log();
}

// ── workspace current ─────────────────────────────────────────────────────────

export async function workspaceCurrentCommand(): Promise<void> {
  const manager = getManager();

  if (!(await manager.exists())) {
    log.error('未找到 .codeferry/ 目录，请先运行 codeferry init');
    process.exit(1);
  }

  await manager.migrateIfNeeded();
  const current = await manager.getCurrentWorkspace();
  console.log(current);
}

// ── workspace use ─────────────────────────────────────────────────────────────

export async function workspaceUseCommand(name: string): Promise<void> {
  const manager = getManager();

  if (!(await manager.exists())) {
    log.error('未找到 .codeferry/ 目录，请先运行 codeferry init');
    process.exit(1);
  }

  await manager.migrateIfNeeded();

  try {
    await manager.setCurrentWorkspace(name);
    log.success(`已切换到工作区 '${chalk.bold(name)}'`);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── workspace create ──────────────────────────────────────────────────────────

export async function workspaceCreateCommand(
  name: string,
  opts: { design?: string; code?: string; skipDetect?: boolean },
): Promise<void> {
  const validationError = validateWorkspaceName(name);
  if (validationError) {
    log.error(validationError);
    process.exit(1);
  }

  const manager = getManager();
  await manager.migrateIfNeeded();

  // Collect required paths interactively if not provided
  let designPath = opts.design;
  let codePath = opts.code;

  if (!designPath) {
    const { design } = await inquirer.prompt<{ design: string }>([{
      type: 'input',
      name: 'design',
      message: '设计稿根目录路径 (--design):',
    }]);
    designPath = design;
  }

  if (!codePath) {
    const { code } = await inquirer.prompt<{ code: string }>([{
      type: 'input',
      name: 'code',
      message: '代码项目根目录路径 (--code):',
    }]);
    codePath = code;
  }

  if (!designPath || !codePath) {
    log.error('必须提供 --design 和 --code 路径');
    process.exit(1);
  }

  const initOpts: InitOptions = {
    design: designPath,
    code: codePath,
    skipDetect: opts.skipDetect,
    workspace: name,
  };

  await initCommand(initOpts);
  log.info(`ℹ 当前工作区已切换到 '${chalk.bold(name)}'`);
}

// ── workspace remove ──────────────────────────────────────────────────────────

export async function workspaceRemoveCommand(
  name: string,
  opts: { force?: boolean },
): Promise<void> {
  const manager = getManager();

  if (!(await manager.exists())) {
    log.error('未找到 .codeferry/ 目录，请先运行 codeferry init');
    process.exit(1);
  }

  await manager.migrateIfNeeded();

  if (!opts.force) {
    const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([{
      type: 'confirm',
      name: 'confirmed',
      message: `确认删除工作区 '${chalk.red(name)}'？此操作不可恢复`,
      default: false,
    }]);

    if (!confirmed) {
      log.info('已取消');
      return;
    }
  }

  try {
    await manager.remove(name, opts.force);
    log.success(`已删除工作区 '${name}'`);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `...${s.slice(-(maxLen - 3))}`;
}
