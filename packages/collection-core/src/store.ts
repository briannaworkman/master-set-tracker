import type { Counts } from './keys';
import { versionKey } from './keys';
import type { CollectionRepo, TrackedSet } from './db/sql-db';

export class CollectionStore {
  private listeners = new Set<() => void>();
  private tracked: TrackedSet[];
  private counts = new Map<string, Counts>();

  constructor(
    private readonly repo: CollectionRepo,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.tracked = repo.listTracked();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getTracked = (): TrackedSet[] => this.tracked;

  getCounts = (setId: string): Counts => {
    let c = this.counts.get(setId);
    if (!c) {
      c = this.repo.countsForSet(setId);
      this.counts.set(setId, c);
    }
    return c;
  };

  track(setId: string): void {
    this.repo.trackSet(setId, this.now());
    this.refreshTracked();
  }

  untrack(setId: string): void {
    this.repo.untrackSet(setId);
    this.refreshTracked();
  }

  setHidden(setId: string, ids: string[]): void {
    this.repo.setHiddenCategories(setId, ids);
    this.refreshTracked();
  }

  tap(setId: string, cardId: string, kind: string): void {
    const current = this.repo.countsForSet(setId)[versionKey(cardId, kind)] ?? 0;
    this.setCount(setId, cardId, kind, current + 1);
  }

  setCount(setId: string, cardId: string, kind: string, n: number): void {
    this.repo.setCount(setId, cardId, kind, n, this.now());
    const key = versionKey(cardId, kind);
    this.counts.set(setId, this.repo.countsForSet(setId));
    // The row is keyed globally, so another set's cached counts may have lost it.
    for (const [other, c] of this.counts) {
      if (other !== setId && key in c) this.counts.set(other, this.repo.countsForSet(other));
    }
    this.emit();
  }

  private refreshTracked(): void {
    const next = this.repo.listTracked();
    if (JSON.stringify(next) === JSON.stringify(this.tracked)) return;
    this.tracked = next;
    this.emit();
  }

  /** Calls every listener; rethrows the first error afterwards so none is swallowed. */
  private emit(): void {
    let failed = false;
    let first: unknown;
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (e) {
        if (!failed) {
          failed = true;
          first = e;
        }
      }
    }
    if (failed) throw first;
  }
}
