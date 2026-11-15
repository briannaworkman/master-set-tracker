import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { backendConfig } from './config';
import { secureStorage } from './secure-storage';

/**
 * The key supabase-js stores the session under: `sb-<project ref>-auth-token`, the ref being the
 * first label of the Supabase URL host (supabase-js's own default, passed explicitly so the
 * stored-session check in AuthProvider reads exactly the same key).
 */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

export const AUTH_STORAGE_KEY = authStorageKey(backendConfig.supabaseUrl);

type AuthStorage = { getItem(key: string): Promise<string | null> | string | null };

/**
 * expo-secure-store is unavailable on web, which uses auth-js's default there (localStorage).
 */
function authStorage(): AuthStorage | null {
  if (Platform.OS !== 'web') return secureStorage;
  return (globalThis as { localStorage?: AuthStorage }).localStorage ?? null;
}

export function createSupabaseClient(): SupabaseClient {
  return createClient(backendConfig.supabaseUrl, backendConfig.supabaseAnonKey, {
    auth: {
      ...(Platform.OS === 'web' ? {} : { storage: secureStorage }),
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

let client: SupabaseClient | null = null;

/** Lazily created singleton. */
export function getSupabase(): SupabaseClient {
  if (!client) client = createSupabaseClient();
  return client;
}

/** The raw stored session (JSON, as auth-js wrote it) from the client's storage and key, or null. */
export async function readStoredAuthSession(): Promise<string | null> {
  const storage = authStorage();
  return storage ? await storage.getItem(AUTH_STORAGE_KEY) : null;
}
