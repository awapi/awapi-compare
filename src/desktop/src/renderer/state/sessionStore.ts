import { create } from 'zustand';
import {
  DEFAULT_DIFF_OPTIONS,
  cloneDiffOptions,
  type ComparedPair,
  type CompareMode,
  type DiffOptions,
  type Rule,
  type ScanProgress,
  type Session,
} from '@awapi/shared';
import type { ViewFilter } from '../viewFilter.js';

/**
 * Subset of session state that is safe to persist or hand off via
 * `session.save` / `session.load` IPC. Excludes transient runtime
 * fields like `pairs`, `scanning`, and `progress`.
 */
export interface SessionSnapshot {
  id: string;
  name?: string;
  leftRoot: string;
  rightRoot: string;
  mode: CompareMode;
  rules: Rule[];
  /** Per-session match policy (Phase 6.5). */
  diffOptions: DiffOptions;
  createdAt: number;
  updatedAt: number;
}

export interface SessionState extends SessionSnapshot {
  /** Last scan result. Cleared when roots/mode change. */
  pairs: ComparedPair[];
  /** True while a scan is in flight. */
  scanning: boolean;
  /** Live progress from `fs.scan.progress`. */
  progress: ScanProgress | null;
  /** rel-path of the currently selected pair, if any. */
  selectedPath: string | null;
  /** Last scan error message, or null. */
  error: string | null;
  /**
   * Renderer-only filter applied on top of the scan result. Controls
   * which rows are visible in the folder tree (and is also forwarded
   * to file-diff tabs for text/hex content filtering).
   */
  viewFilter: ViewFilter;

  setLeftRoot(value: string): void;
  setRightRoot(value: string): void;
  setMode(mode: CompareMode): void;
  setRules(rules: Rule[]): void;
  setDiffOptions(diffOptions: DiffOptions): void;
  setName(name: string | undefined): void;
  setPairs(pairs: ComparedPair[]): void;
  setScanning(scanning: boolean): void;
  setProgress(progress: ScanProgress | null): void;
  setSelectedPath(relPath: string | null): void;
  setError(error: string | null): void;
  setViewFilter(viewFilter: ViewFilter): void;
  /**
   * Locally re-classify a pair as `identical`. Used by the
   * "Mark same" command. Does not touch the filesystem.
   */
  markSame(relPath: string): void;
  /**
   * Locally re-classify a pair as `excluded`. Does not write a rule;
   * persistent exclusions belong in the rules engine (Phase 6).
   */
  excludePath(relPath: string): void;

  /** Replace the entire session from a snapshot (e.g. after `session.load`). */
  loadSnapshot(snapshot: SessionSnapshot): void;
  /** Project the persistable subset of state. */
  toSnapshot(): SessionSnapshot;
  /** Convert the snapshot to the wire `Session` shape used by IPC. */
  toSession(): Session;
}

export interface CreateSessionStoreOptions {
  /** Initial snapshot. Defaults to {@link createEmptySnapshot}. */
  initial?: Partial<SessionSnapshot>;
  /** Inject an id generator (tests). */
  generateId?: () => string;
  /** Inject a clock (tests). Returns epoch ms. */
  now?: () => number;
}

export function createEmptySnapshot(
  generateId: () => string = defaultGenerateId,
  now: () => number = Date.now,
): SessionSnapshot {
  const ts = now();
  return {
    id: generateId(),
    leftRoot: '',
    rightRoot: '',
    mode: 'quick',
    rules: [],
    diffOptions: cloneDiffOptions(DEFAULT_DIFF_OPTIONS),
    createdAt: ts,
    updatedAt: ts,
  };
}

function defaultGenerateId(): string {
  // Renderer always has crypto via Web Crypto API.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

/**
 * Create a Zustand session store. Exposed as a factory so tests can
 * inject deterministic ids/time and instantiate isolated stores.
 */
export function createSessionStore(options: CreateSessionStoreOptions = {}) {
  const { initial, generateId = defaultGenerateId, now = Date.now } = options;
  const base: SessionSnapshot = {
    ...createEmptySnapshot(generateId, now),
    ...initial,
  };

  return create<SessionState>((set, get) => ({
    ...base,
    pairs: [],
    scanning: false,
    progress: null,
    selectedPath: null,
    error: null,
    viewFilter: 'all',

    setLeftRoot: (value) =>
      set({ leftRoot: value, pairs: [], selectedPath: null, updatedAt: now() }),
    setRightRoot: (value) =>
      set({ rightRoot: value, pairs: [], selectedPath: null, updatedAt: now() }),
    setMode: (mode) => set({ mode, pairs: [], selectedPath: null, updatedAt: now() }),
    setRules: (rules) => set({ rules, updatedAt: now() }),
    setDiffOptions: (diffOptions) => set({ diffOptions, updatedAt: now() }),
    setName: (name) => set({ name, updatedAt: now() }),
    setPairs: (pairs) => set({ pairs, selectedPath: null }),
    setScanning: (scanning) => set({ scanning }),
    setProgress: (progress) => set({ progress }),
    setSelectedPath: (selectedPath) => set({ selectedPath }),
    setError: (error) => set({ error }),
    setViewFilter: (viewFilter) => set({ viewFilter }),

    markSame: (relPath) =>
      set((s) => ({
        pairs: s.pairs.map((p) =>
          p.relPath === relPath ? { ...p, status: 'identical' } : p,
        ),
      })),

    excludePath: (relPath) =>
      set((s) => ({
        pairs: s.pairs.map((p) =>
          p.relPath === relPath ? { ...p, status: 'excluded' } : p,
        ),
      })),

    loadSnapshot: (snapshot) =>
      set({
        ...snapshot,
        pairs: [],
        progress: null,
        scanning: false,
        selectedPath: null,
        error: null,
        viewFilter: 'all',
      }),

    toSnapshot: () => {
      const s = get();
      return {
        id: s.id,
        name: s.name,
        leftRoot: s.leftRoot,
        rightRoot: s.rightRoot,
        mode: s.mode,
        rules: s.rules,
        diffOptions: s.diffOptions,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    },

    toSession: () => {
      const s = get();
      return {
        id: s.id,
        name: s.name,
        leftRoot: s.leftRoot,
        rightRoot: s.rightRoot,
        mode: s.mode,
        rules: s.rules,
        diffOptions: s.diffOptions,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    },
  }));
}

export type SessionStore = ReturnType<typeof createSessionStore>;
