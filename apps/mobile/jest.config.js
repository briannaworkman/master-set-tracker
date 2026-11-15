/** @type {import('jest').Config} */
module.exports = {
  setupFiles: ['<rootDir>/jest.setup.js'],
  preset: 'jest-expo',
  // Transform RN/Expo packages (shipped untranspiled) and the @mst/* workspace packages,
  // which the app imports as TypeScript source with no build step.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|standard-navigation|@mst))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
