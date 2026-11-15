import { useColorScheme } from 'react-native';
import { dark, light, type Theme } from './tokens';

export type { Theme } from './tokens';
export { dark, light } from './tokens';

/** Follows the system colour scheme; light when it is unknown. */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
