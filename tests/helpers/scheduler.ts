import type { Scheduler } from '../../src/domain/playback-machine';

/** Manueller Scheduler für deterministische Zeit in Tests. */
export class ManualScheduler implements Scheduler {
  now = 0;
  private readonly timers = new Map<number, { at: number; cb: () => void }>();
  private seq = 0;

  setTimeout(cb: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + ms, cb });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Lässt `ms` Millisekunden vergehen und führt fällige Timer in zeitlicher Reihenfolge aus. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].cb();
    }
    this.now = target;
  }

  get pending(): number {
    return this.timers.size;
  }
}
