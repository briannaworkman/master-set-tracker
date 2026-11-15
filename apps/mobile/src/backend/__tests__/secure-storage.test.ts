const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

import { secureStorage } from '../secure-storage';

const store = mockStore;

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

beforeEach(() => store.clear());

describe('secureStorage', () => {
  it('stores small values under the plain key', async () => {
    await secureStorage.setItem('k', 'hello');
    expect(store.get('k')).toBe('hello');
    expect(await secureStorage.getItem('k')).toBe('hello');
  });

  it('round-trips a 5 KB value in chunks of at most 1800 bytes and removes all chunks', async () => {
    const value = 'abcdefghij'.repeat(520);
    await secureStorage.setItem('k', value);
    expect(store.size).toBeGreaterThan(2);
    for (const v of store.values()) expect(bytes(v)).toBeLessThanOrEqual(1800);
    expect(await secureStorage.getItem('k')).toBe(value);
    await secureStorage.removeItem('k');
    expect(store.size).toBe(0);
    expect(await secureStorage.getItem('k')).toBeNull();
  });

  it('measures chunk size in UTF-8 bytes, not string length', async () => {
    const value = '€'.repeat(2000); // 3 bytes each
    await secureStorage.setItem('k', value);
    for (const v of store.values()) expect(bytes(v)).toBeLessThanOrEqual(1800);
    expect(await secureStorage.getItem('k')).toBe(value);
  });

  it('removes previous chunks when overwriting', async () => {
    await secureStorage.setItem('k', 'x'.repeat(5000));
    await secureStorage.setItem('k', 'short');
    expect([...store.keys()]).toEqual(['k']);
    await secureStorage.setItem('k', 'y'.repeat(5000));
    await secureStorage.setItem('k', 'z'.repeat(2000));
    expect(await secureStorage.getItem('k')).toBe('z'.repeat(2000));
    expect(store.size).toBe(3); // 2 chunks + count
  });

  it('returns null (does not throw) when a chunk is missing', async () => {
    await secureStorage.setItem('k', 'x'.repeat(5000));
    store.delete('k.1');
    await expect(secureStorage.getItem('k')).resolves.toBeNull();
  });
});
