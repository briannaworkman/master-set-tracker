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
    this.setCount(setId, cardId, kind, (this.getCounts(setId)[versionKey(cardId, kind)] ?? 0) + 1);
  }

  setCount(setId: string, cardId: string, kind: string, n: number): void {
    this.repo.setCount(setId, cardId, kind, n, this.now());
    this.counts.set(setId, this.repo.countsForSet(setId));
    this.emit();
  }

  private refreshTracked(): void {
    this.tracked = this.repo.listTracked();
    this.emit();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
