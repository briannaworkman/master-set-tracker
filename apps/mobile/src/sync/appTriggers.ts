import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

/** How often a foregrounded app re-syncs and re-checks prices. */
export const PERIODIC_MS = 15 * 60_000;

export interface AppTriggerHandlers {
  /** The app became active after being in the background (or inactive). */
  onForeground?(): void;
  /** The app went to the background. */
  onBackground?(): void;
  /** Connectivity changed; reported only on a change from the last value (starting from online). */
  onOnlineChange?(online: boolean): void;
}

export interface AppTriggers {
  isForeground(): boolean;
  isOnline(): boolean;
  dispose(): void;
}

/**
 * Watches AppState and NetInfo. "Online" means NetInfo doesn't report the device as disconnected
 * (an unknown state counts as online, so a sync is attempted and fails as offline if need be).
 */
export function watchAppTriggers(handlers: AppTriggerHandlers): AppTriggers {
  let disposed = false;
  let online = true;
  let appState: string | null | undefined = AppState.currentState;
  const offNet = NetInfo.addEventListener((state) => {
    const next = state.isConnected !== false;
    if (disposed || next === online) return;
    online = next;
    handlers.onOnlineChange?.(next);
  });
  const sub = AppState.addEventListener('change', (next) => {
    const prev = appState;
    appState = next;
    if (disposed) return;
    if (next === 'active' && prev !== 'active') handlers.onForeground?.();
    else if (next === 'background' && prev !== 'background') handlers.onBackground?.();
  });
  return {
    isForeground: () => appState !== 'background',
    isOnline: () => online,
    dispose() {
      disposed = true;
      offNet();
      sub.remove();
    },
  };
}
