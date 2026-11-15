export interface BackendConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  googleIosClientId: string | null;
  googleWebClientId: string | null;
}

type Env = Partial<Record<
  | 'EXPO_PUBLIC_SUPABASE_URL'
  | 'EXPO_PUBLIC_SUPABASE_ANON_KEY'
  | 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'
  | 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  string
>>;

/** Validates env values; throws a clear error listing every missing required name. */
export function readBackendConfig(env: Env): BackendConfig {
  const missing: string[] = [];
  if (!env.EXPO_PUBLIC_SUPABASE_URL) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!env.EXPO_PUBLIC_SUPABASE_ANON_KEY) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them in apps/mobile/.env (see .env.example and docs/setup/accounts-and-backend.md).',
    );
  }
  return {
    supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL as string,
    supabaseAnonKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string,
    googleIosClientId: env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || null,
    googleWebClientId: env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || null,
  };
}

// Expo inlines only literal `process.env.EXPO_PUBLIC_*` accesses, so each is read explicitly.
export const backendConfig: BackendConfig = readBackendConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});
