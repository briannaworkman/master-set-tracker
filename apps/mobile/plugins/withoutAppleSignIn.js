const { withEntitlementsPlist } = require('expo/config-plugins');

const KEY = 'com.apple.developer.applesignin';

// @expo/prebuild-config auto-applies expo-apple-authentication's plugin whenever the package is installed, which adds
// this entitlement and forces code signing for simulator builds. Strip it when Sign in with Apple is not configured.
// This relies on user-supplied mods running after the auto-applied expo-apple-authentication plugin's mod, so the
// delete happens last. If Expo changes that ordering, the entitlement will reappear (app-config.test.ts won't catch it).
function removeAppleSignInEntitlement(config) {
  delete config.modResults[KEY];
  return config;
}

module.exports = (config) => withEntitlementsPlist(config, removeAppleSignInEntitlement);
module.exports.removeAppleSignInEntitlement = removeAppleSignInEntitlement;
