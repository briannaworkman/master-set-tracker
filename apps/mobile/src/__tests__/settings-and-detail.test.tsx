import { CollectionStore, createMemoryRepo, type PriceBook } from '@mst/collection-core';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import CardDetail from '../../app/set/[id]/card/[cardId]';
import SetScreen from '../../app/set/[id]/index';
import SettingsScreen from '../../app/set/[id]/settings';
import { TestProviders } from '../test/TestProviders';

const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
let mockParams: Record<string, string> = { id: 'fx', cardId: 'c-001' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace, dismissAll: mockDismissAll }),
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));

const newStore = () => {
  const s = new CollectionStore(createMemoryRepo());
  s.track('fx');
  return s;
};

async function open(ui: React.ReactElement, store: CollectionStore, priceBook?: PriceBook) {
  await render(
    <TestProviders store={store} priceBook={priceBook}>
      {ui}
    </TestProviders>,
  );
}

beforeEach(() => {
  mockParams = { id: 'fx', cardId: 'c-001' };
  mockReplace.mockClear();
  mockDismissAll.mockClear();
});

it('hides a category and removes it from progress', async () => {
  const store = newStore();
  await open(<SettingsScreen />, store);
  await fireEvent(screen.getByRole('switch', { name: 'Promos & stamped' }), 'valueChange', false);
  expect(store.getTracked().find((t) => t.setId === 'fx')?.hiddenCategoryIds).toEqual(['promos']);
  await screen.unmount();
  await open(<SetScreen />, store);
  expect(screen.getByText('Master set · 0 of 10 collected')).toBeOnTheScreen();
});

it('keeps the main category always on', async () => {
  await open(<SettingsScreen />, newStore());
  const main = screen.getByRole('switch', { name: 'Main set' });
  expect(main).toBeDisabled();
  expect(main.props.value).toBe(true);
  expect(screen.getByText('Always shown')).toBeOnTheScreen();
});

it('removes a set but keeps its marks', async () => {
  const store = newStore();
  store.setCount('fx', 'c-001', 'normal', 2);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await open(<SettingsScreen />, store);
  await fireEvent.press(screen.getByRole('button', { name: 'Remove from My Sets' }));
  expect(alert).toHaveBeenCalled();
  const [title, message, buttons] = alert.mock.calls[0]!;
  expect(`${title} ${message}`).toContain('Your marks are kept if you add it again.');
  const remove = buttons!.find((b) => b.text === 'Remove')!;
  expect(remove.style).toBe('destructive');
  remove.onPress!();
  expect(store.getTracked().find((t) => t.setId === 'fx')).toBeUndefined();
  expect(mockDismissAll).toHaveBeenCalled();
  store.track('fx');
  expect(store.getCounts('fx')['c-001:normal']).toBe(2);
  alert.mockRestore();
});

it('disables switches and hides Remove for an untracked set', async () => {
  await open(<SettingsScreen />, new CollectionStore(createMemoryRepo()));
  expect(screen.getByText('Add this set to My Sets to change these')).toBeOnTheScreen();
  expect(screen.getByRole('switch', { name: 'Promos & stamped' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Remove from My Sets' })).toBeNull();
});

it('changes counts from card detail', async () => {
  const store = newStore();
  await open(<CardDetail />, store);
  const row = screen.getByTestId('version-row-reverse');
  await fireEvent.press(within(row).getByRole('button', { name: 'Increase' }));
  expect(store.getCounts('fx')['c-001:reverse']).toBe(1);
  await screen.unmount();
  await open(<SetScreen />, store);
  expect(screen.getByRole('button', { name: 'Bulbasaur 001, Reverse Holo, 1 owned' })).toBeOnTheScreen();
});

it('shows — for unknown prices and the spares line', async () => {
  const store = newStore();
  store.setCount('fx', 'c-001', 'normal', 3);
  await open(<CardDetail />, store);
  expect(screen.getAllByText('—').length).toBe(3);
  expect(screen.getByText('2 spares to trade')).toBeOnTheScreen();
});

it('shows a known price and singular spare', async () => {
  const store = newStore();
  store.setCount('fx', 'c-001', 'normal', 2);
  await open(<CardDetail />, store, { price: (_s, k) => (k === 'c-001:normal' ? 1.5 : null) });
  expect(screen.getByText('$1.50')).toBeOnTheScreen();
  expect(screen.getByText('1 spare to trade')).toBeOnTheScreen();
});
