import { fixtureCatalog, fixtureKinds } from '@mst/collection-core/testing';
import { StyleSheet } from 'react-native';
import { fireEvent, act, render, screen, userEvent, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { VersionDot } from '../VersionDot';
import { TestProviders } from '../../test/TestProviders';
import { CardTile } from '../CardTile';
import { CountPopover, Stepper } from '../CountPopover';

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
  expect(props.onTapVersion).toHaveBeenCalledWith('c-001', 'reverse');
  expect(Haptics.selectionAsync).toHaveBeenCalled();
});

it('does not fire a haptic when the count is already at the 999 cap', async () => {
  const onTap = jest.fn();
  await render(
    <TestProviders>
      <VersionDot kind={kindsById.normal!} count={999} onTap={onTap} onLongPress={jest.fn()} accessibilityLabel="d" />
    </TestProviders>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'd' }));
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
});

it('long-presses a dot to open the counter', async () => {
  const { props } = await tile();
  await fireEvent(screen.getByRole('button', { name: /Normal, 0 owned$/ }), 'longPress');
  expect(props.onLongPressVersion).toHaveBeenCalledWith('c-001', 'normal');
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
  expect(within(ph).getByText('001')).toBeTruthy();
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

it('closes the popover when the backdrop is tapped, but not when the card is', async () => {
  const onClose = jest.fn();
  await render(
    <TestProviders>
      <CountPopover visible title="Bulbasaur 001" versionLabel="Normal" count={1} onChange={jest.fn()} onClose={onClose} />
    </TestProviders>,
  );
  await fireEvent.press(screen.getByText('Bulbasaur 001'));
  expect(onClose).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('falls back to the placeholder on image load error and retries for a new url', async () => {
  const withImg = { ...bulbasaur, imageUrl: 'https://example.test/a.png' };
  const { props, view } = await tile(withImg);
  expect(screen.queryByTestId('tile-placeholder')).toBeNull();
  await act(async () => screen.getByTestId('tile-image').props.onError({ nativeEvent: { error: 'x' } }));
  expect(screen.getByTestId('tile-placeholder')).toBeTruthy();
  await view.rerender(
    <TestProviders>
      <CardTile card={{ ...withImg, imageUrl: 'https://example.test/b.png' }} kindsById={kindsById} counts={{}} width={110} {...props} />
    </TestProviders>,
  );
  expect(screen.queryByTestId('tile-placeholder')).toBeNull();
});

it('labels a complete card as complete', async () => {
  await tile(bulbasaur, { 'c-001:normal': 1, 'c-001:reverse': 1, 'c-001:pokeball': 1 });
  expect(screen.getByRole('button', { name: 'Open Bulbasaur 001, complete' })).toBeTruthy();
});

describe('VersionDot visuals', () => {
  const noop = () => {};
  const dot = (kind: (typeof fixtureKinds)[number], count: number) =>
    render(
      <TestProviders>
        <VersionDot kind={kind} count={count} onTap={noop} onLongPress={noop} accessibilityLabel="d" />
      </TestProviders>,
    );
  it('long-press fires at 350 ms and not before', async () => {
    jest.useFakeTimers();
    const onLongPress = jest.fn();
    await render(
      <TestProviders>
        <VersionDot kind={kindsById.normal!} count={0} onTap={noop} onLongPress={onLongPress} accessibilityLabel="d" />
      </TestProviders>,
    );
    const user = userEvent.setup();
    await user.longPress(screen.getByRole('button', { name: 'd' }), { duration: 340 });
    expect(onLongPress).not.toHaveBeenCalled();
    await user.longPress(screen.getByRole('button', { name: 'd' }), { duration: 360 });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
  it('missing: dashed border, no fill, no badge; long-press delay 350', async () => {
    await dot(kindsById.normal!, 0);
    const style = StyleSheet.flatten(screen.getByTestId('dot-missing').props.style);
    expect(style.borderStyle).toBe('dashed');
    expect(style.borderWidth).toBe(1.5);
    expect(style.backgroundColor).toBe('transparent');
    expect(screen.queryByTestId('dot-badge')).toBeNull();
  });
  it('owned once: kind colour fill, no badge', async () => {
    await dot(kindsById.normal!, 1);
    expect(StyleSheet.flatten(screen.getByTestId('dot-fill').props.style).backgroundColor).toBe('#6F685E');
    expect(screen.queryByTestId('dot-badge')).toBeNull();
  });
  it('rainbow kind renders the gradient', async () => {
    await dot(kindsById.reverse!, 1);
    expect(screen.getByTestId('dot-rainbow')).toBeTruthy();
  });
});

it('stepper disables plus at 999', async () => {
  const onChange = jest.fn();
  await render(
    <TestProviders>
      <Stepper value={999} onChange={onChange} />
    </TestProviders>,
  );
  const plus = screen.getByRole('button', { name: 'Increase' });
  expect(plus.props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(plus);
  expect(onChange).not.toHaveBeenCalled();
});
