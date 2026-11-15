import { CollectionStore, createMemoryRepo, createSqliteRepo } from '@mst/collection-core';
import { openDatabaseSync } from 'expo-sqlite';
import { Platform } from 'react-native';
import { createExpoSqlDb } from './expo-sql-db';

export interface OpenedStore {
  store: CollectionStore;
  /** False when changes live only in memory (the web fallback). */
  persistent: boolean;
}

/**
 * Opens the on-device collection database. On web, SQLite needs a cross-origin-isolated
 * page; if it can't open there, fall back to an in-memory store so the app still previews.
 */
export function openStore(): OpenedStore {
  try {
    const repo = createSqliteRepo(createExpoSqlDb(openDatabaseSync('collection.db')));
    return { store: new CollectionStore(repo), persistent: true };
  } catch (error) {
    if (Platform.OS !== 'web') throw error;
    console.warn('SQLite is unavailable on this page; using an in-memory store.', error);
    return { store: new CollectionStore(createMemoryRepo()), persistent: false };
  }
}

let appStore: OpenedStore | undefined;

/** The app's single store, opened on first use. */
export function getAppStore(): OpenedStore {
  appStore ??= openStore();
  return appStore;
}
