# Browser History Navigation Design

**Date:** 2026-04-13
**Status:** Approved
**Feature:** Make browser back/forward restore the current manager page and per-instance tab

## Overview

The current web shell keeps navigation state only in Zustand. Clicking sidebar items, opening an instance, or changing an instance tab updates in-memory state, but it does not create browser history entries or restore state from the URL. As a result, browser back/forward does not move between previously visited pages.

The safest fix is to keep the existing store-driven shell and add a thin URL/history synchronization layer around it. This preserves the current component structure while making each meaningful navigation step representable in the browser URL.

## Goals

- Make browser back/forward restore top-level manager pages
- Make browser back/forward restore per-instance tabs
- Support deep links to instance pages and tabs
- Preserve the existing store-driven component API
- Keep the fix small and localized to the web shell

## Non-Goals

- No migration to `react-router`
- No redesign of the current shell layout
- No persistence beyond the browser URL and history stack
- No backend changes

## Current Constraints

- The shell is rendered by `packages/web/src/components/layout/Shell.tsx`
- Navigation state is stored in `packages/web/src/store.ts`
- Sidebar items and instance tabs call store actions directly
- There is currently no router, no URL parsing, and no `popstate` handling
- Existing role guards in `Shell` already redirect non-admin users away from admin-only views

## Recommended Approach

Keep Zustand as the app-facing navigation API and add a history bridge that translates between:

- store state -> browser URL
- browser URL -> store state

This is preferred over introducing a router because the app already has a working store-based shell, and the bug is specifically missing history synchronization rather than missing route abstractions.

## URL Model

Use query parameters to represent the active shell state:

- `/?view=dashboard`
- `/?view=instances`
- `/?view=sessions`
- `/?view=users`
- `/?view=config`
- `/?view=account`
- `/?view=instance&id=openclaw-1`
- `/?view=instance&id=openclaw-1&tab=logs`

Rules:

- `id` is only valid when `view=instance`
- `tab` is only valid when `view=instance`
- missing or invalid instance `tab` falls back to `overview`
- missing or invalid `view` falls back to the role-appropriate default
- extra unknown query parameters are ignored by navigation parsing

## Architecture

Add a small navigation codec module in the web package. It should:

- parse `window.location` into store navigation state
- serialize store navigation state into a normalized URL
- validate `view` and `tab` values against the known app state types

The store remains responsible for active view and active tab. The shell becomes responsible for:

- hydrating initial navigation state from the current URL
- listening to `popstate`
- applying URL updates when navigation actions change state

## State Flow

### Initial Load

On first render, parse the current URL and update the store to match it. After that, normalize the current URL with `replaceState` so the initial browser entry accurately reflects the resolved state without adding an extra history item.

### User-Initiated Navigation

When a sidebar click, instance open action, or tab click changes the meaningful screen, push a new history entry with the serialized URL.

Meaningful screen changes include:

- top-level view changes
- switching from one instance to another
- switching between instance tabs

### Browser Back/Forward

When the browser emits `popstate`, parse the URL and update the store without pushing another history entry. This prevents loops and lets the browser control the active entry during back/forward navigation.

## Guard and Fallback Behavior

Role and validity guards must stay consistent with existing behavior.

### Invalid View

- invalid `view` values fall back to the existing default destination
- for admins, default to `dashboard`
- for non-admins, default to `account`

### Invalid Tab

- invalid or missing instance tab values fall back to `overview`

### Missing Instance

- if the URL targets an unknown instance id, keep the current `InstancePanel` not-found treatment
- normalize the URL so it still reflects the instance view and selected tab fallback

### Unauthorized View

- if a non-admin URL targets an admin-only page, reuse the existing guard logic to redirect to an allowed destination
- after the guard resolves the destination, replace the URL so it matches the corrected state

## Store Changes

The public store API should stay recognizable to the rest of the app.

Likely changes:

- keep existing actions like `selectInstance`, `selectUsers`, and `setTab`
- add an internal way to apply navigation state from the URL without implicitly pushing history
- make top-level actions and `setTab` history-aware through the shell integration rather than embedding raw `window.history` calls directly into leaf components

This keeps component call sites simple and avoids scattering browser APIs across the tree.

## Testing

### Unit Tests

Add coverage for the navigation codec and store behavior:

- parse valid URLs into the expected store state
- serialize store state into normalized URLs
- invalid `view` falls back correctly
- invalid `tab` falls back to `overview`
- instance URLs omit `tab` when the tab is `overview`

### UI Tests

Add a browser navigation regression test that exercises a real history sequence:

1. open `Manage Instances`
2. open an instance
3. switch to `logs`
4. press browser Back and verify the instance returns to `overview`
5. press browser Back again and verify the app returns to `Manage Instances`
6. press browser Forward twice and verify the instance and `logs` tab restore correctly

This test should run alongside the existing Playwright UI coverage.

## Risks

- Initial hydration can race with role-based guards if the shell updates state before user/fleet data is available
- Pushing duplicate history entries for no-op navigations would make back/forward feel noisy
- Mixing URL normalization with guard redirects can create loops if `replaceState` and `pushState` are not clearly separated

## Mitigations

- Centralize parse/serialize logic in one module instead of duplicating it in components
- Compare current store state before pushing a new history entry
- Use `replaceState` for initial normalization and guard correction, and `pushState` only for user-driven transitions
- Cover the back/forward sequence with an end-to-end regression test

## Implementation Outline

1. Add a navigation codec for `view`, `id`, and `tab`
2. Update the shell to hydrate from URL and listen for `popstate`
3. Wire store-driven navigation changes to URL/history updates
4. Keep existing role guards and make them normalize the URL after correction
5. Add unit tests and an end-to-end regression test for browser back/forward
