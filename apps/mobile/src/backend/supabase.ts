import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { backendConfig } from './config';
import { secureStorage } from './secure-storage';

let client: SupabaseClient | null = null;

/** Lazily created singleton. expo-secure-store is unavailable on web, which uses supabase's default storage. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(backendConfig.supabaseUrl, backendConfig.supabaseAnonKey, {
      auth: {
        ...(Platform.OS === 'web' ? {} : { storage: secureStorage }),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
