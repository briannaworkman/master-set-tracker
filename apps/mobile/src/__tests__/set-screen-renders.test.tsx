import { CollectionStore, cardStatus, createMemoryRepo } from '@mst/collection-core';
import { fireEvent, render, screen } from '@testing-library/react-native';
import SetScreen from '../../app/set/[id]/index';
import { TestProviders } from '../test/TestProviders';

// CardTile calls cardStatus exactly once per render, so it doubles as a per-tile render counter.
jest.mock('@mst/collection-core', () => {
  const actual = jest.requireActual('@mst/collection-core');
  return { ...actual, cardStatus: jest.fn(actual.cardStatus) };
});
const statusSpy = jest.mocked(cardStatus);

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockScreenOptions: unknown[] = [];
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'fx' }),
  Stack: {
    Screen: ({ options }: { options: unknown }) => {
      mockScreenOptions.push(options);
      return null;
    },
  },
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));

const renderedCards = () => statusSpy.mock.calls.map(([card]) => card.id);

async function openWithFilter(filter?: string) {
  await render(
    <TestProviders store={new CollectionStore(createMemoryRepo())}>
      <SetScreen />
    </TestProviders>,
  );
  if (filter) await fireEvent.press(screen.getByRole('button', { name: filter }));
  expect(renderedCards()).toEqual(expect.arrayContaining(['c-001', 'c-004']));
  statusSpy.mockClear();
  mockScreenOptions.length = 0;
}

it.each([['All'], ['Missing']])('a tap under %s re-renders only the tapped tile', async (filter) => {
  await openWithFilter(filter);
  await fireEvent.press(screen.getByRole('button', { name: 'Bulbasaur 001, Normal, 0 owned' }));
  expect(screen.getByRole('button', { name: 'Bulbasaur 001, Normal, 1 owned' })).toBeOnTheScreen();
  expect(renderedCards()).toEqual(['c-001']);
});

it('keeps the header options object stable across taps', async () => {
  await render(
    <TestProviders store={new CollectionStore(createMemoryRepo())}>
      <SetScreen />
    </TestProviders>,
  );
  const before = mockScreenOptions.at(-1);
  expect(before).toMatchObject({ title: 'Fixture Set' });
  await fireEvent.press(screen.getByRole('button', { name: 'Bulbasaur 001, Normal, 0 owned' }));
  expect(mockScreenOptions.length).toBeGreaterThan(1);
  expect(mockScreenOptions.at(-1)).toBe(before);
});
