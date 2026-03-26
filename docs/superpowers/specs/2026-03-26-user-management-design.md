# User Management Design

**Date:** 2026-03-26
**Status:** Draft
**Feature:** Multi-user management with profile assignment

---

## Overview

Add a user management system to Claw Fleet Manager that supports multiple users with two roles: `admin` and `user`. The default admin user is seeded from `server.config.json` on first start. Admins can create and delete users, reset passwords, and assign profiles. Regular users can only see and manage their assigned profiles, and can change their own password.

---

## Data Model

### `users.json` (stored in `fleetDir`)

```json
{
  "users": [
    {
      "username": "admin",
      "passwordHash": "scrypt$<salt-hex>$<hash-hex>",
      "role": "admin",
      "assignedProfiles": []
    },
    {
      "username": "alice",
      "passwordHash": "scrypt$<salt-hex>$<hash-hex>",
      "role": "user",
      "assignedProfiles": ["profile-a", "profile-b"]
    }
  ]
}
```

**Key decisions:**

- **Bootstrap**: On first start, if `users.json` does not exist, it is auto-created with a single `admin` user seeded from `server.config.json`'s `auth.username` / `auth.password`. After `users.json` exists, `server.config.json`'s `auth` block is **ignored entirely** — `UserService.verify()` is the sole credential authority. Subsequent server restarts do not re-seed or overwrite `users.json`.
- **`assignedProfiles`**: Array of profile IDs. Ignored for `admin` role — admins always have full access to all profiles.
- **`passwordHash`**: Hashed using Node's built-in `crypto.scrypt`. Format: `scrypt$<salt-hex>$<hash-hex>`. Passwords are never stored in plaintext and never returned in API responses.
- **Last-admin invariant**: `UserService.delete()` checks that at least one `admin`-role user would remain after the deletion. Deletion is rejected with 403 if it would leave zero admins (regardless of username). It is not simply the user named `admin` that is protected.
- **Username constraints**: Usernames must match `/^[a-z0-9][a-z0-9_-]{0,62}$/` — lowercase alphanumeric, underscores, hyphens; 1–63 characters. Validated via zod on `POST /api/users`.
- **Password constraints**: Minimum 8 characters. Validated via zod on all password fields.

**Type definitions:**

```typescript
interface User {
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
  assignedProfiles: string[];
}

// Returned by API — no passwordHash
type PublicUser = Omit<User, 'passwordHash'>;
```

All API responses use `PublicUser`. The `passwordHash` field is never serialised to the wire.

---

## Architecture

### New: `UserService` (`packages/server/src/services/user.ts`)

Single responsibility: manage the `users.json` file.

**Methods:**

- `initialize(bootstrapCredentials: { username: string; password: string }): Promise<void>` — seeds `users.json` from `server.config.json` credentials if the file does not exist. No-op on subsequent calls.
- `verify(username: string, password: string): Promise<User | null>` — looks up the user then uses `crypto.scrypt` to verify. To prevent timing-based username enumeration, always performs a dummy hash comparison for unknown usernames (using a pre-computed sentinel hash) so that "user not found" and "wrong password" take the same time.
- `list(): PublicUser[]` — returns all users without `passwordHash`.
- `get(username: string): PublicUser | undefined`
- `create(username: string, password: string, role: 'admin' | 'user'): Promise<PublicUser>`
- `delete(username: string): Promise<void>` — enforces the last-admin invariant.
- `setPassword(username: string, newPassword: string): Promise<void>` — admin reset path; no current-password check.
- `verifyAndSetPassword(username: string, currentPassword: string, newPassword: string): Promise<void>` — self-service path; verifies current password before updating.
- `setAssignedProfiles(username: string, profiles: string[]): Promise<void>` — validates that all profile IDs match `PROFILE_NAME_RE` but does **not** enforce that profiles exist (stale assignments are silently ignored during filtering).

Atomic writes use `.tmp` + rename (same pattern as `FleetConfigService`).

**Stale profile assignments**: If a profile is deleted after being assigned to a user, the stale entry in `assignedProfiles` is harmless — the server-side filter on `GET /api/fleet` will simply never find a matching instance for it.

### Modified: `auth.ts`

- Replace the single `isAuthorized(credentials, config)` credential check with `await userService.verify(username, password)`.
- After successful auth, attach the resolved `User` object to `request.user` via a Fastify request decorator.
- **Proxy cookie behaviour on password change**: The proxy cookie (`x-fleet-proxy-auth`) stores Base64-encoded `username:password`. The auth hook re-validates proxy cookie credentials on every request via `userService.verify()`, so a password change immediately invalidates any existing proxy cookies for that user on the next request. No explicit cookie revocation mechanism is needed.

### New: `authorize.ts` (`packages/server/src/authorize.ts`)

Authorization helpers used as route-level `preHandler` hooks:

- `requireAdmin(request, reply)` — rejects non-admin with HTTP 403.
- `requireProfileAccess(request, reply)` — for routes with `:id` param, checks `request.user.assignedProfiles.includes(id)`. No-op for admins.

### New: `routes/users.ts`

User management API endpoints. Route `/api/users/me` is registered **before** the parametric `/api/users/:username` to prevent the static segment being swallowed by the dynamic route.

### Modified: `fastify.d.ts`

Add `request.user: User` to Fastify type augmentation.

### Modified: `index.ts`

- Instantiate `UserService` and call `userService.initialize(config.auth)` during startup.
- Pass `userService` to `registerAuth`.
- Register `userRoutes`.
- Decorate the Fastify instance with `userService`.
- **Remove** the `app.proxyAuth` decorator. Instead, `proxy.ts` constructs the upstream `Authorization` header per-request from `request.user.username` + the stored `passwordHash` is not usable directly. The proxy must forward `request.headers.authorization` as-is (already present since auth passed) rather than using a single pre-built value. Update `proxy.ts` to forward the raw `Authorization` header from the incoming request.

---

## API Routes

### Admin-only

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users` | List all users (`PublicUser[]`) |
| `POST` | `/api/users` | Create user `{ username, password, role }` |
| `DELETE` | `/api/users/:username` | Delete user (enforces last-admin invariant) |
| `PUT` | `/api/users/:username/password` | Reset any user's password `{ password }` (no currentPassword) |
| `PUT` | `/api/users/:username/profiles` | Set assigned profiles `{ profiles: string[] }` |

### Any authenticated user

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users/me` | Returns `PublicUser` for current user |
| `PUT` | `/api/users/me/password` | Change own password `{ currentPassword, newPassword }` |

**Note**: `/api/users/me` is registered before `/api/users/:username`.

---

## Authorization Matrix

| Route | Admin | User |
|-------|-------|------|
| `GET /api/fleet` | All instances | Filtered server-side to assigned profiles |
| `POST /api/fleet/scale` | ✅ | ❌ 403 |
| `GET/PUT /api/config/fleet` | ✅ | ❌ 403 |
| `GET/POST /api/fleet/profiles` | ✅ | ❌ 403 |
| `DELETE /api/fleet/profiles/:name` | ✅ | ❌ 403 |
| `/api/fleet/:id/*` (instance ops) | ✅ | Assigned profiles only (403 otherwise) |
| `WS /ws/logs/:id` | ✅ | Assigned profiles only (closes with 403) |
| `WS /ws/logs` | ✅ | ❌ 403 (streams all instances) |
| `GET/POST /api/users` | ✅ | ❌ 403 |
| `DELETE/PUT /api/users/:username` | ✅ | ❌ 403 |
| `GET /api/users/me` | ✅ | ✅ |
| `PUT /api/users/me/password` | ✅ | ✅ |

**`GET /api/fleet` server-side filtering**: The `fleetRoutes` handler checks `request.user.role`. For `user` role, it filters `instances` to those whose `id` is in `request.user.assignedProfiles` before returning. This is enforced on the server, not just the client.

---

## Web UI

### New components

**`UserManagementPanel`** (admin-only, new top-level panel):
- Table of users: username, role, assigned profiles (shown as tags), action buttons
- "Add User" button → inline form (username, password, role selector)
- Per-row: "Delete", "Reset Password", "Edit Profiles"
- "Edit Profiles" opens a multi-select dropdown of all existing profile names

**`ChangePasswordDialog`**:
- Accessible from an account indicator (username display) in the top-right of `Shell`
- Admin changing their own password: requires `currentPassword` + `newPassword` (same as self-service path)
- Admin resetting another user's password: only `newPassword` (admin reset path)
- Regular user: requires `currentPassword` + `newPassword`

### Modified components

**`Sidebar`**: Adds a "Users" entry visible only when `currentUser.role === 'admin'`.

**`Shell`**: Adds a small account indicator (username + change-password link) in the top-right.

**`App` / `store.ts`**: Adds `currentUser: PublicUser | null` to Zustand state, populated by `useCurrentUser()` hook on load.

### New hooks

**`useCurrentUser()`**: Calls `GET /api/users/me`, caches result in Zustand. Used to gate admin UI and filter instance list.

**`useUsers()`**: Calls `GET /api/users` (admin only). Used by `UserManagementPanel`.

### Instance filtering

The `GET /api/fleet` endpoint already filters server-side. The client additionally filters the sidebar list using `currentUser.assignedProfiles` for defense-in-depth.

---

## Error Handling

| Scenario | HTTP Status |
|----------|-------------|
| `POST /api/users` with duplicate username | 409 Conflict |
| `DELETE /api/users/:username` would remove last admin | 403 Forbidden |
| `PUT /api/users/me/password` with wrong `currentPassword` | 401 Unauthorized |
| `/api/fleet/:id/*` for unassigned profile (non-admin) | 403 Forbidden |
| `WS /ws/logs/:id` for unassigned profile (non-admin) | WebSocket close 4003 |
| `POST /api/users` with invalid username format | 400 Bad Request |
| `POST /api/users` with password shorter than 8 chars | 400 Bad Request |
| Any admin-only endpoint accessed by `user` role | 403 Forbidden |

All validation uses `zod` schemas, consistent with existing routes.

---

## Testing

- Unit tests for `UserService`: seed, verify (including timing-safe unknown-user path), CRUD, password hashing, last-admin invariant
- Route tests for `/api/users/*`: admin access, user access, auth enforcement, duplicate username, last-admin deletion
- Route tests for authorization on existing routes: non-admins get 403 on admin-only endpoints, 403 on unassigned profile endpoints
- Test that `GET /api/fleet` filters correctly for `user` role server-side
- Test that `/api/users/me` resolves correctly and is not captured by the parametric `:username` route
