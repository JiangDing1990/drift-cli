import { describe, it, expect } from 'vitest';
import { computeStatus, computeAllStatuses, generateComponentDiff, colorizeUnifiedDiff } from '../src/core/differ.js';
import type { ComponentEntry, ComponentRegistry } from '../src/types/index.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_HASH = 'aaa000';
const DESIGN_HASH_NEW = 'bbb111';
const CODE_HASH_NEW = 'ccc222';

function makeEntry(overrides: Partial<ComponentEntry> = {}): ComponentEntry {
  return {
    id: 'file.jsx::TestComp',
    name: 'TestComp',
    designFile: 'file.jsx',
    designStartLine: 1,
    designEndLine: 20,
    designHash: BASE_HASH,
    codeFiles: ['src/test.tsx'],
    codeHash: BASE_HASH,
    mappingType: 'auto',
    mappingConfidence: 0.9,
    lastSyncedAt: null,
    designHashAtSync: BASE_HASH,
    codeHashAtSync: BASE_HASH,
    kind: 'page',
    ...overrides,
  };
}

function makeRegistry(
  components: Record<string, ComponentEntry>,
  unmappedCode: string[] = [],
): ComponentRegistry {
  return {
    version: '2.0',
    updatedAt: Date.now(),
    components,
    unmappedDesign: [],
    unmappedCode,
  };
}

// ── computeStatus ─────────────────────────────────────────────────────────────

describe('computeStatus', () => {
  it('returns new-design when codeFiles is empty', () => {
    const entry = makeEntry({ codeFiles: [], codeHash: '' });
    expect(computeStatus(entry)).toBe('new-design');
  });

  it('returns never-synced when baseline hashes are null', () => {
    const entry = makeEntry({ designHashAtSync: null, codeHashAtSync: null });
    expect(computeStatus(entry)).toBe('never-synced');
  });

  it('returns never-synced when only designHashAtSync is null', () => {
    const entry = makeEntry({ designHashAtSync: null, codeHashAtSync: BASE_HASH });
    expect(computeStatus(entry)).toBe('never-synced');
  });

  it('returns never-synced when only codeHashAtSync is null', () => {
    const entry = makeEntry({ designHashAtSync: BASE_HASH, codeHashAtSync: null });
    expect(computeStatus(entry)).toBe('never-synced');
  });

  it('returns synced when both hashes equal baseline', () => {
    const entry = makeEntry(); // all hashes are BASE_HASH
    expect(computeStatus(entry)).toBe('synced');
  });

  it('returns design-ahead when design changed but code did not', () => {
    const entry = makeEntry({ designHash: DESIGN_HASH_NEW });
    expect(computeStatus(entry)).toBe('design-ahead');
  });

  it('returns code-ahead when code changed but design did not', () => {
    const entry = makeEntry({ codeHash: CODE_HASH_NEW });
    expect(computeStatus(entry)).toBe('code-ahead');
  });

  it('returns both-changed when both sides changed', () => {
    const entry = makeEntry({ designHash: DESIGN_HASH_NEW, codeHash: CODE_HASH_NEW });
    expect(computeStatus(entry)).toBe('both-changed');
  });

  it('treats empty string codeHash as unchanged', () => {
    // Right after init, codeHash is '' — should not count as a change
    const entry = makeEntry({ codeHash: '', codeHashAtSync: BASE_HASH });
    expect(computeStatus(entry)).toBe('synced');
  });
});

// ── computeAllStatuses ────────────────────────────────────────────────────────

describe('computeAllStatuses', () => {
  it('computes correct summary counts', () => {
    const registry = makeRegistry(
      {
        'a.jsx::SyncedComp': makeEntry({ id: 'a.jsx::SyncedComp', name: 'SyncedComp' }),
        'b.jsx::DesignAheadComp': makeEntry({
          id: 'b.jsx::DesignAheadComp',
          name: 'DesignAheadComp',
          designHash: DESIGN_HASH_NEW,
        }),
        'c.jsx::CodeAheadComp': makeEntry({
          id: 'c.jsx::CodeAheadComp',
          name: 'CodeAheadComp',
          codeHash: CODE_HASH_NEW,
        }),
        'd.jsx::ConflictComp': makeEntry({
          id: 'd.jsx::ConflictComp',
          name: 'ConflictComp',
          designHash: DESIGN_HASH_NEW,
          codeHash: CODE_HASH_NEW,
        }),
        'e.jsx::UnmappedComp': makeEntry({
          id: 'e.jsx::UnmappedComp',
          name: 'UnmappedComp',
          codeFiles: [],
          codeHash: '',
        }),
        'f.jsx::NeverSyncedComp': makeEntry({
          id: 'f.jsx::NeverSyncedComp',
          name: 'NeverSyncedComp',
          designHashAtSync: null,
          codeHashAtSync: null,
        }),
      },
      ['orphan.tsx', 'another-orphan.tsx'],
    );

    const result = computeAllStatuses(registry);

    expect(result.summary.synced).toBe(1);
    expect(result.summary.designAhead).toBe(1);
    expect(result.summary.codeAhead).toBe(1);
    expect(result.summary.conflicts).toBe(1);
    expect(result.summary.newDesign).toBe(1);
    expect(result.summary.neverSynced).toBe(1);
    expect(result.summary.newCode).toBe(2); // from unmappedCode
  });

  it('includes changed components in changedComponents list', () => {
    const registry = makeRegistry({
      'x.jsx::AheadComp': makeEntry({
        id: 'x.jsx::AheadComp',
        name: 'AheadComp',
        designHash: DESIGN_HASH_NEW,
      }),
      'y.jsx::SyncedComp': makeEntry({ id: 'y.jsx::SyncedComp', name: 'SyncedComp' }),
    });

    const result = computeAllStatuses(registry);
    expect(result.changedComponents).toHaveLength(1);
    expect(result.changedComponents[0].id).toBe('x.jsx::AheadComp');
    expect(result.changedComponents[0].status).toBe('design-ahead');
  });

  it('stores individual component statuses in componentStatuses map', () => {
    const registry = makeRegistry({
      'z.jsx::Comp': makeEntry({
        id: 'z.jsx::Comp',
        name: 'Comp',
        codeHash: CODE_HASH_NEW,
      }),
    });

    const result = computeAllStatuses(registry);
    expect(result.componentStatuses['z.jsx::Comp']).toBe('code-ahead');
  });

  it('handles empty registry', () => {
    const registry = makeRegistry({});
    const result = computeAllStatuses(registry);
    expect(result.summary.synced).toBe(0);
    expect(result.changedComponents).toHaveLength(0);
  });
});

// ── generateComponentDiff ─────────────────────────────────────────────────────

describe('generateComponentDiff', () => {
  it('returns empty string when baseline and current are identical', () => {
    const content = 'function Foo() {\n  return <div>Hello</div>;\n}\n';
    expect(generateComponentDiff(content, content, 'Foo.jsx', 'baseline@abc')).toBe('');
  });

  it('returns a unified diff patch when content differs', () => {
    const baseline = 'function Foo() {\n  return <div>Hello</div>;\n}\n';
    const current = 'function Foo() {\n  return <div>World</div>;\n}\n';
    const patch = generateComponentDiff(baseline, current, 'Foo.jsx [Foo]', 'baseline@abc12345');
    expect(patch).toBeTruthy();
    expect(patch).toContain('-  return <div>Hello</div>;');
    expect(patch).toContain('+  return <div>World</div>;');
  });

  it('patch header includes the provided label and baselineRef', () => {
    const baseline = 'old content\n';
    const current = 'new content\n';
    const patch = generateComponentDiff(baseline, current, 'pages/Home.jsx', 'baseline@deadbeef');
    expect(patch).toContain('pages/Home.jsx');
    expect(patch).toContain('baseline@deadbeef');
  });

  it('returns a full-addition diff when baseline is empty string', () => {
    const current = 'function Bar() {\n  return null;\n}\n';
    const patch = generateComponentDiff('', current, 'Bar.jsx', 'baseline@none');
    expect(patch).toBeTruthy();
    // All non-header lines in the hunk should be additions
    const hunkLines = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    expect(hunkLines.length).toBeGreaterThan(0);
  });

  it('includes @@ hunk headers in the patch', () => {
    const baseline = 'a\nb\nc\n';
    const current = 'a\nB\nc\n';
    const patch = generateComponentDiff(baseline, current, 'file.tsx', 'ref');
    expect(patch).toContain('@@');
  });
});

// ── colorizeUnifiedDiff ───────────────────────────────────────────────────────

describe('colorizeUnifiedDiff', () => {
  it('wraps + lines with green ANSI codes', () => {
    const patch = '+added line\n';
    const colored = colorizeUnifiedDiff(patch);
    expect(colored).toContain('\x1b[32m+added line\x1b[0m');
  });

  it('wraps - lines with red ANSI codes', () => {
    const patch = '-removed line\n';
    const colored = colorizeUnifiedDiff(patch);
    expect(colored).toContain('\x1b[31m-removed line\x1b[0m');
  });

  it('wraps @@ hunk headers with cyan ANSI codes', () => {
    const patch = '@@ -1,3 +1,3 @@\n';
    const colored = colorizeUnifiedDiff(patch);
    expect(colored).toContain('\x1b[36m@@ -1,3 +1,3 @@\x1b[0m');
  });

  it('wraps --- / +++ headers with bold ANSI codes (takes precedence over +/- coloring)', () => {
    const patch = '--- baseline\n+++ current\n';
    const colored = colorizeUnifiedDiff(patch);
    expect(colored).toContain('\x1b[1m--- baseline\x1b[0m');
    expect(colored).toContain('\x1b[1m+++ current\x1b[0m');
    // Should NOT be colored green/red — bold takes priority
    expect(colored).not.toContain('\x1b[32m+++ current\x1b[0m');
    expect(colored).not.toContain('\x1b[31m--- baseline\x1b[0m');
  });

  it('wraps context lines with gray ANSI codes', () => {
    const patch = ' context line\n';
    const colored = colorizeUnifiedDiff(patch);
    expect(colored).toContain('\x1b[90m context line\x1b[0m');
  });

  it('preserves newlines between lines', () => {
    const patch = '+added\n-removed\n context\n';
    const colored = colorizeUnifiedDiff(patch);
    const lines = colored.split('\n');
    expect(lines.length).toBe(4); // 3 lines + trailing empty from split
  });

  it('handles a single blank line gracefully (gray-colors it)', () => {
    // '' split by '\n' produces [''] — colorized as a gray context line, not stripped
    const result = colorizeUnifiedDiff('');
    expect(result).toContain('\x1b[90m');
    expect(result).toContain('\x1b[0m');
  });
});
