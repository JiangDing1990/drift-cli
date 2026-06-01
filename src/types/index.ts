// ── Workspace ──

export interface GlobalState {
  version: '1.0';
  currentWorkspace: string;
}

export interface WorkspaceInfo {
  name: string;
  designRoot: string;
  codeRoot: string;
  componentCount: number;
  isCurrent: boolean;
}

// ── Config ──

export interface DriftConfig {
  version: '2.0';

  design: {
    root: string;
    include: string[];
    exclude: string[];
  };

  code: {
    root: string;
    include: string[];
    exclude: string[];
  };

  ai: {
    model: string;
    batchSize: number;
    maxConcurrency: number;
  };

  mapping?: {
    /**
     * Minimum confidence threshold for `codeferry map auto`.
     * Candidates below this score are skipped and left unmapped.
     * @default 0.5
     */
    autoThreshold?: number;
  };

  project?: {
    stack?: string;
    conventions?: string[];
    designNotes?: string[];
    /**
     * Persisted output of StackDetector — framework-specific conversion hints
     * written by `codeferry init` and consumed by `codeferry sync` to populate prompts.
     * May also be edited directly in codeferry.config.json.
     */
    designToCodeHints?: string[];
    codeToDesignHints?: string[];
  };
}

// ── Extractor ──

export interface ExtractedComponent {
  name: string;
  startLine: number;
  endLine: number;
  content: string;
  hash: string;
  kind: ComponentKind;
  dependencies: string[];
}

export interface ExtractionResult {
  file: string;
  components: ExtractedComponent[];
  fileHash: string;
}

// ── Registry ──

export type ComponentKind = 'page' | 'shared' | 'helper';

export interface ComponentEntry {
  id: string;
  name: string;

  designFile: string;
  designStartLine: number;
  designEndLine: number;
  designHash: string;

  codeFiles: string[];
  codeHash: string;
  mappingType: 'auto' | 'manual';
  mappingConfidence: number;

  lastSyncedAt: number | null;
  designHashAtSync: string | null;
  codeHashAtSync: string | null;

  kind: ComponentKind;
  note?: string;
}

export interface ComponentRegistry {
  version: '2.0';
  updatedAt: number;
  components: Record<string, ComponentEntry>;
  unmappedDesign: string[];
  unmappedCode: string[];
}

// ── Snapshot ──

export interface ComponentSnapshot {
  designHash: string;
  codeHash: string;
  designMtime: number;
  codeMtime: number;
  /**
   * Snapshot of the design-side component content at the time of the last sync baseline.
   * Used as the "before" side in `codeferry diff` unified diffs.
   * Omitted when the component content exceeds 100 KB (graceful degradation).
   */
  designContent?: string;
  /**
   * Snapshot of the code-side content at the time of the last sync baseline.
   * For multi-file mappings, files are joined with a separator (same as readCodeContent).
   * Omitted when content exceeds 100 KB.
   */
  codeContent?: string;
}

export interface FullSnapshot {
  id: string;
  capturedAt: number;
  components: Record<string, ComponentSnapshot>;
  designFileHashes: Record<string, string>;
  codeFileHashes: Record<string, string>;
}

// ── Scanner ──

export interface FileInfo {
  hash: string;
  mtime: number;
  size: number;
}

export interface ScanResult {
  files: Record<string, FileInfo>;
  scannedAt: number;
}

// ── Differ ──

export type ComponentSyncStatus =
  | 'synced'
  | 'design-ahead'
  | 'code-ahead'
  | 'both-changed'
  | 'never-synced'
  | 'new-design'
  | 'new-code';

export interface ComponentDiff {
  id: string;
  status: ComponentSyncStatus;
  diff?: string;
}

export interface DiffResult {
  componentStatuses: Record<string, ComponentSyncStatus>;
  changedComponents: ComponentDiff[];
  summary: {
    synced: number;
    designAhead: number;
    codeAhead: number;
    conflicts: number;
    neverSynced: number;
    newDesign: number;
    newCode: number;
  };
}

// ── Queue ──

export type IntentType =
  | 'feature-add'
  | 'style-change'
  | 'interaction-change'
  | 'layout-change'
  | 'refactor'
  | 'props-change'
  | 'logic-change'
  | 'content-change';

export type SyncDirection = 'design-to-code' | 'code-to-design';
export type QueueStatus = 'pending' | 'in-progress' | 'done' | 'skipped' | 'conflict';

export interface SyncQueueItem {
  id: string;
  componentId: string;
  direction: SyncDirection;
  status: QueueStatus;
  intent?: IntentType;
  summary?: string;
  impact?: 'high' | 'medium' | 'low';
  syncGuide?: string[];
  diff: string;
  createdAt: number;
  resolvedAt?: number;
  note?: string;
}

export interface SyncQueue {
  updatedAt: number;
  items: SyncQueueItem[];
}

// ── Stack Detector ──

export type Confidence = 'high' | 'medium' | 'low';

export interface DetectedItem {
  value: string;
  confidence: Confidence;
  evidence: string;
}

export interface StackInfo {
  framework?: DetectedItem;
  language?: DetectedItem;
  styling?: DetectedItem;
  stateManagement?: DetectedItem;
  routing?: DetectedItem;
  componentPattern?: DetectedItem;

  designToCodeHints: string[];
  codeToDesignHints: string[];
}

// ── Mapper ──

export interface MappingCandidate {
  designComponentId: string;
  codePath: string;
  confidence: number;
  reason: string;
}

/** Result returned by the AI mapping fallback for a single component. */
export interface AIMappingResult {
  componentId: string;
  codePath: string;
  confidence: number;
  reasoning: string;
}

// ── AI Analysis ──

export interface AIAnalysisResult {
  componentId: string;
  intent: IntentType;
  summary: string;
  impact: 'high' | 'medium' | 'low';
  syncGuide: string[];
  analysisNote?: string;
}
