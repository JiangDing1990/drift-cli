import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type {
  DriftConfig,
  ComponentRegistry,
  FullSnapshot,
  SyncQueue,
} from '../types/index.js';

export class StateStore {
  readonly driftDir: string;

  constructor(driftDir: string) {
    this.driftDir = driftDir;
  }

  private path(...segments: string[]): string {
    return join(this.driftDir, ...segments);
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.driftDir);
      return true;
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    await mkdir(this.path('snapshots'), { recursive: true });
    await mkdir(this.path('history'), { recursive: true });
  }

  // ── Atomic JSON read/write ──

  private async readJson<T>(filePath: string): Promise<T | null> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (err: unknown) {
      // File not found is expected (state not yet initialised) — return null.
      // Any other I/O error (permissions, etc.) should bubble up.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(
        `${filePath} 内容无效（JSON 解析失败）。` +
        `如文件已损坏，请删除 .drift/ 目录后重新运行 drift init。`,
      );
    }
  }

  private async writeJson<T>(filePath: string, data: T): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, filePath);
  }

  // ── Config ──

  async getConfig(): Promise<DriftConfig | null> {
    return this.readJson<DriftConfig>(this.path('drift.config.json'));
  }

  async saveConfig(config: DriftConfig): Promise<void> {
    await this.writeJson(this.path('drift.config.json'), config);
  }

  // ── Registry ──

  async getRegistry(): Promise<ComponentRegistry | null> {
    return this.readJson<ComponentRegistry>(this.path('registry.json'));
  }

  async saveRegistry(registry: ComponentRegistry): Promise<void> {
    await this.writeJson(this.path('registry.json'), registry);
  }

  // ── Snapshot ──

  async getLatestSnapshot(): Promise<FullSnapshot | null> {
    return this.readJson<FullSnapshot>(this.path('snapshots', 'latest.json'));
  }

  async saveSnapshot(snapshot: FullSnapshot): Promise<void> {
    await this.writeJson(
      this.path('snapshots', `${snapshot.id}.json`),
      snapshot,
    );
    await this.writeJson(
      this.path('snapshots', 'latest.json'),
      snapshot,
    );
  }

  // ── Queue ──

  async getQueue(): Promise<SyncQueue> {
    const q = await this.readJson<SyncQueue>(this.path('queue.json'));
    return q ?? { updatedAt: Date.now(), items: [] };
  }

  async saveQueue(queue: SyncQueue): Promise<void> {
    await this.writeJson(this.path('queue.json'), queue);
  }

  // ── History ──

  async saveHistory(id: string, content: string): Promise<void> {
    const filePath = this.path('history', `${id}.md`);
    await writeFile(filePath, content, 'utf8');
  }
}
