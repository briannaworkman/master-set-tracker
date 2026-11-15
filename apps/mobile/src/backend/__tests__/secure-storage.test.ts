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

import * as SecureStore from 'expo-secure-store';
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
    expect(store.size).toBe(3); // 2 chunks + pointer
  });

  it('returns null (does not throw) when a chunk is missing', async () => {
    await secureStorage.setItem('k', 'x'.repeat(5000));
    const chunk = [...store.keys()].find((k) => /\.1$/.test(k))!;
    store.delete(chunk);
    await expect(secureStorage.getItem('k')).resolves.toBeNull();
  });
});

describe('secureStorage crash safety', () => {
  const setItemAsync = SecureStore.setItemAsync as jest.Mock;
  const deleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;
  const real = { set: setItemAsync.getMockImplementation()!, del: deleteItemAsync.getMockImplementation()! };
  afterEach(() => {
    setItemAsync.mockImplementation(real.set);
    deleteItemAsync.mockImplementation(real.del);
  });

  /** Lets `n` Keychain writes/deletes through, then the process "dies" (every later call throws). */
  function crashAfter(n: number) {
    let left = n;
    const gate = <A extends unknown[]>(fn: (...a: A) => Promise<void>) => async (...a: A) => {
      if (left-- <= 0) throw new Error('crashed');
      return fn(...a);
    };
    setItemAsync.mockImplementation(gate(real.set));
    deleteItemAsync.mockImplementation(gate(real.del));
  }

  const OLD_LARGE = 'o'.repeat(5000);
  const NEW_LARGE = 'n'.repeat(5000);

  for (const [label, oldValue] of [['small', 'old-small'], ['large', OLD_LARGE]] as const) {
    for (const [newLabel, newValue] of [['small', 'new-small'], ['large', NEW_LARGE]] as const) {
      it(`a crash at any step of overwriting a ${label} value with a ${newLabel} one leaves the old or the new value readable`, async () => {
        // Count the Keychain calls a clean overwrite makes, then crash after each prefix of them.
        await secureStorage.setItem('k', oldValue);
        const before = setItemAsync.mock.calls.length + deleteItemAsync.mock.calls.length;
        await secureStorage.setItem('k', newValue);
        const steps = setItemAsync.mock.calls.length + deleteItemAsync.mock.calls.length - before;
        for (let n = 0; n < steps; n++) {
          store.clear();
          await secureStorage.setItem('k', oldValue);
          crashAfter(n);
          await expect(secureStorage.setItem('k', newValue)).rejects.toThrow('crashed');
          setItemAsync.mockImplementation(real.set);
          deleteItemAsync.mockImplementation(real.del);
          expect([oldValue, newValue]).toContain(await secureStorage.getItem('k'));
          // The next successful write still works and leaves nothing stale behind.
          await secureStorage.setItem('k', newValue);
          expect(await secureStorage.getItem('k')).toBe(newValue);
        }
      });
    }
  }

  it('a crash while writing the new chunks keeps the old large value', async () => {
    await secureStorage.setItem('k', OLD_LARGE);
    crashAfter(1); // the first new chunk lands, the second write dies
    await expect(secureStorage.setItem('k', NEW_LARGE)).rejects.toThrow('crashed');
    setItemAsync.mockImplementation(real.set);
    expect(await secureStorage.getItem('k')).toBe(OLD_LARGE);
  });

  it('cleans up chunks orphaned by a crashed write on the next write', async () => {
    await secureStorage.setItem('k', OLD_LARGE);
    crashAfter(2);
    await expect(secureStorage.setItem('k', 'x'.repeat(9000))).rejects.toThrow('crashed');
    setItemAsync.mockImplementation(real.set);
    deleteItemAsync.mockImplementation(real.del);
    await secureStorage.setItem('k', NEW_LARGE);
    await secureStorage.setItem('k', OLD_LARGE);
    expect(store.size).toBe(4); // 3 chunks + pointer
    await secureStorage.setItem('k', 'small');
    expect([...store.keys()]).toEqual(['k']);
  });

  it('a small write or a remove also clears chunks orphaned by a crashed write', async () => {
    for (const finish of [() => secureStorage.setItem('k', 'small'), () => secureStorage.removeItem('k')]) {
      store.clear();
      await secureStorage.setItem('k', OLD_LARGE);
      crashAfter(2);
      await expect(secureStorage.setItem('k', NEW_LARGE)).rejects.toThrow('crashed');
      setItemAsync.mockImplementation(real.set);
      deleteItemAsync.mockImplementation(real.del);
      await finish();
      expect([...store.keys()].filter((k) => k !== 'k')).toEqual([]);
    }
  });

  it('still reads the earlier chunk format (count under k.n, chunks k.0…) and replaces it cleanly', async () => {
    store.set('k.0', 'ab');
    store.set('k.1', 'cd');
    store.set('k.n', '2');
    expect(await secureStorage.getItem('k')).toBe('abcd');
    await secureStorage.setItem('k', NEW_LARGE);
    expect(await secureStorage.getItem('k')).toBe(NEW_LARGE);
    expect(store.has('k.0')).toBe(false);
    expect(store.has('k.1')).toBe(false);
    await secureStorage.removeItem('k');
    expect(store.size).toBe(0);
  });

  it('logs a Keychain read error (never the value) and returns null', async () => {
    await secureStorage.setItem('k', 'secret-value');
    const getItemAsync = SecureStore.getItemAsync as jest.Mock;
    getItemAsync.mockImplementationOnce(async () => {
      throw new Error('User interaction is not allowed.');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(secureStorage.getItem('k')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).toContain('User interaction is not allowed.');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-value');
    warn.mockRestore();
  });
});
