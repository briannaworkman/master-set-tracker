import type { ConfigContext, ExpoConfig } from 'expo/config';

const DEFAULT_BUNDLE_ID = 'app.mastersettracker.dev';

export default ({ config }: ConfigContext): ExpoConfig => {
  let bundleId = process.env.APP_BUNDLE_ID;
  // A real bundle id implies an Apple Developer account. Sign in with Apple forces code signing (even for simulator
  // builds), so the entitlement and plugin are only added once APP_BUNDLE_ID is filled in.
  const appleSignIn = Boolean(bundleId);
  if (!bundleId) {
    console.warn(`APP_BUNDLE_ID is not set; falling back to ${DEFAULT_BUNDLE_ID}. See .env.example.`);
    bundleId = DEFAULT_BUNDLE_ID;
  }

  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  // The iOS URL scheme is the client id reversed: <prefix>.apps.googleusercontent.com -> com.googleusercontent.apps.<prefix>
  const googleUrlScheme = googleIosClientId
    ? `com.googleusercontent.apps.${googleIosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`
    : null;

  return {
    ...config,
    name: 'Master Set Tracker',
    slug: 'master-set-tracker',
    scheme: 'mastersettracker',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      supportsTablet: true,
      bundleIdentifier: bundleId,
      ...(appleSignIn ? { usesAppleSignIn: true } : {}),
    },
    android: {
      package: bundleId,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: 'single',
      favicon: './assets/favicon.png',
    },
    extra: { ...config.extra, appleSignIn },
    plugins: [
      [
        'expo-router',
        {
          headers: {
            'Cross-Origin-Embedder-Policy': 'credentialless',
            'Cross-Origin-Opener-Policy': 'same-origin',
          },
        },
      ],
      'expo-sqlite',
      'expo-image',
      'expo-dev-client',
      ...(appleSignIn ? ['expo-apple-authentication'] : ['./plugins/withoutAppleSignIn']),
      'expo-secure-store',
      './plugins/withJsiSwift5',
      ...(googleUrlScheme
        ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleUrlScheme }] as [string, any]]
        : []),
    ],
  };
};
