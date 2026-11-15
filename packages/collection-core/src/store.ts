import type { Counts } from './keys';
import { clampCount, versionKey } from './keys';
import type { CollectionRepo, TrackedSet } from './db/sql-db';
import type { LocalChanges } from './sync/types';

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
    this.repo.untrackSet(setId, this.now());
    this.refreshTracked();
  }

  setHidden(setId: string, ids: string[]): void {
    this.repo.setHiddenCategories(setId, ids, this.now());
    this.refreshTracked();
  }

  tap(setId: string, cardId: string, kind: string): void {
    const current = this.getCounts(setId)[versionKey(cardId, kind)] ?? 0;
    this.setCount(setId, cardId, kind, current + 1);
  }

  /** Clamps to 0..999; a write that would not change the stored count is skipped entirely. */
  setCount(setId: string, cardId: string, kind: string, n: number): void {
    const key = versionKey(cardId, kind);
    const next = clampCount(n);
    if ((this.getCounts(setId)[key] ?? 0) === next) return;
    this.repo.setCount(setId, cardId, kind, next, this.now());
    this.counts.set(setId, this.repo.countsForSet(setId));
    // The row is keyed globally, so another set's cached counts may have lost it.
    for (const [other, c] of this.counts) {
      if (other !== setId && key in c) this.counts.set(other, this.repo.countsForSet(other));
    }
    this.emit();
  }

  /** Applies server rows; refreshes only the affected sets' cached counts and emits at most once. */
  applyRemote(changes: LocalChanges): void {
    const { affectedSetIds } = this.repo.applyRemote(changes);
    let changed = this.updateTracked();
    for (const setId of affectedSetIds) {
      if (!this.counts.has(setId)) continue;
      const next = this.repo.countsForSet(setId);
      if (JSON.stringify(next) === JSON.stringify(this.counts.get(setId))) continue;
      this.counts.set(setId, next);
      changed = true;
    }
    if (changed) this.emit();
  }

  /** Clears all local data (sign-out), resets the caches and emits once. */
  wipe(): void {
    this.repo.wipe();
    this.counts.clear();
    this.tracked = this.repo.listTracked();
    this.emit();
  }

  private updateTracked(): boolean {
    const next = this.repo.listTracked();
    if (JSON.stringify(next) === JSON.stringify(this.tracked)) return false;
    this.tracked = next;
    return true;
  }

  private refreshTracked(): void {
    if (this.updateTracked()) this.emit();
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
