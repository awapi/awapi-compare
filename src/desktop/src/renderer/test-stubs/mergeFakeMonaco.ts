import type {
  MergeDecoration,
  MergeDecorationsCollection,
  MergeEditorLike,
  MergeModelLike,
  MergeMonacoLike,
} from '../components/MergeView.js';
import type { RangeLike } from '../mergeEditing.js';

/** Line-based fake Monaco model; just enough for the merge view. */
export class FakeModel implements MergeModelLike {
  private value: string;
  private listeners: Array<() => void> = [];
  disposed = false;

  constructor(initial: string) {
    this.value = initial;
  }

  getValue(): string {
    return this.value;
  }

  setValue(next: string): void {
    this.value = next;
    for (const l of this.listeners) l();
  }

  private lines(): string[] {
    return this.value.split('\n');
  }

  getValueInRange(r: RangeLike): string {
    const lines = this.lines();
    const head = lines.slice(r.startLineNumber - 1, r.endLineNumber);
    if (r.endColumn === 1 && r.endLineNumber > r.startLineNumber) {
      return head.slice(0, -1).join('\n') + '\n';
    }
    return head.join('\n');
  }

  getLineMaxColumn(line: number): number {
    return (this.lines()[line - 1] ?? '').length + 1;
  }

  /** Replace whole lines `[startLine, endLine)` with `text` (already `\n`-terminated). */
  replaceLines(startLine: number, endLineExclusive: number, text: string): void {
    const lines = this.lines();
    const before = lines.slice(0, startLine - 1).join('\n');
    const after = lines.slice(endLineExclusive - 1).join('\n');
    this.value = (startLine > 1 ? before + '\n' : '') + text + after;
    for (const l of [...this.listeners]) l();
  }

  onDidChangeContent(cb: () => void): { dispose(): void } {
    this.listeners.push(cb);
    return { dispose: () => void (this.listeners = this.listeners.filter((l) => l !== cb)) };
  }

  dispose(): void {
    this.disposed = true;
  }
}

class FakeCollection implements MergeDecorationsCollection {
  decorations: MergeDecoration[] = [];
  set(next: MergeDecoration[]): void {
    this.decorations = next.map((d) => ({ ...d, range: { ...d.range } }));
  }
  getRanges(): RangeLike[] {
    return this.decorations.map((d) => d.range);
  }
  clear(): void {
    this.decorations = [];
  }
}

export class FakeEditor implements MergeEditorLike {
  readonly collections: FakeCollection[] = [];
  readonly revealed: number[] = [];
  readonly undoStops: number[] = [];
  private cursorListeners: Array<
    (e: { position: { lineNumber: number; column: number } }) => void
  > = [];
  disposed = false;

  constructor(
    readonly model: FakeModel,
    readonly options: Record<string, unknown>,
  ) {}

  executeEdits(_source: string, edits: Array<{ range: RangeLike; text: string }>): boolean {
    for (const edit of edits) {
      const { startLineNumber: start, endLineNumber: end } = edit.range;
      const removed = end - start;
      const added = edit.text === '' ? 0 : edit.text.split('\n').length - 1;
      const delta = added - removed;
      // Shift tracked decorations like Monaco: those below the edit move by
      // the line delta; those inside the replaced lines collapse.
      for (const c of this.collections) {
        for (const d of c.decorations) {
          if (d.range.startLineNumber >= start && d.range.endLineNumber < end) {
            d.range = {
              startLineNumber: start,
              startColumn: 1,
              endLineNumber: start,
              endColumn: 1,
            };
          } else if (d.range.startLineNumber >= end) {
            d.range.startLineNumber += delta;
            d.range.endLineNumber += delta;
          }
        }
      }
      this.model.replaceLines(start, end, edit.text);
    }
    return true;
  }

  pushUndoStop(): void {
    this.undoStops.push(1);
  }

  revealLineInCenter(line: number): void {
    this.revealed.push(line);
  }

  createDecorationsCollection(initial?: MergeDecoration[]): MergeDecorationsCollection {
    const c = new FakeCollection();
    if (initial) c.set(initial);
    this.collections.push(c);
    return c;
  }

  onDidChangeCursorPosition(
    cb: (e: { position: { lineNumber: number; column: number } }) => void,
  ): { dispose(): void } {
    this.cursorListeners.push(cb);
    return {
      dispose: () => void (this.cursorListeners = this.cursorListeners.filter((l) => l !== cb)),
    };
  }

  /** Simulate the user moving the caret. */
  moveCursor(lineNumber: number): void {
    for (const l of [...this.cursorListeners]) l({ position: { lineNumber, column: 1 } });
  }

  dispose(): void {
    this.disposed = true;
  }
}

export interface FakeMonaco extends MergeMonacoLike {
  models: FakeModel[];
  editors: FakeEditor[];
  /** Editors in creation order: left, base, right, result. */
  pane(name: 'left' | 'base' | 'right' | 'result'): FakeEditor;
}

export function createFakeMonaco(): FakeMonaco {
  const models: FakeModel[] = [];
  const editors: FakeEditor[] = [];
  const order = ['left', 'base', 'right', 'result'] as const;
  return {
    models,
    editors,
    pane: (name) => editors[order.indexOf(name)] as FakeEditor,
    editor: {
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
      createModel(value: string): MergeModelLike {
        const m = new FakeModel(value);
        models.push(m);
        return m;
      },
      create(_container, options): MergeEditorLike {
        const e = new FakeEditor(options['model'] as FakeModel, options);
        editors.push(e);
        return e;
      },
    },
  };
}
