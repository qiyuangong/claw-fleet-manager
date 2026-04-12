# Activity Task Board Design

**Date:** 2026-04-12
**Status:** Approved
**Feature:** Add a board view to the admin Activity page while keeping the existing table view

## Overview

Extend the admin Activity page so it supports two views over the same session dataset:

- a new status-based task board inspired by the Mission Control reference
- the existing table view for dense scanning and sorting

The Activity page already has usable session data and filtering controls. The safest implementation is to keep the current query and data model intact, add a view toggle, and refactor the UI into smaller subcomponents so the board can evolve without turning `FleetSessionsPanel` into a monolith.

This feature is intentionally a presentation-layer improvement. It does not add new backend endpoints, session mutations, drag-and-drop, or task persistence.

## Goals

- Make the Activity page more scannable and visually distinct for admins
- Preserve the existing table workflow as a dense fallback view
- Reuse existing session data, stats, refresh, and filters
- Group work by session status so large fleets are easier to scan
- Improve usability without inventing unsupported backend actions

## Non-Goals

- No drag-and-drop across columns
- No persistent per-user board preferences
- No backend changes to task state or session state
- No session detail drawer or transcript panel
- No non-admin access changes

## Current Constraints

- The page is rendered by `packages/web/src/components/instances/FleetSessionsPanel.tsx`
- Session data comes from `useFleetSessions()` and already includes the fields needed for a triage board
- Existing filters are status and time based, and the table already supports sort-by tokens, cost, and updated time
- Session statuses currently available in the web types are `running`, `done`, `failed`, `killed`, and `timeout`

The reference screenshot looks like a task system, but our actual backend object is still a session. The board therefore presents session work in a task-board style without pretending these are editable Kanban tasks.

## Architecture

Refactor the Activity feature into a container plus dedicated presentation components.

### `FleetSessionsPanel`

Owns:

- query loading, error, and refresh state
- shared stats calculation
- shared filter state
- shared sort state for table mode
- new `viewMode` state with values `board` and `table`
- derivation of grouped board columns and flat table rows

This component becomes a composition layer rather than a large render file.

### `ActivityBoard`

Renders the board layout and session cards. It is a presentational component that receives:

- grouped sessions by board column
- per-instance fetch errors
- instance selection callback

It does not own fetch, filtering, or sorting logic.

### `SessionsTable`

Remains the dense tabular view and continues to receive already-filtered rows plus the existing sort callbacks.

### Shared Helpers

Keep shared helpers near the Activity feature for:

- session title fallback
- relative timestamp formatting
- token and cost formatting
- status grouping
- unified filtering

## View Model

Add a local Activity view mode toggle:

```ts
type ActivityViewMode = 'board' | 'table';
```

Default mode is `board`, since the purpose of this feature is to make the Activity page more useful and visually structured while still keeping table mode available.

View mode is local UI state only. No persistence is required in this iteration.

## Board Layout

The board is grouped by existing session status into fixed columns:

- `Running`
- `Done`
- `Failed`
- `Killed / Timeout`
- `Other` only when at least one filtered session has no recognized status

Status grouping rules:

- `running` -> `Running`
- `done` -> `Done`
- `failed` -> `Failed`
- `killed` and `timeout` -> `Killed / Timeout`
- missing or unknown status -> `Other`

Each column header shows:

- status label
- filtered card count

The board is horizontally scrollable rather than squeezing columns too tightly. On larger screens, columns render in a single row with consistent widths. On narrower screens, horizontal scroll remains acceptable because the table view already exists as the compact fallback.

## Activity Header

The top of Activity keeps the current structure and adds a view toggle:

- page title
- refresh button
- stats bar
- filter row
- segmented `Board / Table` toggle

The view toggle applies only to presentation. Filters and refresh operate identically in both modes. Changing filters must not reset the selected view.

## Session Cards

Each board card is a clickable, scannable summary rather than a full record dump.

Card content:

- session title using `derivedTitle ?? label ?? key`
- instance id as a clickable button that opens the instance panel
- compact metadata row for model and kind when present
- updated time using the same timestamp fallback as the table
- token count when present
- cost when present
- last message preview clamped to two lines

Visual direction:

- stronger card separation than the current table
- colored status accents at the column or card level
- compact metadata chips where appropriate
- clear empty-column states so unused columns do not look broken

The board should feel more intentional than the existing table, but it still fits the current visual system in `index.css`.

## Table Mode

Table mode remains available as the precise, sortable fallback view.

Behavior:

- preserve existing columns
- preserve current filter behavior
- preserve current sorting behavior
- no redesign beyond any minor shared header changes required by the new toggle

This avoids regressions for admins who prefer dense scanning.

## Error and Empty States

Top-level behavior remains consistent with the current Activity page:

- loading state: existing loading treatment
- top-level fetch error: existing error treatment
- no sessions returned at all: existing empty state
- filters remove all sessions: existing filtered-empty state

Per-instance fetch failures remain visible, but in board mode they render as a compact error strip above the board columns instead of as synthetic table rows.

## Responsive Behavior

Desktop:

- board columns in a horizontal lane
- equal or near-equal column widths
- cards optimized for quick scanning

Tablet:

- narrower columns
- horizontal scrolling allowed

Mobile:

- board columns stack vertically
- table view still available for users who prefer structured density

The board must degrade cleanly when there are many sessions or when preview text is long. Text clamps rather than pushing cards to unusable widths.

## i18n

New translation keys will be needed for the board and toggle, for example:

- `activityViewBoard`
- `activityViewTable`
- `activityBoardRunning`
- `activityBoardDone`
- `activityBoardFailed`
- `activityBoardKilledTimeout`
- `activityBoardOther`
- `activityBoardEmptyColumn`

Existing `manageSessions` already maps to `Activity` in English and `运行活动` in Chinese, so the sidebar label work stays aligned with this feature.

## Testing

Primary verification is Playwright MCP coverage on the Activity page.

Required scenarios:

- Activity renders with board mode available
- `Board / Table` toggle switches views without losing filters
- sessions appear in the correct board columns based on status
- clicking instance id from a board card opens that instance
- empty result state remains visible
- per-instance error state remains visible in board mode

Optional unit coverage can be added for helper functions if grouping logic becomes non-trivial, but the main risk here is UI behavior rather than algorithmic complexity.

## Implementation Notes

- Prefer separate `ActivityBoard` and `SessionsTable` presentation components under the same feature area
- Keep shared transforms in the container or a small co-located helper module
- Avoid introducing drag-and-drop libraries or new state managers
- Keep CSS in the existing web stylesheet unless the current file becomes unmanageable

## Out of Scope

- Drag-and-drop movement between columns
- Editable task workflow states
- Server-side filtering, pagination, or board-specific API parameters
- Persisting the selected board/table mode
- Session detail drill-down
