const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockSecure.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockSecure.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockSecure.delete(k);
  }),
}));

import { AUTH_STORAGE_KEY, authStorageKey, getSupabase, readStoredAuthSession } from '../supabase';

describe('auth storage key', () => {
  it('is sb-<project ref>-auth-token, the ref being the first label of the URL host', () => {
    expect(authStorageKey('https://abcd1234.supabase.co')).toBe('sb-abcd1234-auth-token');
    expect(authStorageKey('http://127.0.0.1:54321')).toBe('sb-127-auth-token');
    // jest.setup.js: https://test-project.supabase.co
    expect(AUTH_STORAGE_KEY).toBe('sb-test-project-auth-token');
  });

  it('is the key the client stores its session under, and the stored-session read uses it', async () => {
    const client = getSupabase();
    expect((client.auth as unknown as { storageKey: string }).storageKey).toBe(AUTH_STORAGE_KEY);
    mockSecure.set(AUTH_STORAGE_KEY, '{"refresh_token":"r"}');
    expect(await readStoredAuthSession()).toBe('{"refresh_token":"r"}');
    mockSecure.clear();
    expect(await readStoredAuthSession()).toBeNull();
    client.auth.stopAutoRefresh();
  });
});
