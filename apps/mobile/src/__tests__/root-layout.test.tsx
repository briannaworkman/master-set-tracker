import { render, screen } from '@testing-library/react-native';
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

let mockOpenError: Error | null = null;
jest.mock('../db/openStore', () => {
  const { CollectionStore, createMemoryRepo } = jest.requireActual('@mst/collection-core');
  return {
    getAppStore: () => {
      if (mockOpenError) throw mockOpenError;
      return { store: new CollectionStore(createMemoryRepo()), persistent: true };
    },
  };
});

beforeEach(() => {
  mockScreens.length = 0;
  mockOpenError = null;
});

it('titles the home screen "My Sets" so back buttons never read "index"', async () => {
  await render(<RootLayout />);
  const home = mockScreens.find((s) => s.name === 'index');
  expect(home?.options).toMatchObject({ title: 'My Sets', headerShown: false });
});

it('shows a full-screen message instead of crashing when the collection database cannot open', async () => {
  mockOpenError = new Error('database disk image is malformed');
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  await render(<RootLayout />);
  expect(logged).toHaveBeenCalledWith('Could not open the collection database', mockOpenError);
  logged.mockRestore();
  expect(screen.getByText("Couldn't open your collection")).toBeOnTheScreen();
  // __DEV__ is true under jest, so the underlying error is shown for debugging.
  expect(screen.getByText('database disk image is malformed')).toBeOnTheScreen();
  expect(mockScreens).toEqual([]);
});
