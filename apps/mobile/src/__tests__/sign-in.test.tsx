import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { AuthProvider, INITIAL_LOAD_TIMEOUT_MS, useAuth } from '../auth/AuthProvider';
import SignInEmailScreen from '../../app/sign-in-email';
import SignInScreen from '../../app/sign-in';
import { AppState, Platform, Text } from 'react-native';
import * as Apple from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { TestProviders } from '../test/TestProviders';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const mockClient = {
  auth: {
    signInWithIdToken: jest.fn(),
    signInWithOtp: jest.fn(),
    verifyOtp: jest.fn(),
    getSession: jest.fn(),
    onAuthStateChange: jest.fn(),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
};
jest.mock('../backend/supabase', () => ({ getSupabase: () => mockClient }));

const mockConfig = { googleIosClientId: 'ios-id' as string | null, googleWebClientId: 'web-id' as string | null, emailOtpLength: 6 };
let mockAppleEnabled = true;
jest.mock('../backend/config', () => ({
  get backendConfig() {
    return mockConfig;
  },
  appleSignInEnabled: () => mockAppleEnabled,
}));

jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => true) }));
jest.mock('expo-crypto', () => ({
  getRandomBytes: () => new Uint8Array(32).fill(1),
  digestStringAsync: jest.fn(async () => 'hashed-nonce'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

const mockAppleSignIn = jest.fn();
jest.mock('expo-apple-authentication', () => {
  const { Text: T } = require('react-native');
  return {
    isAvailableAsync: jest.fn(async () => true),
    signInAsync: (...a: unknown[]) => mockAppleSignIn(...a),
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { CONTINUE: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) => (
      <T accessibilityRole="button" onPress={onPress}>
        Apple button
      </T>
    ),
  };
});

const mockGoogleSignIn = jest.fn();
const mockGoogleConfigure = jest.fn();
jest.mock('@react-native-google-signin/google-signin', () => ({
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
  isErrorWithCode: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  GoogleSignin: {
    configure: (...a: unknown[]) => mockGoogleConfigure(...a),
    hasPlayServices: jest.fn(async () => true),
    signIn: (...a: unknown[]) => mockGoogleSignIn(...a),
  },
}));

const ERROR = "Couldn't sign in. Check your connection and try again.";

beforeEach(() => {
  jest.clearAllMocks();
  mockAppleEnabled = true;
  mockConfig.googleIosClientId = 'ios-id';
  mockConfig.googleWebClientId = 'web-id';
  mockClient.auth.signInWithIdToken.mockResolvedValue({ error: null });
  mockClient.auth.signInWithOtp.mockResolvedValue({ error: null });
  mockClient.auth.verifyOtp.mockResolvedValue({ error: null });
});

const renderSignIn = async () => {
  await render(
    <TestProviders>
      <SignInScreen />
    </TestProviders>,
  );
  await screen.findByText('Apple button');
};

describe('sign-in screen', () => {
  it('shows the app name, tagline, buttons in order and footer', async () => {
    await renderSignIn();
    expect(screen.getByText('Master Set Tracker')).toBeOnTheScreen();
    expect(screen.getByText('Track every version of every card.')).toBeOnTheScreen();
    const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel ?? 'apple');
    expect(labels).toEqual(['apple', 'Continue with Google', 'Continue with email']);
    expect(screen.getByText("Your marks are saved to your account so they're safe on every device.")).toBeOnTheScreen();
  });

  it('hides the Google button when no Google ids are configured', async () => {
    mockConfig.googleIosClientId = null;
    mockConfig.googleWebClientId = null;
    await renderSignIn();
    expect(screen.queryByText('Continue with Google')).toBeNull();
  });

  it('Apple success sends the hashed nonce to Apple and the raw nonce to Supabase', async () => {
    mockAppleSignIn.mockResolvedValue({ identityToken: 'apple-token' });
    await renderSignIn();
    await fireEvent.press(screen.getByText('Apple button'));
    const raw = '01'.repeat(32);
    expect(Crypto.digestStringAsync).toHaveBeenCalledWith('SHA-256', raw);
    expect(mockAppleSignIn).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'hashed-nonce' }));
    expect(mockClient.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-token',
      nonce: raw,
    });
    expect(screen.queryByText(ERROR)).toBeNull();
  });

  it('Apple cancellation shows nothing', async () => {
    mockAppleSignIn.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    await renderSignIn();
    await fireEvent.press(screen.getByText('Apple button'));
    expect(mockClient.auth.signInWithIdToken).not.toHaveBeenCalled();
    expect(screen.queryByText(ERROR)).toBeNull();
  });

  it('shows the generic error for other Apple failures', async () => {
    mockAppleSignIn.mockRejectedValue(new Error('boom'));
    await renderSignIn();
    await fireEvent.press(screen.getByText('Apple button'));
    expect(screen.getByText(ERROR)).toBeOnTheScreen();
  });

  it('Google success exchanges the id token', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'g-token' } });
    await renderSignIn();
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    expect(mockGoogleConfigure).toHaveBeenCalledWith({ iosClientId: 'ios-id', webClientId: 'web-id' });
    expect(mockClient.auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'g-token' });
  });

  it('Google cancellation (response or thrown) shows nothing', async () => {
    await renderSignIn();
    mockGoogleSignIn.mockResolvedValueOnce({ type: 'cancelled', data: null });
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    mockGoogleSignIn.mockRejectedValueOnce({ code: 'SIGN_IN_CANCELLED' });
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    expect(mockClient.auth.signInWithIdToken).not.toHaveBeenCalled();
    expect(screen.queryByText(ERROR)).toBeNull();
  });

  it('shows the generic error when Supabase rejects the token', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'g-token' } });
    mockClient.auth.signInWithIdToken.mockResolvedValue({ error: new Error('bad') });
    await renderSignIn();
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    expect(screen.getByText(ERROR)).toBeOnTheScreen();
  });

  it('does not send twice on a double tap', async () => {
    mockGoogleSignIn.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ type: 'cancelled', data: null }), 20)),
    );
    await renderSignIn();
    const button = screen.getByLabelText('Continue with Google');
    // Two presses in one act: React has not re-rendered the disabled state yet, so only the in-flight guard stops the second.
    const noise = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    noise.mockRestore();
    expect(mockGoogleSignIn).toHaveBeenCalledTimes(1);
  });

  it('hides the Apple button when Apple sign-in is unavailable', async () => {
    (Apple.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    await render(
      <TestProviders>
        <SignInScreen />
      </TestProviders>,
    );
    expect(screen.queryByText('Apple button')).toBeNull();
    expect(screen.getByLabelText('Continue with Google')).toBeOnTheScreen();
  });

  it('hides the Apple button when the build has Apple sign-in disabled, even if available', async () => {
    mockAppleEnabled = false;
    (Apple.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    await render(
      <TestProviders>
        <SignInScreen />
      </TestProviders>,
    );
    expect(screen.queryByText('Apple button')).toBeNull();
    expect(screen.getByLabelText('Continue with Google')).toBeOnTheScreen();
  });

  describe('per platform', () => {
    const original = Platform.OS;
    afterEach(() => {
      Platform.OS = original;
    });
    const renderPlain = () =>
      render(
        <TestProviders>
          <SignInScreen />
        </TestProviders>,
      );

    it('web shows email only', async () => {
      Platform.OS = 'web';
      await renderPlain();
      expect(screen.queryByText('Apple button')).toBeNull();
      expect(screen.queryByLabelText('Continue with Google')).toBeNull();
      expect(screen.getByLabelText('Continue with email')).toBeOnTheScreen();
    });

    it('iOS hides Google without the iOS client id', async () => {
      mockConfig.googleIosClientId = null;
      await renderPlain();
      expect(screen.queryByLabelText('Continue with Google')).toBeNull();
    });

    it('Android needs only the web client id', async () => {
      Platform.OS = 'android';
      mockConfig.googleIosClientId = null;
      await renderPlain();
      expect(screen.getByLabelText('Continue with Google')).toBeOnTheScreen();
    });

    it('Android hides Google without the web client id', async () => {
      Platform.OS = 'android';
      mockConfig.googleWebClientId = null;
      await renderPlain();
      expect(screen.queryByLabelText('Continue with Google')).toBeNull();
    });
  });

  it('navigates to the email screen', async () => {
    await renderSignIn();
    await fireEvent.press(screen.getByLabelText('Continue with email'));
    expect(mockPush).toHaveBeenCalledWith('/sign-in-email');
  });
});

describe('email sign-in', () => {
  const renderEmail = () =>
    render(
      <TestProviders>
        <SignInEmailScreen />
      </TestProviders>,
    );

  const sendCode = async () => {
    await renderEmail();
    await fireEvent.changeText(screen.getByLabelText('Email'), '  Me@Example.COM ');
    await fireEvent.press(screen.getByLabelText('Send code'));
  };

  it('keeps Send code disabled until the email looks valid', async () => {
    await renderEmail();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'me@example');
    expect(screen.getByLabelText('Send code')).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'me@example.com');
    expect(screen.getByLabelText('Send code')).toBeEnabled();
  });

  it('sends a trimmed, lowercased email then verifies the code (auto-submit at 6 digits)', async () => {
    await sendCode();
    expect(mockClient.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'me@example.com',
      options: { shouldCreateUser: true },
    });
    const field = screen.getByLabelText('6-digit code');
    expect(field.props.textContentType).toBe('oneTimeCode');
    await fireEvent.changeText(field, '12a34b56x7');
    expect(mockClient.auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mockClient.auth.verifyOtp).toHaveBeenCalledWith({ email: 'me@example.com', token: '123456', type: 'email' });
  });

  it('accepts and auto-submits at the configured length (8)', async () => {
    mockConfig.emailOtpLength = 8;
    try {
      await sendCode();
      const field = screen.getByLabelText('8-digit code');
      expect(field.props.maxLength).toBe(8);
      expect(screen.getByText('We sent an 8-digit code to me@example.com.')).toBeOnTheScreen();
      await fireEvent.changeText(field, '123456');
      expect(mockClient.auth.verifyOtp).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Verify')).toBeDisabled();
      await fireEvent.changeText(field, '12345678');
      expect(screen.getByLabelText('Verify')).toBeEnabled();
      expect(mockClient.auth.verifyOtp).toHaveBeenCalledTimes(1);
      expect(mockClient.auth.verifyOtp).toHaveBeenCalledWith({ email: 'me@example.com', token: '12345678', type: 'email' });
    } finally {
      mockConfig.emailOtpLength = 6;
    }
  });

  it('verifies with the Verify button', async () => {
    await sendCode();
    const field = screen.getByLabelText('6-digit code');
    await fireEvent.changeText(field, '123456');
    mockClient.auth.verifyOtp.mockClear();
    await fireEvent.press(screen.getByLabelText('Verify'));
    expect(mockClient.auth.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('shows the connection message, not the wrong-code one, for network failures', async () => {
    mockClient.auth.verifyOtp.mockRejectedValue(new TypeError('Network request failed'));
    await sendCode();
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '111111');
    expect(screen.getByText(ERROR)).toBeOnTheScreen();
    expect(screen.queryByText("That code didn't work. Check it and try again.")).toBeNull();
  });

  it('verifies the incomplete code message path is disabled for a pasted short code', async () => {
    await sendCode();
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '12345');
    expect(screen.getByLabelText('Verify')).toBeDisabled();
    expect(mockClient.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('shows the wrong-code message', async () => {
    mockClient.auth.verifyOtp.mockResolvedValue({ error: new Error('invalid') });
    await sendCode();
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '111111');
    expect(screen.getByText("That code didn't work. Check it and try again.")).toBeOnTheScreen();
  });

  it('disables Resend for 60 seconds', async () => {
    jest.useFakeTimers();
    try {
      await sendCode();
      expect(screen.getByLabelText('Resend code')).toBeDisabled();
      await act(async () => {
        jest.advanceTimersByTime(59_000);
      });
      expect(screen.getByLabelText('Resend code')).toBeDisabled();
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      expect(screen.getByLabelText('Resend code')).toBeEnabled();
      await fireEvent.press(screen.getByLabelText('Resend code'));
      expect(mockClient.auth.signInWithOtp).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText('Resend code')).toBeDisabled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AuthProvider', () => {
  function Probe() {
    const a = useAuth();
    return <Text>{`${a.status}|${a.userId}|${a.email}|${a.provider}`}</Text>;
  }
  /** What the session storage holds under the client's storage key (raw JSON, as auth-js writes it). */
  let stored: string | null = null;
  const readStoredSession = jest.fn(async () => stored);
  const wrap = (children: ReactNode) => (
    <AuthProvider client={mockClient as never} readStoredSession={readStoredSession}>
      {children}
    </AuthProvider>
  );
  const storedSession = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      access_token: 'expired-jwt',
      refresh_token: 'rt-1',
      expires_at: 1,
      user: { id: 'u-stored', email: 's@t.co', app_metadata: { provider: 'google' } },
      ...extra,
    });
  /** Captures the auth listener; getSession never resolves unless a test says otherwise. */
  let listener!: (e: string, s: unknown) => void;
  const captureListener = () =>
    mockClient.auth.onAuthStateChange.mockImplementation((cb) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

  beforeEach(() => {
    stored = null;
    readStoredSession.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('is loading until getSession resolves, then follows auth events', async () => {
    let listener!: (e: string, s: unknown) => void;
    const unsubscribe = jest.fn();
    mockClient.auth.onAuthStateChange.mockImplementation((cb) => {
      listener = cb;
      return { data: { subscription: { unsubscribe } } };
    });
    let resolveSession!: (v: unknown) => void;
    mockClient.auth.getSession.mockReturnValue(new Promise((r) => (resolveSession = r)));
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove } as never);
    const { unmount } = await render(wrap(<Probe />));
    expect(screen.getByText('loading|null|null|null')).toBeOnTheScreen();
    await act(async () => resolveSession({ data: { session: null } }));
    expect(screen.getByText('signedOut|null|null|null')).toBeOnTheScreen();
    await act(async () =>
      listener('SIGNED_IN', { user: { id: 'u1', email: 'a@b.co', app_metadata: { provider: 'apple' } } }),
    );
    expect(screen.getByText('signedIn|u1|a@b.co|apple')).toBeOnTheScreen();
    await act(async () => listener('SIGNED_OUT', null));
    expect(screen.getByText('signedOut|null|null|null')).toBeOnTheScreen();
    await unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(mockClient.auth.stopAutoRefresh).toHaveBeenCalled();
  });

  it('seeds signed-in from an existing session', async () => {
    mockClient.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
    mockClient.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u2', email: 'x@y.zz', app_metadata: { provider: 'email' } } } },
    });
    await render(wrap(<Probe />));
    expect(screen.getByText('signedIn|u2|x@y.zz|email')).toBeOnTheScreen();
  });

  // auth-js offline: an expired access token whose refresh fails retryably stays in storage, but
  // getSession resolves { session: null, error } and INITIAL_SESSION fires with null.
  it('stays signed in from the stored session when the initial session is null (offline refresh failure)', async () => {
    captureListener();
    mockClient.auth.getSession.mockReturnValue(new Promise(() => {}));
    stored = storedSession();
    await render(wrap(<Probe />));
    expect(screen.getByText('loading|null|null|null')).toBeOnTheScreen();
    await act(async () => listener('INITIAL_SESSION', null));
    expect(screen.getByText('signedIn|u-stored|s@t.co|google')).toBeOnTheScreen();
  });

  it('stays signed in from the stored session when getSession reports a retryable error', async () => {
    mockClient.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
    mockClient.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError('Network request failed', 0),
    });
    stored = storedSession();
    await render(wrap(<Probe />));
    expect(screen.getByText('signedIn|u-stored|s@t.co|google')).toBeOnTheScreen();
  });

  it('is signed out when the initial session is null and nothing usable is stored', async () => {
    captureListener();
    mockClient.auth.getSession.mockReturnValue(new Promise(() => {}));
    stored = storedSession({ refresh_token: '' });
    await render(wrap(<Probe />));
    await act(async () => listener('INITIAL_SESSION', null));
    expect(screen.getByText('signedOut|null|null|null')).toBeOnTheScreen();
  });

  it('treats unreadable or malformed storage as signed out', async () => {
    captureListener();
    mockClient.auth.getSession.mockReturnValue(new Promise(() => {}));
    stored = '{not json';
    await render(wrap(<Probe />));
    await act(async () => listener('INITIAL_SESSION', null));
    expect(screen.getByText('signedOut|null|null|null')).toBeOnTheScreen();
  });

  it('a rejected refresh later (SIGNED_OUT) still signs out after a stored-session start', async () => {
    captureListener();
    mockClient.auth.getSession.mockReturnValue(new Promise(() => {}));
    stored = storedSession();
    await render(wrap(<Probe />));
    await act(async () => listener('INITIAL_SESSION', null));
    expect(screen.getByText('signedIn|u-stored|s@t.co|google')).toBeOnTheScreen();
    stored = null;
    await act(async () => listener('SIGNED_OUT', null));
    expect(screen.getByText('signedOut|null|null|null')).toBeOnTheScreen();
  });

  it('caps a hung initial load: falls back to the stored session after the timeout', async () => {
    jest.useFakeTimers();
    captureListener();
    mockClient.auth.getSession.mockReturnValue(new Promise(() => {}));
    stored = storedSession();
    await render(wrap(<Probe />));
    await act(() => jest.advanceTimersByTimeAsync(INITIAL_LOAD_TIMEOUT_MS - 1));
    expect(screen.getByText('loading|null|null|null')).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTimeAsync(1));
    expect(screen.getByText('signedIn|u-stored|s@t.co|google')).toBeOnTheScreen();
    expect(INITIAL_LOAD_TIMEOUT_MS).toBe(10_000);
  });

  it('caps a hung initial load: signed out after the timeout when nothing is stored', async () => {
    jest.useFakeTimers();
    captureListener();
    mockClient.auth.getSession.mockReturnValue(new Promise(() => {}));
    await render(wrap(<Probe />));
    await act(() => jest.advanceTimersByTimeAsync(INITIAL_LOAD_TIMEOUT_MS));
    expect(screen.getByText('signedOut|null|null|null')).toBeOnTheScreen();
  });

  it('a real auth event wins over a slower stored-session check', async () => {
    captureListener();
    mockClient.auth.getSession.mockReturnValue(new Promise(() => {}));
    let release!: (v: string | null) => void;
    readStoredSession.mockImplementationOnce(() => new Promise((r) => (release = r)));
    await render(wrap(<Probe />));
    await act(async () => listener('INITIAL_SESSION', null));
    await act(async () => listener('SIGNED_OUT', null));
    await act(async () => release(storedSession()));
    expect(screen.getByText('signedOut|null|null|null')).toBeOnTheScreen();
  });
});
