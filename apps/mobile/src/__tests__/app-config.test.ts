import appConfig from '../../app.config';

const build = () => appConfig({ config: {} as never, projectRoot: '', staticConfigPath: null, packageJsonPath: null });
const hasApplePlugin = (c: ReturnType<typeof build>) =>
  (c.plugins ?? []).some((p) => (Array.isArray(p) ? p[0] : p) === 'expo-apple-authentication');
const hasStripPlugin = (c: ReturnType<typeof build>) =>
  (c.plugins ?? []).some((p) => (Array.isArray(p) ? p[0] : p) === './plugins/withoutAppleSignIn');

describe('app.config Sign in with Apple gating', () => {
  const original = process.env.APP_BUNDLE_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_BUNDLE_ID;
    else process.env.APP_BUNDLE_ID = original;
    jest.restoreAllMocks();
  });

  it('enables the entitlement, plugin and extra flag when APP_BUNDLE_ID is set', () => {
    process.env.APP_BUNDLE_ID = 'com.example.mst';
    const c = build();
    expect(c.ios?.usesAppleSignIn).toBe(true);
    expect(c.ios?.bundleIdentifier).toBe('com.example.mst');
    expect(hasApplePlugin(c)).toBe(true);
    expect(c.extra?.appleSignIn).toBe(true);
  });

  it('leaves them all off (and warns) when APP_BUNDLE_ID is unset', () => {
    delete process.env.APP_BUNDLE_ID;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const c = build();
    expect(c.ios?.usesAppleSignIn).toBeUndefined();
    expect(c.ios?.bundleIdentifier).toBe('app.mastersettracker.dev');
    expect(hasApplePlugin(c)).toBe(false);
    expect(c.extra?.appleSignIn).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('registers the strip-entitlement plugin only when APP_BUNDLE_ID is unset', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.APP_BUNDLE_ID;
    expect(hasStripPlugin(build())).toBe(true);
    process.env.APP_BUNDLE_ID = 'com.example.mst';
    expect(hasStripPlugin(build())).toBe(false);
  });
});
