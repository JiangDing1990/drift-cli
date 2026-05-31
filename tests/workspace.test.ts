import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { WorkspaceManager, validateWorkspaceName } from '../src/state/workspace.js';

let testDir: string;
let manager: WorkspaceManager;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'codeferry-ws-test-'));
  const codeferryDir = join(testDir, '.codeferry');
  await mkdir(codeferryDir, { recursive: true });
  manager = new WorkspaceManager(codeferryDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('validateWorkspaceName', () => {
  it('accepts valid names', () => {
    expect(validateWorkspaceName('default')).toBeNull();
    expect(validateWorkspaceName('mobile-app')).toBeNull();
    expect(validateWorkspaceName('admin_panel')).toBeNull();
    expect(validateWorkspaceName('v2')).toBeNull();
  });

  it('rejects invalid names', () => {
    expect(validateWorkspaceName('../hack')).not.toBeNull();
    expect(validateWorkspaceName('A B C')).not.toBeNull();
    expect(validateWorkspaceName('')).not.toBeNull();
    expect(validateWorkspaceName('-starts-with-dash')).not.toBeNull();
    expect(validateWorkspaceName('UPPERCASE')).not.toBeNull();
  });

  it('rejects reserved names', () => {
    expect(validateWorkspaceName('list')).not.toBeNull();
    expect(validateWorkspaceName('use')).not.toBeNull();
    expect(validateWorkspaceName('create')).not.toBeNull();
    expect(validateWorkspaceName('remove')).not.toBeNull();
    expect(validateWorkspaceName('current')).not.toBeNull();
  });
});

describe('WorkspaceManager', () => {
  describe('create', () => {
    it('creates workspace directory structure', async () => {
      const wsPath = await manager.create('mobile-app');
      expect(wsPath).toBe(manager.workspacePath('mobile-app'));

      await access(join(wsPath, 'snapshots'));
      await access(join(wsPath, 'history'));
    });

    it('rejects duplicate workspace name', async () => {
      await manager.create('mobile-app');
      await expect(manager.create('mobile-app')).rejects.toThrow('已存在');
    });

    it('rejects invalid workspace name', async () => {
      await expect(manager.create('../hack')).rejects.toThrow();
      await expect(manager.create('list')).rejects.toThrow('保留字');
    });

    it('sets new workspace as current', async () => {
      await manager.create('mobile-app');
      const current = await manager.getCurrentWorkspace();
      expect(current).toBe('mobile-app');
    });
  });

  describe('list', () => {
    it('lists all workspaces', async () => {
      await manager.create('alpha');
      await manager.create('beta');

      const workspaces = await manager.list();
      expect(workspaces).toHaveLength(2);
      expect(workspaces.map((w) => w.name)).toEqual(['alpha', 'beta']);
    });

    it('marks current workspace', async () => {
      await manager.create('alpha');
      await manager.create('beta');

      const workspaces = await manager.list();
      const current = workspaces.find((w) => w.isCurrent);
      expect(current?.name).toBe('beta');
    });
  });

  describe('remove', () => {
    it('removes a workspace', async () => {
      await manager.create('temp');
      await manager.remove('temp');
      const names = await manager.listNames();
      expect(names).not.toContain('temp');
    });

    it('rejects removing default without --force', async () => {
      await manager.create('default');
      await expect(manager.remove('default')).rejects.toThrow('--force');
    });

    it('allows removing default with force', async () => {
      await manager.create('default');
      await manager.create('other');
      await manager.remove('default', true);
      const names = await manager.listNames();
      expect(names).not.toContain('default');
    });

    it('switches current workspace after removing current', async () => {
      await manager.create('default');
      await manager.create('temp');
      await manager.setCurrentWorkspace('temp');
      await manager.remove('temp');
      const current = await manager.getCurrentWorkspace();
      expect(current).toBe('default');
    });

    it('rejects removing non-existent workspace', async () => {
      await expect(manager.remove('ghost')).rejects.toThrow('不存在');
    });
  });

  describe('resolveWorkspace', () => {
    it('prioritizes flag override', async () => {
      await manager.create('default');
      const name = await manager.resolveWorkspace('other');
      expect(name).toBe('other');
    });

    it('falls back to env variable', async () => {
      process.env['CODEFERRY_WORKSPACE'] = 'from-env';
      try {
        const name = await manager.resolveWorkspace();
        expect(name).toBe('from-env');
      } finally {
        delete process.env['CODEFERRY_WORKSPACE'];
      }
    });

    it('falls back to state.json current', async () => {
      await manager.create('alpha');
      await manager.setCurrentWorkspace('alpha');
      const name = await manager.resolveWorkspace();
      expect(name).toBe('alpha');
    });

    it('falls back to "default" when no state', async () => {
      const name = await manager.resolveWorkspace();
      expect(name).toBe('default');
    });
  });

  describe('getStore', () => {
    it('returns store pointing to correct workspace', async () => {
      await manager.create('mobile');
      const { store, workspaceName } = await manager.getStore('mobile');
      expect(workspaceName).toBe('mobile');
      expect(store.driftDir).toBe(manager.workspacePath('mobile'));
    });
  });

  describe('migrateIfNeeded', () => {
    it('migrates legacy flat structure to workspaces/default/', async () => {
      const codeferryDir = manager.codeferryDir;
      await writeFile(
        join(codeferryDir, 'codeferry.config.json'),
        JSON.stringify({ version: '2.0' }),
      );
      await writeFile(
        join(codeferryDir, 'registry.json'),
        JSON.stringify({ version: '2.0', components: {} }),
      );
      await mkdir(join(codeferryDir, 'snapshots'), { recursive: true });
      await writeFile(
        join(codeferryDir, 'snapshots', 'latest.json'),
        '{}',
      );

      const migrated = await manager.migrateIfNeeded();
      expect(migrated).toBe(true);

      const defaultWs = manager.workspacePath('default');
      const config = JSON.parse(await readFile(join(defaultWs, 'codeferry.config.json'), 'utf8'));
      expect(config.version).toBe('2.0');

      await access(join(defaultWs, 'registry.json'));
      await access(join(defaultWs, 'snapshots', 'latest.json'));

      const state = JSON.parse(await readFile(join(codeferryDir, 'state.json'), 'utf8'));
      expect(state.currentWorkspace).toBe('default');
    });

    it('is idempotent — second call returns false', async () => {
      const codeferryDir = manager.codeferryDir;
      await writeFile(
        join(codeferryDir, 'codeferry.config.json'),
        JSON.stringify({ version: '2.0' }),
      );

      const first = await manager.migrateIfNeeded();
      expect(first).toBe(true);

      const second = await manager.migrateIfNeeded();
      expect(second).toBe(false);
    });

    it('does nothing when no legacy files exist', async () => {
      const migrated = await manager.migrateIfNeeded();
      expect(migrated).toBe(false);
    });
  });
});
