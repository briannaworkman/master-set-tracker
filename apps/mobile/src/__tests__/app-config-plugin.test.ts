import appConfig from '../../app.config';

const build = () => appConfig({ config: {} as never, projectRoot: '', staticConfigPath: null, packageJsonPath: null });
const has = (c: ReturnType<typeof build>) => (c.plugins ?? []).some((p) => (Array.isArray(p) ? p[0] : p) === './plugins/withoutAppleSignIn');

it('registers the strip-entitlement plugin only when APP_BUNDLE_ID is unset', () => {
  const orig = process.env.APP_BUNDLE_ID;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  delete process.env.APP_BUNDLE_ID;
  expect(has(build())).toBe(true);
  process.env.APP_BUNDLE_ID = 'com.example.mst';
  expect(has(build())).toBe(false);
  if (orig === undefined) delete process.env.APP_BUNDLE_ID;
  else process.env.APP_BUNDLE_ID = orig;
});
