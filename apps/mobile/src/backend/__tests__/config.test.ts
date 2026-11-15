import { backendConfig, readBackendConfig } from '../config';

describe('backendConfig', () => {
  it('is populated from the Jest setup env', () => {
    expect(backendConfig.supabaseUrl).toBe('https://test-project.supabase.co');
    expect(backendConfig.supabaseAnonKey).toBe('test-anon-key');
  });

  it('leaves optional Google ids null when unset or empty', () => {
    const c = readBackendConfig({
      EXPO_PUBLIC_SUPABASE_URL: 'u',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k',
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '',
    });
    expect(c).toEqual({ supabaseUrl: 'u', supabaseAnonKey: 'k', googleIosClientId: null, googleWebClientId: null });
  });

  it('reads optional Google ids when set', () => {
    const c = readBackendConfig({
      EXPO_PUBLIC_SUPABASE_URL: 'u',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k',
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id',
    });
    expect(c.googleIosClientId).toBe('ios-id');
  });

  it('throws listing every missing required name', () => {
    expect(() => readBackendConfig({})).toThrow(/EXPO_PUBLIC_SUPABASE_URL.*EXPO_PUBLIC_SUPABASE_ANON_KEY/s);
    expect(() => readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: 'u' })).toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
