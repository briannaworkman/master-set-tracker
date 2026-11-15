import { fixtureCatalog, fixtureKinds } from '@mst/collection-core/testing';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { TestProviders } from '../../test/TestProviders';
import { CardTile } from '../CardTile';
import { CountPopover } from '../CountPopover';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));

const kindsById = Object.fromEntries(fixtureKinds.map((k) => [k.id, k]));
const bulbasaur = fixtureCatalog.cards.find((c) => c.id === 'c-001')!;
const ivysaur = fixtureCatalog.cards.find((c) => c.id === 'c-002')!;

async function tile(card = bulbasaur, counts: Record<string, number> = {}, over: Partial<Parameters<typeof CardTile>[0]> = {}) {
  const props = { onTapVersion: jest.fn(), onLongPressVersion: jest.fn(), onOpenCard: jest.fn(), ...over };
  const view = await render(
    <TestProviders>
      <CardTile card={card} kindsById={kindsById} counts={counts} width={110} {...props} />
    </TestProviders>,
  );
  return { props, view };
}

beforeEach(() => jest.clearAllMocks());

it('renders one dot per version in catalog order', async () => {
  await tile(ivysaur);
  expect(screen.getAllByRole('button', { name: /owned$/ })).toHaveLength(4);
});

it('taps a dot to add one', async () => {
  const { props } = await tile();
  await fireEvent.press(screen.getByRole('button', { name: 'Bulbasaur 001, Reverse Holo, 0 owned' }));
  expect(props.onTapVersion).toHaveBeenCalledWith('reverse');
  expect(Haptics.selectionAsync).toHaveBeenCalled();
});

it('long-presses a dot to open the counter', async () => {
  const { props } = await tile();
  await fireEvent(screen.getByRole('button', { name: /Normal, 0 owned$/ }), 'longPress');
  expect(props.onLongPressVersion).toHaveBeenCalledWith('normal');
});

it('shows a count badge for spares', async () => {
  await tile(bulbasaur, { 'c-001:normal': 3 });
  expect(screen.getByText('3')).toBeTruthy();
});

it('fades a card with nothing owned and checks a complete card', async () => {
  const { props, view } = await tile();
  expect(screen.getByTestId('tile-faded')).toBeTruthy();
  expect(screen.queryByTestId('tile-complete')).toBeNull();
  const all = { 'c-001:normal': 1, 'c-001:reverse': 1, 'c-001:pokeball': 1 };
  await view.rerender(
    <TestProviders>
      <CardTile card={bulbasaur} kindsById={kindsById} counts={all} width={110} {...props} />
    </TestProviders>,
  );
  expect(screen.getByTestId('tile-complete')).toBeTruthy();
  expect(screen.queryByTestId('tile-faded')).toBeNull();
});

it('shows a placeholder when the card has no image', async () => {
  await tile();
  const ph = screen.getByTestId('tile-placeholder');
  expect(ph).toBeTruthy();
  expect(screen.getAllByText('001').length).toBeGreaterThan(0);
});

it('disables minus at zero and never goes negative', async () => {
  const onChange = jest.fn();
  await render(
    <TestProviders>
      <CountPopover visible title="Bulbasaur 001" versionLabel="Normal" count={0} onChange={onChange} onClose={jest.fn()} />
    </TestProviders>,
  );
  const minus = screen.getByRole('button', { name: 'Decrease' });
  expect(minus.props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(minus);
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Increase' }));
  expect(onChange).toHaveBeenCalledWith(1);
});
