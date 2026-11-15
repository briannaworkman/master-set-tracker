import { CollectionStore, createMemoryRepo, type PriceBook } from '@mst/collection-core';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import SetScreen from '../../app/set/[id]/index';
import { TestProviders } from '../test/TestProviders';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockId = 'fx';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ id: mockId }),
  Stack: { Screen: () => null },
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));

const newStore = () => new CollectionStore(createMemoryRepo());

async function open(store = newStore(), priceBook?: PriceBook) {
  await render(
    <TestProviders store={store} priceBook={priceBook}>
      <SetScreen />
    </TestProviders>,
  );
  return store;
}

beforeEach(() => {
  mockId = 'fx';
  mockPush.mockClear();
  mockBack.mockClear();
});

it('shows version progress for the set', async () => {
  await open();
  expect(screen.getByText('Master set · 0 of 11 collected')).toBeOnTheScreen();
});

it('updates progress and the dot when a dot is tapped', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Bulbasaur 001, Normal, 0 owned' }));
  expect(screen.getByText('Master set · 1 of 11 collected')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Bulbasaur 001, Normal, 1 owned' })).toBeOnTheScreen();
});

it('filters to missing cards', async () => {
  const store = newStore();
  store.setCount('fx', 'c-004', 'single', 1);
  await open(store);
  expect(screen.getByRole('button', { name: /^Open Venusaur ex 004/ })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Missing' }));
  expect(screen.queryByRole('button', { name: /^Open Venusaur ex 004/ })).toBeNull();
  expect(screen.getByRole('button', { name: /^Open Bulbasaur 001/ })).toBeOnTheScreen();
});

it('filters to spares', async () => {
  const store = newStore();
  store.setCount('fx', 'c-001', 'normal', 2);
  await open(store);
  await fireEvent.press(screen.getByRole('button', { name: 'Spares' }));
  expect(screen.getByRole('button', { name: /^Open Bulbasaur 001/ })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /^Open Ivysaur/ })).toBeNull();
});

it('sets a count from the long-press popover', async () => {
  await open();
  await fireEvent(screen.getByRole('button', { name: 'Bulbasaur 001, Normal, 0 owned' }), 'longPress');
  await fireEvent.press(await screen.findByRole('button', { name: 'Increase' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Increase' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(screen.getByRole('button', { name: 'Bulbasaur 001, Normal, 2 owned' })).toBeOnTheScreen();
});

it('hides the value line when no prices are known', async () => {
  await open();
  expect(screen.queryByText(/Owned \$/)).toBeNull();
});

it('shows the value line with a price book', async () => {
  const store = newStore();
  store.setCount('fx', 'c-001', 'normal', 2);
  const priceBook: PriceBook = { price: (_s, key) => (key === 'c-001:normal' ? 5.75 : key === 'c-004:single' ? 1 : null) };
  await open(store, priceBook);
  expect(screen.getByText(/Owned \$11\.50 · To finish ≈ \$1\.00/)).toBeOnTheScreen();
  expect(screen.getByText(/Some prices unavailable/)).toBeOnTheScreen();
});

it('shows a section header for the promos category', async () => {
  await open();
  expect(screen.getByText('Promos & stamped')).toBeOnTheScreen();
  expect(screen.queryByText('Main set')).toBeNull();
});

it('opens a card', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: /^Open Ivysaur 002/ }));
  expect(mockPush).toHaveBeenCalledWith('/set/fx/card/c-002');
});

it('shows an empty message when the filter matches nothing', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Have' }));
  expect(screen.getByText('Nothing here yet')).toBeOnTheScreen();
});

it('handles an unknown set id', async () => {
  mockId = 'nope';
  await open();
  expect(screen.getByText("This set isn't available")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(mockBack).toHaveBeenCalled();
});
