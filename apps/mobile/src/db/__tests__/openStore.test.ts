import Database from 'better-sqlite3';
import { openDatabaseSync } from 'expo-sqlite';
import { Platform } from 'react-native';
import type { ExpoSyncDatabase } from '../expo-sql-db';
import { openStore } from '../openStore';

jest.mock('expo-sqlite', () => ({ openDatabaseSync: jest.fn() }));
const openMock = jest.mocked(openDatabaseSync);

/** expo-sqlite's sync API over an in-memory better-sqlite3 database. */
function sqliteBackedExpoDb(): ExpoSyncDatabase {
  const db = new Database(':memory:');
  return {
    execSync: (sql) => void db.exec(sql),
    runSync: (sql, params) => db.prepare(sql).run(...params),
    getAllSync: <T,>(sql: string, params: unknown[]) => db.prepare(sql).all(...params) as T[],
    getFirstSync: <T,>(sql: string, params: unknown[]) => (db.prepare(sql).get(...params) as T | undefined) ?? null,
    withTransactionSync: (task) => db.transaction(task)(),
  };
}

const realOS = Platform.OS;
afterEach(() => {
  Platform.OS = realOS;
  jest.restoreAllMocks();
  openMock.mockReset();
});

describe('openStore', () => {
  it('opens collection.db and persists through the SQLite repo', () => {
    const db = sqliteBackedExpoDb();
    openMock.mockReturnValue(db as unknown as ReturnType<typeof openDatabaseSync>);
    const { store, persistent } = openStore();
    expect(openMock).toHaveBeenCalledWith('collection.db');
    expect(persistent).toBe(true);
    store.tap('fx', 'c-001', 'normal');
    expect(db.getFirstSync('SELECT count FROM collection WHERE card_id = ?', ['c-001'])).toEqual({ count: 1 });
  });

  it('exposes the repo and a price cache over the same database', () => {
    const db = sqliteBackedExpoDb();
    openMock.mockReturnValue(db as unknown as ReturnType<typeof openDatabaseSync>);
    const { store, repo, priceCache } = openStore();
    store.tap('fx', 'c-001', 'normal');
    expect(repo.dirtyCount()).toBe(1);
    priceCache.put('fx', '2026-11-15T00:00:00.000Z', { 'c-001|normal': 2.5 });
    expect(db.getFirstSync('SELECT set_id, fetched_at FROM prices', [])).toEqual({ set_id: 'fx', fetched_at: '2026-11-15T00:00:00.000Z' });
    expect(priceCache.get('fx')).toEqual({ fetchedAt: '2026-11-15T00:00:00.000Z', prices: { 'c-001|normal': 2.5 } });
  });

  it('falls back to an in-memory store on web when SQLite cannot open', () => {
    Platform.OS = 'web';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    openMock.mockImplementation(() => {
      throw new ReferenceError('SharedArrayBuffer is not defined');
    });
    const { store, repo, priceCache, persistent } = openStore();
    expect(persistent).toBe(false);
    store.track('fx');
    expect(repo.listTracked().map((t) => t.setId)).toEqual(['fx']);
    priceCache.put('fx', '2026-11-15T00:00:00.000Z', {});
    expect(priceCache.get('fx')).toEqual({ fetchedAt: '2026-11-15T00:00:00.000Z', prices: {} });
    expect(store.getTracked().map((t) => t.setId)).toEqual(['fx']);
  });

  it('rethrows on native platforms', () => {
    Platform.OS = 'ios';
    openMock.mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(() => openStore()).toThrow('disk full');
  });
});
