import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';
import { fixtureKinds } from '@mst/collection-core/testing';
import { dark, light } from '../tokens';

/** WCAG relative luminance contrast ratio between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
import { useTheme } from '../useTheme';

describe('theme tokens', () => {
  it('an owned Normal dot is distinguishable from the missing ring in light mode', () => {
    const normal = fixtureKinds.find((k) => k.id === 'normal')!.color;
    expect(contrast(normal, light.missing)).toBeGreaterThanOrEqual(1.5);
  });

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
      danger: '#C2363C',
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
      danger: '#FF6B6B',
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
