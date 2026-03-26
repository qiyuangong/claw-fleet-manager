# User Management Design

**Date:** 2026-03-26
**Status:** Approved
**Feature:** Multi-user management with profile assignment

---

## Overview

Add a user management system to Claw Fleet Manager that supports multiple users with two roles: `admin` and `user`. The default admin user is seeded from `server.config.json`. Admins can create and delete users, reset passwords, and assign profiles. Regular users can only see and manage their assigned profiles, and can change their own password.

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
- **Bootstrap**: On first start, if `users.json` does not exist, it is auto-created with a single `admin` user seeded from `server.config.json`'s `auth.username` / `auth.password`. This preserves backwards compatibility.
- **`assignedProfiles`**: Array of profile IDs. Ignored for `admin` role — admins always have full access to all profiles.
- **`passwordHash`**: Hashed using Node's built-in `crypto.scrypt`. Format: `scrypt$<salt-hex>$<hash-hex>`. Passwords are never stored in plaintext and never returned in API responses.
- **Constraints**: The `admin` user cannot be deleted. A user cannot delete themselves.

---

## Architecture

### New: `UserService` (`packages/server/src/services/user.ts`)

Single responsibility: manage the `users.json` file.

**Methods:**
- `initialize(bootstrapCredentials)` — seeds `users.json` from `server.config.json` if it does not exist
- `verify(username, password): Promise<User | null>` — used by auth hook for credential check
- `list(): User[]` — returns all users (no password hashes)
- `get(username): User | undefined`
- `create(username, password, role): Promise<User>`
- `delete(username): Promise<void>`
- `setPassword(username, newPassword): Promise<void>`
- `verifyPassword(username, currentPassword): Promise<boolean>`
- `setAssignedProfiles(username, profiles: string[]): Promise<void>`

Atomic writes use `.tmp` + rename (same pattern as `FleetConfigService`).

### Modified: `auth.ts`

- Replace the single `isAuthorized(credentials, config)` credential check with `await userService.verify(username, password)`.
- After successful auth, attach the resolved `User` object to `request.user` via a Fastify request decorator.

### New: `authorize.ts` (`packages/server/src/authorize.ts`)

Authorization helpers used as route-level preHandlers:

- `requireAdmin(request, reply)` — rejects non-admin with HTTP 403.
- `requireProfileAccess(request, reply)` — for routes with `:id` param, checks `request.user.assignedProfiles.includes(id)`. Skipped for admins.

### New: `routes/users.ts`

User management API endpoints.

### Modified: `fastify.d.ts`

Add `request.user: User` to Fastify type augmentation.

### Modified: `index.ts`

- Instantiate `UserService` and pass to `registerAuth`.
- Register `userRoutes`.
- Decorate the Fastify instance with `userService`.

---

## API Routes

### Admin-only

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users` | List all users (no password hashes) |
| `POST` | `/api/users` | Create user `{ username, password, role }` |
| `DELETE` | `/api/users/:username` | Delete user (cannot delete self or last admin) |
| `PUT` | `/api/users/:username/password` | Reset any user's password `{ password }` |
| `PUT` | `/api/users/:username/profiles` | Set assigned profiles `{ profiles: string[] }` |

### Any authenticated user

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users/me` | Returns `{ username, role, assignedProfiles }` |
| `PUT` | `/api/users/me/password` | Change own password `{ currentPassword, newPassword }` |

---

## Authorization Matrix

| Route | Admin | User |
|-------|-------|------|
| `GET /api/fleet` | All instances | Assigned profiles only |
| `POST /api/fleet/scale` | ✅ | ❌ 403 |
| `GET/PUT /api/config/fleet` | ✅ | ❌ 403 |
| `GET/POST /api/fleet/profiles` | ✅ | ❌ 403 |
| `DELETE /api/fleet/profiles/:name` | ✅ | ❌ 403 |
| `/api/fleet/:id/*` (instance ops) | ✅ | Assigned profiles only |
| `GET/POST /api/users` | ✅ | ❌ 403 |
| `DELETE/PUT /api/users/:username` | ✅ | ❌ 403 |
| `GET /api/users/me` | ✅ | ✅ |
| `PUT /api/users/me/password` | ✅ | ✅ |

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
- Admin version: only `newPassword` field (no `currentPassword` required)
- User version: requires `currentPassword` + `newPassword`

### Modified components

**`Sidebar`**: Adds a "Users" entry visible only when `currentUser.role === 'admin'`.

**`Shell`**: Adds a small account indicator (username + change-password link) in the top-right.

**`App` / `store.ts`**: Adds `currentUser` to Zustand state, populated by `useCurrentUser()` hook on load.

### New hooks

**`useCurrentUser()`**: Calls `GET /api/users/me`, caches result in Zustand. Used to gate admin UI and filter instance list.

**`useUsers()`**: Calls `GET /api/users` (admin only). Used by `UserManagementPanel`.

### Instance filtering

The fleet instance list is filtered client-side for non-admin users: only instances whose `id` is in `currentUser.assignedProfiles` are shown. The server enforces the same rule, so this is defense-in-depth.

---

## Error Handling

- `POST /api/users` with duplicate username → 409 Conflict
- `DELETE /api/users/admin` → 403 Forbidden
- `PUT /api/users/me/password` with wrong `currentPassword` → 401 Unauthorized
- `GET /api/fleet/:id/*` for unassigned profile (non-admin) → 403 Forbidden
- All validation via `zod` schemas, consistent with existing routes

---

## Testing

- Unit tests for `UserService`: seed, verify, CRUD, password hashing
- Route tests for `/api/users/*`: admin access, user access, auth enforcement
- Route tests for authorization on existing routes: confirm non-admins get 403 on admin-only endpoints and 403 on unassigned profile endpoints
