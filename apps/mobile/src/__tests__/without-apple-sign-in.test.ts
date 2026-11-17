const { removeAppleSignInEntitlement } = require('../../plugins/withoutAppleSignIn');

describe('withoutAppleSignIn', () => {
  it('removes the applesignin entitlement and keeps the others', () => {
    const config = { modResults: { 'com.apple.developer.applesignin': ['Default'], 'aps-environment': 'development' } };
    const out = removeAppleSignInEntitlement(config);
    expect(out.modResults).toEqual({ 'aps-environment': 'development' });
  });

  it('is a no-op when the key is absent', () => {
    const config = { modResults: { foo: 1 } };
    expect(removeAppleSignInEntitlement(config).modResults).toEqual({ foo: 1 });
  });
});
