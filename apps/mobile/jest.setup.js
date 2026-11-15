// Fake public env values so src/backend/config.ts loads under Jest.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// NetInfo is a native module: use its bundled Jest mock everywhere (tests override addEventListener).
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
