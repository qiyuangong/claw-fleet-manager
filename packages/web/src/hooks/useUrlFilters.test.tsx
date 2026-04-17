import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUrlFilters } from './useUrlFilters';

type TestFilters = {
  status: 'all' | 'done';
  q: string;
  instance?: string;
};

const definitions = {
  status: {
    key: 'status',
    defaultValue: 'all' as const,
  },
  q: {
    key: 'q',
    defaultValue: '',
    debounceMs: 250,
  },
  instance: {
    key: 'instance',
    defaultValue: undefined as string | undefined,
    parse: (value: string | null) => value ?? undefined,
    serialize: (value: string | undefined) => value,
  },
};

describe('useUrlFilters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/?view=dashboard&status=done&q=alpha&instance=beta');
  });

  it('reads initial values from the URL and preserves unrelated params', () => {
    const { result } = renderHook(() => useUrlFilters<TestFilters>(definitions));

    expect(result.current.values).toEqual({
      status: 'done',
      q: 'alpha',
      instance: 'beta',
    });
    expect(window.location.search).toBe('?view=dashboard&status=done&q=alpha&instance=beta');
  });

  it('omits default values from the URL when filters are reset', async () => {
    const { result } = renderHook(() => useUrlFilters<TestFilters>(definitions));

    act(() => {
      result.current.setFilters({
        status: 'all',
        q: '',
        instance: undefined,
      });
    });

    expect(window.location.search).toBe('?view=dashboard');
  });

  it('debounces q updates for 250ms before replacing the URL', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    const { result } = renderHook(() => useUrlFilters<TestFilters>(definitions));

    act(() => {
      result.current.setFilter('q', 'new query');
    });

    expect(result.current.values.q).toBe('new query');
    expect(window.location.search).toBe('?view=dashboard&status=done&q=alpha&instance=beta');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(window.location.search).toBe('?view=dashboard&status=done&q=alpha&instance=beta');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(window.location.search).toBe('?view=dashboard&status=done&q=new+query&instance=beta');
    expect(replaceStateSpy).toHaveBeenCalled();
  });

  it('re-hydrates values on popstate', async () => {
    const { result } = renderHook(() => useUrlFilters<TestFilters>(definitions));

    act(() => {
      window.history.replaceState({}, '', '/?view=sessions&status=all&instance=gamma');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(result.current.values).toEqual({
      status: 'all',
      q: '',
      instance: 'gamma',
    });
  });
});
