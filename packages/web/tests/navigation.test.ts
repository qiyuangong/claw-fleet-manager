import { describe, expect, it } from 'vitest';
import { defaultNavigationState, parseNavigationFromUrl, serializeNavigationToUrl } from '../src/navigation';

describe('navigation codec', () => {
  it('parses instance URLs with tab', () => {
    const state = parseNavigationFromUrl(
      'https://example.test/?view=instance&id=openclaw-1&tab=logs',
      defaultNavigationState(true),
    );

    expect(state).toEqual({
      activeView: { type: 'instance', id: 'openclaw-1' },
      activeTab: 'logs',
    });
  });

  it('falls back invalid view to the provided default', () => {
    const fallback = defaultNavigationState(false);

    expect(
      parseNavigationFromUrl('https://example.test/?view=not-a-real-view', fallback),
    ).toEqual(fallback);
  });

  it('falls back invalid instance tab to overview', () => {
    const state = parseNavigationFromUrl(
      'https://example.test/?view=instance&id=openclaw-1&tab=not-a-real-tab',
      defaultNavigationState(true),
    );

    expect(state).toEqual({
      activeView: { type: 'instance', id: 'openclaw-1' },
      activeTab: 'overview',
    });
  });

  it('serializes overview instance URLs without a tab query param', () => {
    expect(
      serializeNavigationToUrl({
        activeView: { type: 'instance', id: 'openclaw-1' },
        activeTab: 'overview',
      }),
    ).toBe('/?view=instance&id=openclaw-1');
  });

  it('serializes top-level views to a stable query string', () => {
    expect(
      serializeNavigationToUrl({
        activeView: { type: 'users' },
        activeTab: 'overview',
      }),
    ).toBe('/?view=users');
  });
});
