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
    expect(c).toEqual({ supabaseUrl: 'u', supabaseAnonKey: 'k', googleIosClientId: null, googleWebClientId: null, emailOtpLength: 6 });
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

describe('email OTP length', () => {
  const base = { EXPO_PUBLIC_SUPABASE_URL: 'u', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k' };

  it('defaults to 6', () => {
    expect(readBackendConfig(base).emailOtpLength).toBe(6);
  });

  it('accepts an integer from 6 to 10', () => {
    expect(readBackendConfig({ ...base, EXPO_PUBLIC_EMAIL_OTP_LENGTH: '8' }).emailOtpLength).toBe(8);
    expect(readBackendConfig({ ...base, EXPO_PUBLIC_EMAIL_OTP_LENGTH: '10' }).emailOtpLength).toBe(10);
  });

  it.each(['abc', '5', '11', '7.5', '-8'])('falls back to 6 with a dev warning for %s', (raw) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readBackendConfig({ ...base, EXPO_PUBLIC_EMAIL_OTP_LENGTH: raw }).emailOtpLength).toBe(6);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('does not warn when unset or empty', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readBackendConfig({ ...base, EXPO_PUBLIC_EMAIL_OTP_LENGTH: '' }).emailOtpLength).toBe(6);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
