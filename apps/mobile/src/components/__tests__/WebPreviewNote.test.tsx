import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { PersistenceContext, WebPreviewNote } from '../WebPreviewNote';

const NOTE = "Web preview — changes aren't saved";
const realOS = Platform.OS;
afterEach(() => {
  Platform.OS = realOS;
});

async function renderNote(persistent: boolean) {
  await render(
    <PersistenceContext.Provider value={persistent}>
      <WebPreviewNote />
    </PersistenceContext.Provider>,
  );
}

describe('WebPreviewNote', () => {
  it('shows on web when changes are not saved', async () => {
    Platform.OS = 'web';
    await renderNote(false);
    expect(screen.getByText(NOTE)).toBeOnTheScreen();
  });

  it('is hidden when the store persists', async () => {
    Platform.OS = 'web';
    await renderNote(true);
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('is hidden on native', async () => {
    Platform.OS = 'ios';
    await renderNote(false);
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
