import { CollectionStore, createMemoryRepo } from '@mst/collection-core';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import BrowseScreen from '../../app/browse';
import HomeScreen from '../../app/index';
import { TestProviders } from '../test/TestProviders';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
});

const newStore = () => new CollectionStore(createMemoryRepo());

it('shows the empty state with no tracked sets', async () => {
  await render(
    <TestProviders store={newStore()}>
      <HomeScreen />
    </TestProviders>,
  );
  expect(await screen.findByText('Add a set to start tracking')).toBeOnTheScreen();
});

it('adds a set from Browse and shows it with progress', async () => {
  const store = newStore();
  const { unmount } = await render(
    <TestProviders store={store}>
      <BrowseScreen />
    </TestProviders>,
  );
  expect(screen.getByText('Fixture Set')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Add Fixture Set' }));
  expect(store.getTracked().map((t) => t.setId)).toEqual(['fx']);
  expect(mockBack).toHaveBeenCalled();
  await unmount();

  await render(
    <TestProviders store={store}>
      <HomeScreen />
    </TestProviders>,
  );
  expect(await screen.findByText('Fixture Set')).toBeOnTheScreen();
  expect(screen.getByText('0 of 11')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Fixture Set, 0 of 11' }));
  expect(mockPush).toHaveBeenCalledWith('/set/fx');
});

it('shows Added ✓ for sets already tracked', async () => {
  const store = newStore();
  store.track('fx');
  await render(
    <TestProviders store={store}>
      <BrowseScreen />
    </TestProviders>,
  );
  expect(await screen.findByText('Added ✓')).toBeOnTheScreen();
  expect(screen.queryByText('Add')).toBeNull();
});

it('shows progress from stored counts', async () => {
  const store = newStore();
  store.track('fx');
  store.setCount('fx', 'c-001', 'normal', 1);
  store.setCount('fx', 'c-001', 'reverse', 1);
  await render(
    <TestProviders store={store}>
      <HomeScreen />
    </TestProviders>,
  );
  expect(await screen.findByText('2 of 11')).toBeOnTheScreen();
});

type Slop = number | { top?: number; bottom?: number } | undefined;

/** Visual height plus vertical hit slop: the height a finger can actually hit. */
function touchHeight(el: { props: { style?: unknown; hitSlop?: unknown } }): number {
  const style = StyleSheet.flatten(el.props.style as never) ?? {};
  const slop = el.props.hitSlop as Slop;
  const vertical = typeof slop === 'number' ? 2 * slop : (slop?.top ?? 0) + (slop?.bottom ?? 0);
  return Math.max(Number(style.height ?? 0), Number(style.minHeight ?? 0)) + vertical;
}

it('gives the Add set and Add buttons a 44 pt touch target', async () => {
  const store = newStore();
  const { unmount } = await render(
    <TestProviders store={store}>
      <HomeScreen />
    </TestProviders>,
  );
  expect(touchHeight(screen.getByRole('button', { name: 'Add set' }))).toBeGreaterThanOrEqual(44);
  await unmount();

  await render(
    <TestProviders store={store}>
      <BrowseScreen />
    </TestProviders>,
  );
  expect(touchHeight(screen.getByRole('button', { name: 'Add Fixture Set' }))).toBeGreaterThanOrEqual(44);
});
