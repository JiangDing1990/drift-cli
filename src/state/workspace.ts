import { readFile, writeFile, mkdir, access, rename, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { StateStore } from './store.js';
import type { GlobalState, WorkspaceInfo } from '../types/index.js';

const WORKSPACE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const RESERVED_NAMES = new Set(['list', 'use', 'create', 'remove', 'current']);

export function validateWorkspaceName(name: string): string | null {
  if (!WORKSPACE_NAME_RE.test(name)) {
    return '工作区名称只能包含小写字母、数字、连字符和下划线（1-63 字符，以字母或数字开头）';
  }
  if (RESERVED_NAMES.has(name)) {
    return `"${name}" 是保留字，不能用作工作区名称`;
  }
  return null;
}

export class WorkspaceManager {
  readonly codeferryDir: string;

  constructor(codeferryDir: string) {
    this.codeferryDir = codeferryDir;
  }

  private statePath(): string {
    return join(this.codeferryDir, 'state.json');
  }

  private workspacesDir(): string {
    return join(this.codeferryDir, 'workspaces');
  }

  workspacePath(name: string): string {
    return join(this.workspacesDir(), name);
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.codeferryDir);
      return true;
    } catch {
      return false;
    }
  }

  private async readState(): Promise<GlobalState | null> {
    try {
      const raw = await readFile(this.statePath(), 'utf8');
      return JSON.parse(raw) as GlobalState;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private async writeState(state: GlobalState): Promise<void> {
    const filePath = this.statePath();
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, filePath);
  }

  async getCurrentWorkspace(): Promise<string> {
    const state = await this.readState();
    return state?.currentWorkspace ?? 'default';
  }

  async setCurrentWorkspace(name: string): Promise<void> {
    const wsPath = this.workspacePath(name);
    try {
      await access(wsPath);
    } catch {
      throw new Error(`工作区 "${name}" 不存在`);
    }
    await this.writeState({ version: '1.0', currentWorkspace: name });
  }

  async resolveWorkspace(flagOverride?: string): Promise<string> {
    if (flagOverride) return flagOverride;
    const envWs = process.env['CODEFERRY_WORKSPACE'];
    if (envWs) return envWs;
    return this.getCurrentWorkspace();
  }

  async getStore(flagOverride?: string): Promise<{ store: StateStore; workspaceName: string }> {
    await this.migrateIfNeeded();
    const name = await this.resolveWorkspace(flagOverride);
    const wsPath = this.workspacePath(name);
    return { store: new StateStore(wsPath), workspaceName: name };
  }

  async create(name: string): Promise<string> {
    const error = validateWorkspaceName(name);
    if (error) throw new Error(error);

    const wsPath = this.workspacePath(name);
    try {
      await access(wsPath);
      throw new Error(`工作区 "${name}" 已存在`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (err instanceof Error && err.message.includes('已存在')) throw err;
        throw err;
      }
    }

    await mkdir(join(wsPath, 'snapshots'), { recursive: true });
    await mkdir(join(wsPath, 'history'), { recursive: true });

    await this.setCurrentWorkspace(name);
    return wsPath;
  }

  async remove(name: string, force = false): Promise<void> {
    if (name === 'default' && !force) {
      throw new Error('不能删除 default 工作区，使用 --force 强制删除');
    }

    const wsPath = this.workspacePath(name);
    try {
      await access(wsPath);
    } catch {
      throw new Error(`工作区 "${name}" 不存在`);
    }

    await rm(wsPath, { recursive: true, force: true });

    const current = await this.getCurrentWorkspace();
    if (current === name) {
      const remaining = await this.listNames();
      const next = remaining.includes('default') ? 'default' : remaining[0];
      if (next) {
        await this.writeState({ version: '1.0', currentWorkspace: next });
      }
    }
  }

  async listNames(): Promise<string[]> {
    const wsDir = this.workspacesDir();
    try {
      const entries = await readdir(wsDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  }

  async list(): Promise<WorkspaceInfo[]> {
    const names = await this.listNames();
    const current = await this.getCurrentWorkspace();
    const result: WorkspaceInfo[] = [];

    for (const name of names) {
      const store = new StateStore(this.workspacePath(name));
      const config = await store.getConfig();
      const registry = await store.getRegistry();
      result.push({
        name,
        designRoot: config?.design.root ?? '',
        codeRoot: config?.code.root ?? '',
        componentCount: registry ? Object.keys(registry.components).length : 0,
        isCurrent: name === current,
      });
    }

    return result;
  }

  async migrateIfNeeded(): Promise<boolean> {
    const stateFile = this.statePath();
    try {
      await access(stateFile);
      return false;
    } catch {
      // state.json does not exist — check if legacy flat structure exists
    }

    const legacyConfig = join(this.codeferryDir, 'codeferry.config.json');
    try {
      await access(legacyConfig);
    } catch {
      return false;
    }

    const defaultWs = this.workspacePath('default');
    await mkdir(defaultWs, { recursive: true });

    const filesToMove = ['codeferry.config.json', 'registry.json', 'queue.json'];
    const dirsToMove = ['snapshots', 'history'];

    for (const file of filesToMove) {
      const src = join(this.codeferryDir, file);
      const dest = join(defaultWs, file);
      try {
        await access(src);
        await rename(src, dest);
      } catch {
        // file doesn't exist, skip
      }
    }

    for (const dir of dirsToMove) {
      const src = join(this.codeferryDir, dir);
      const dest = join(defaultWs, dir);
      try {
        await access(src);
        await rename(src, dest);
      } catch {
        // dir doesn't exist, skip
      }
    }

    await this.writeState({ version: '1.0', currentWorkspace: 'default' });
    return true;
  }
}
