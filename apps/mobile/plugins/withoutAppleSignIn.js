const { withEntitlementsPlist } = require('expo/config-plugins');

const KEY = 'com.apple.developer.applesignin';

// @expo/prebuild-config auto-applies expo-apple-authentication's plugin whenever the package is installed, which adds
// this entitlement and forces code signing for simulator builds. Strip it when Sign in with Apple is not configured.
function removeAppleSignInEntitlement(config) {
  delete config.modResults[KEY];
  return config;
}

module.exports = (config) => withEntitlementsPlist(config, removeAppleSignInEntitlement);
module.exports.removeAppleSignInEntitlement = removeAppleSignInEntitlement;
