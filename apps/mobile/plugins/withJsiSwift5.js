const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# [withJsiSwift5] ExpoModulesJSI Swift 5 workaround';

// Xcode 26.3 (Swift strict concurrency) fails to compile expo-modules-jsi 58.0.23:
//   JavaScriptObject.swift:946: error: sending 'slot' risks causing data races
// Build only that pod target in Swift 5 mode with minimal concurrency checking.
// TODO: remove this plugin (and its entry in app.config.ts) once Expo ships a fixed expo-modules-jsi.
const BLOCK = `    ${MARKER}
    # Reason: Xcode 26.3 strict-concurrency error in expo-modules-jsi 58.0.23; remove once Expo ships a fix.
    installer.pods_project.targets.each do |target|
      next unless target.name == 'ExpoModulesJSI'
      target.build_configurations.each do |bc|
        bc.build_settings['SWIFT_VERSION'] = '5.0'
        bc.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
      end
    end
`;

function patchPodfile(contents) {
  if (contents.includes(MARKER)) return contents;
  return contents.replace(/^(\s*post_install do \|installer\|\n)/m, `$1${BLOCK}`);
}

module.exports = (config) =>
  withDangerousMod(config, [
    'ios',
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      fs.writeFileSync(file, patchPodfile(fs.readFileSync(file, 'utf8')));
      return cfg;
    },
  ]);
module.exports.patchPodfile = patchPodfile;
module.exports.MARKER = MARKER;
