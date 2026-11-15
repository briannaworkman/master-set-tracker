import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import RootLayout from '../../app/_layout';

const mockScreens: { name: string; options?: Record<string, unknown> }[] = [];

jest.mock('expo-router', () => {
  const Stack = ({ children }: { children: ReactNode }) => children;
  Stack.Screen = (props: { name: string; options?: Record<string, unknown> }) => {
    mockScreens.push(props);
    return null;
  };
  return { Stack };
});

// The real provider renders nothing until native inset metrics arrive.
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

jest.mock('../db/openStore', () => {
  const { CollectionStore, createMemoryRepo } = jest.requireActual('@mst/collection-core');
  return { getAppStore: () => ({ store: new CollectionStore(createMemoryRepo()), persistent: true }) };
});

beforeEach(() => {
  mockScreens.length = 0;
});

it('titles the home screen "My Sets" so back buttons never read "index"', async () => {
  await render(<RootLayout />);
  const home = mockScreens.find((s) => s.name === 'index');
  expect(home?.options).toMatchObject({ title: 'My Sets', headerShown: false });
});
