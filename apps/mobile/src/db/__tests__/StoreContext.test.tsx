import { act, renderHook } from '@testing-library/react-native';
import { CollectionStore, createMemoryRepo } from '@mst/collection-core';
import type { ReactNode } from 'react';
import { StoreProvider, useCounts, useStore, useTracked } from '../StoreContext';

function setup() {
  const store = new CollectionStore(createMemoryRepo(), () => '2026-11-15T00:00:00.000Z');
  const wrapper = ({ children }: { children: ReactNode }) => <StoreProvider store={store}>{children}</StoreProvider>;
  return { store, wrapper };
}

describe('StoreContext', () => {
  it('provides the store', async () => {
    const { store, wrapper } = setup();
    expect((await renderHook(() => useStore(), { wrapper })).result.current).toBe(store);
  });

  it('re-renders tracked sets when the store changes', async () => {
    const { store, wrapper } = setup();
    const { result } = await renderHook(() => useTracked(), { wrapper });
    expect(result.current).toEqual([]);
    await act(() => store.track('fx'));
    expect(result.current.map((t) => t.setId)).toEqual(['fx']);
  });

  it('re-renders counts for a set when a version is tapped', async () => {
    const { store, wrapper } = setup();
    const { result } = await renderHook(() => useCounts('fx'), { wrapper });
    expect(result.current).toEqual({});
    await act(() => store.tap('fx', 'c-001', 'normal'));
    expect(result.current).toEqual({ 'c-001:normal': 1 });
  });

  it('throws a clear error outside the provider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(renderHook(() => useStore())).rejects.toThrow(/StoreProvider/);
    jest.restoreAllMocks();
  });
});
