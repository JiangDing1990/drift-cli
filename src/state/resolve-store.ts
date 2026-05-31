import { resolve } from 'node:path';
import { WorkspaceManager } from './workspace.js';
import { log } from '../utils/logger.js';
import type { StateStore } from './store.js';

export async function resolveStore(workspaceFlag?: string): Promise<{
  store: StateStore;
  workspaceName: string;
}> {
  const cwd = process.cwd();
  const manager = new WorkspaceManager(resolve(cwd, '.codeferry'));

  if (!(await manager.exists())) {
    log.error('未找到 .codeferry/ 目录，请先运行 codeferry init');
    process.exit(1);
  }

  const migrated = await manager.migrateIfNeeded();
  if (migrated) {
    log.info('已将现有配置迁移到 \'default\' 工作区');
  }

  const { store, workspaceName } = await manager.getStore(workspaceFlag);

  if (!(await store.exists())) {
    log.error(`工作区 "${workspaceName}" 不存在，请先运行 codeferry workspace create ${workspaceName}`);
    process.exit(1);
  }

  return { store, workspaceName };
}
