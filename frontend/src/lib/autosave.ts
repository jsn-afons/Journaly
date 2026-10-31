/**
 * Debounced, non-overlapping saver. `change()` records the latest value and schedules a save after
 * `delayMs` of quiet; `flush()` saves now and resolves once nothing is pending. A save never runs
 * concurrently with another, and whatever was changed during a save is saved right after it.
 * If `save` throws, the saver stops (the value stays pending) until `resume()`; the error goes to `onError`.
 */
export class Autosaver<T> {
  private pending: { value: T } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private paused = false;

  constructor(private readonly save: (value: T) => Promise<void>, private readonly delayMs: number, private readonly onError: (error: unknown) => void = () => {}) {}

  change(value: T): void {
    this.pending = { value };
    if (this.paused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, this.delayMs);
  }

  get hasPending(): boolean { return this.pending !== null; }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.run();
  }

  /** Forget unsaved work (e.g. the user chose the disk version) and allow saving again. */
  discard(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.pending = null; this.paused = false; }

  resume(): void { this.paused = false; if (this.pending) void this.run(); }

  private async run(): Promise<void> {
    while (this.running) await this.running;          // never overlap saves
    if (!this.pending || this.paused) return;
    const { value } = this.pending; this.pending = null;
    this.running = this.save(value).catch((error) => {
      if (!this.pending) this.pending = { value };     // keep the unsaved value unless a newer one arrived
      this.paused = true; this.onError(error);
    }).finally(() => { this.running = null; });
    await this.running;
    if (this.pending && !this.paused) await this.run(); // edits made during the save
  }
}
