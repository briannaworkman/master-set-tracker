import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';
import { dark, light } from '../tokens';
import { useTheme } from '../useTheme';

describe('theme tokens', () => {
  it('match the design values exactly', () => {
    expect(light).toEqual({
      bg: '#FBFAF7',
      surface: '#FFFFFF',
      border: '#ECE8E0',
      text: '#1D1B18',
      muted: '#7A756C',
      missing: '#9A9388',
      accent: '#1D1B18',
      overlay: 'rgba(29,27,24,0.35)',
    });
    expect(dark).toEqual({
      bg: '#151412',
      surface: '#1F1D1A',
      border: '#2C2925',
      text: '#F3F0EA',
      muted: '#A19B90',
      missing: '#77716A',
      accent: '#F3F0EA',
      overlay: 'rgba(0,0,0,0.55)',
    });
  });
});

describe('useTheme', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['dark', dark],
    ['light', light],
    [null, light],
  ] as const)('follows the %s colour scheme', async (scheme, expected) => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
    expect((await renderHook(() => useTheme())).result.current).toBe(expected);
  });
});
