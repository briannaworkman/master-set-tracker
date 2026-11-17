const { patchPodfile, MARKER } = require('../../plugins/withJsiSwift5');

const podfile = `target 'App' do\n  post_install do |installer|\n    react_native_post_install(installer)\n  end\nend\n`;

describe('withJsiSwift5 patchPodfile', () => {
  it('inserts the ExpoModulesJSI-scoped settings at the top of post_install', () => {
    const out = patchPodfile(podfile);
    expect(out).toContain(MARKER);
    expect(out).toContain("target.name == 'ExpoModulesJSI'");
    expect(out).toContain("'SWIFT_VERSION'] = '5.0'");
    expect(out).toContain("'SWIFT_STRICT_CONCURRENCY'] = 'minimal'");
    expect(out.indexOf(MARKER)).toBeGreaterThan(out.indexOf('post_install do |installer|'));
    expect(out.indexOf(MARKER)).toBeLessThan(out.indexOf('react_native_post_install'));
  });

  it('is idempotent', () => {
    const once = patchPodfile(podfile);
    expect(patchPodfile(once)).toBe(once);
    expect(once.split(MARKER).length - 1).toBe(1);
  });

  it('leaves a Podfile without post_install untouched', () => {
    expect(patchPodfile('target "x" do\nend\n')).toBe('target "x" do\nend\n');
  });
});
