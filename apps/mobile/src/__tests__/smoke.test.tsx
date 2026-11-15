import { render, screen } from '@testing-library/react-native';
import HomeScreen from '../../app/index';
import { TestProviders } from '../test/TestProviders';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));

it('renders the home screen inside the providers', async () => {
  await render(
    <TestProviders>
      <HomeScreen />
    </TestProviders>,
  );
  expect(await screen.findByText('Add a set to start tracking')).toBeOnTheScreen();
});
