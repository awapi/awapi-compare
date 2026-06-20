/**
 * Collects the per-item Explorer launches that result from a single
 * multi-select "Compare with AwapiCompare" invocation.
 *
 * Windows static (classic) context-menu verbs cannot receive a whole
 * selection in one launch — Explorer invokes the verb **once per
 * selected item**. With the app's single-instance lock, those launches
 * funnel into one process (the first becomes primary; the rest forward
 * their path via the `second-instance` event). This collector buffers
 * those single paths within a short window and resolves them into a
 * pair (or a lone path) so the app can open one comparison instead of
 * several blank windows.
 *
 * Pure and electron-free: timers are injected so the logic is fully
 * unit-testable with fake timers.
 */

export type CollectorTimer = ReturnType<typeof setTimeout>;

export interface MultiSelectCollectorOptions {
  /**
   * How long to wait for additional paths after the most recent one
   * before resolving the batch. Explorer fires the per-item launches
   * near-simultaneously, so a few hundred ms is ample.
   */
  windowMs?: number;
  /** Invoked with the collected paths once the batch settles (length ≥ 1). */
  onResolve: (paths: readonly string[]) => void;
  /** Injectable timer factory (defaults to global setTimeout). */
  setTimeoutFn?: (cb: () => void, ms: number) => CollectorTimer;
  /** Injectable timer canceller (defaults to global clearTimeout). */
  clearTimeoutFn?: (handle: CollectorTimer) => void;
}

const DEFAULT_WINDOW_MS = 600;

export class MultiSelectCollector {
  private readonly windowMs: number;
  private readonly onResolve: (paths: readonly string[]) => void;
  private readonly setTimeoutFn: (cb: () => void, ms: number) => CollectorTimer;
  private readonly clearTimeoutFn: (handle: CollectorTimer) => void;

  private paths: string[] = [];
  private timer: CollectorTimer | null = null;

  constructor(options: MultiSelectCollectorOptions) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.onResolve = options.onResolve;
    this.setTimeoutFn = options.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((h) => clearTimeout(h));
  }

  /**
   * Buffer one path from a single-item launch. Each call (re)starts the
   * settle timer so a rapid burst of launches is collected together.
   */
  add(path: string): void {
    this.paths.push(path);
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
    }
    this.timer = this.setTimeoutFn(() => this.flush(), this.windowMs);
  }

  /** True when at least one path is buffered and awaiting resolution. */
  get pending(): boolean {
    return this.paths.length > 0;
  }

  /** Resolve the current batch immediately, cancelling any pending timer. */
  flush(): void {
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    if (this.paths.length === 0) return;
    const batch = this.paths;
    this.paths = [];
    this.onResolve(batch);
  }
}
