# Application

Application-specific (non-framework) frontend code.

## Auth (`application/auth/`)

Mirrors backend `permissions.ts` and `roles.ts` (must stay in sync — `__tests__/rbac-registry-sync.spec.ts`).

| Export                               | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `useHasPermission(permission)`       | Hook; reads `authState.permissions` from `auth.getState` |
| `<RequirePermission permission="…">` | Conditional render                                       |
| `<RequirePermission permission="…">` | Conditional render from `authState.permissions`          |

### Add a permission

1. Register in **both** `permissions.ts` files (webapp + `services/backend/application/auth/permissions.ts`).
2. Grant in **both** `roles.ts` files.
3. UI: `useHasPermission('your:permission')` or `<RequirePermission permission="…">`.

Use `authState.permissions` (server-resolved). **Never** gate on `accessLevel` or role names — use `useHasPermission` / `RequirePermission` with keys from `permissions.ts` (e.g. `SYSTEM_ADMIN_ACCESS_PERMISSION`).

### Add a role

Append to `roleDefinitions` in both packages. Custom roles are not assignable until Phase 1b (`users.roleNames`).

### Reference

- Guide: `docs/features/rbac/define-new-role.md`
- System admin link: `components/UserMenu.tsx` (`system_admin:access`)
- System admin layout: `app/app/admin/layout.tsx` (`RequirePermission` + `system_admin:access`)

Do not use bare `admin` for permissions or roles — see `docs/features/rbac/define-new-role.md` (system admin vs business admin).
