# Auth Session Helpers

This document is the reference for the session-level authentication helpers in
`services/backend/modules/auth/session.ts`. It covers the API, the read-cost
model that motivates it, how to extend authentication with new session sources,
and how to migrate off the deprecated `getAuthUser` / `getAuthUserOptional`
helpers in `modules/auth/getAuthUser.ts`.

## Why these helpers exist

Every authenticated Convex function resolves a `sessionId` to the acting user.
The original helper (`modules/auth/getAuthUser.ts`) always loaded the **full
user document** — a `sessions` read **and** a `users` read — even when the
caller only needed the `userId` (ownership checks, indexed lookups, audit
fields). On hot paths that extra `users` read adds up.

The session helpers split resolution into **cost-aware** variants so each call
pays only for what it uses.

## API

All helpers take `(ctx, { sessionId })` and live in `modules/auth/session.ts`.

| Helper              | Returns                | On miss                    | DB reads                   |
| ------------------- | ---------------------- | -------------------------- | -------------------------- |
| `getAuthUserId`     | `Id<'users'> \| null`  | `null`                     | 1× `sessions`              |
| `requireAuthUserId` | `Id<'users'>`          | throws `NOT_AUTHENTICATED` | 1× `sessions`              |
| `getAuthUser`       | `Doc<'users'> \| null` | `null`                     | 1× `sessions` + 1× `users` |
| `requireAuthUser`   | `Doc<'users'>`         | throws `NOT_AUTHENTICATED` | 1× `sessions` + 1× `users` |

The naming convention matches the rest of the codebase:

- **`get…`** returns `null` on miss (fail-open). Use it when an unauthenticated
  caller is a valid case (e.g. public data with optional personalization).
- **`require…`** throws `ConvexError({ code: 'NOT_AUTHENTICATED' })` on miss
  (fail-closed). Use it when authentication is mandatory.
- **`…UserId`** costs a single `sessions` read. Prefer it whenever the caller
  only needs the `userId`.
- **`…User`** also reads the `users` document. Use it only when the caller reads
  fields off the user (e.g. `name`, `accessLevel`).

## Usage

```ts
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getAuthUserId, requireAuthUser } from '../modules/auth/session';
import { query } from './_generated/server';

// Ownership check — only the id is needed (1 read, fail-open).
export const myThings = query({
  args: { ...SessionIdArg },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx, args);
    if (!userId) return [];
    return ctx.db
      .query('things')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
  },
});

// Needs the user document and must be authenticated (2 reads, throws on miss).
export const myProfile = query({
  args: { ...SessionIdArg },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx, args);
    return { name: user.name, accessLevel: user.accessLevel };
  },
});
```

## Extending auth with new session sources

Out of the box the helpers resolve sessions from the upstream `sessions` table.
Forks that introduce additional session types — CLI tokens, API keys,
machine-scoped sessions, SSO — register a `SessionResolver` and build their own
helper bundle with `createAuthHelpers`.

A `SessionResolver` maps a `sessionId` to a `userId`, or returns `null` if it
does not recognize the session. Resolvers are tried in order and the first
non-null result wins.

```ts
// fork: services/backend/modules/auth/cli-session.ts
import { createAuthHelpers, defaultSessionResolver, type SessionResolver } from './session';

const cliSessionResolver: SessionResolver = async (ctx, sessionId) => {
  const session = await ctx.db
    .query('cliSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();
  if (!session?.isActive) return null;
  if (session.expiresAt && Date.now() > session.expiresAt) return null;
  return session.userId;
};

// Try CLI sessions first, then fall back to the upstream `sessions` table.
export const { getAuthUserId, requireAuthUserId, getAuthUser, requireAuthUser } = createAuthHelpers(
  [cliSessionResolver, defaultSessionResolver]
);
```

In functions that must accept the new session type, import these fork-local
helpers instead of the upstream defaults. The upstream defaults are exactly
`createAuthHelpers([defaultSessionResolver])`.

### Guidelines for resolvers

- Keep resolvers cheap — a single indexed read. They run on every authenticated
  call.
- Return `null` (do not throw) for sessions a resolver does not recognize, or
  that are expired/revoked, so the next resolver gets a turn.
- Order resolvers most-specific first, and end with `defaultSessionResolver`
  unless you intend to drop upstream sessions entirely.

## Migrating off the deprecated helpers

`modules/auth/getAuthUser.ts` is a back-compat shim kept for one release. Move
call sites to `modules/auth/session.ts`:

| Deprecated (`modules/auth/getAuthUser`) | Replacement (`modules/auth/session`)  | Notes                                                                              |
| --------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `getAuthUser` (throws)                  | `requireAuthUser`                     | Same throwing semantics, clearer name. Now throws `ConvexError NOT_AUTHENTICATED`. |
| `getAuthUserOptional` (nullable)        | `getAuthUser`                         | `get…` now returns `null` on miss — drop the `try/catch`.                          |
| either, when only the id is read        | `getAuthUserId` / `requireAuthUserId` | Skips the `users` read entirely. Preferred for ownership and indexed lookups.      |

### Step by step

1. Update the import:

   ```diff
   - import { getAuthUserOptional } from '../modules/auth/getAuthUser';
   + import { getAuthUser } from '../modules/auth/session';
   ```

2. Rename the call: `getAuthUserOptional(ctx, args)` → `getAuthUser(ctx, args)`.
   Behavior is identical — both return `null` on miss.

3. If the call site only reads `user._id`, prefer the cheaper id helper:

   ```diff
   - const user = await getAuthUser(ctx, args);
   - if (!user) return [];
   - const mine = ctx.db
   -   .query('things')
   -   .withIndex('by_user', (q) => q.eq('userId', user._id));
   + const userId = await getAuthUserId(ctx, args);
   + if (!userId) return [];
   + const mine = ctx.db
   +   .query('things')
   +   .withIndex('by_user', (q) => q.eq('userId', userId));
   ```

4. For the throwing variant, switch `getAuthUser` (old, threw a bare `Error`) to
   `requireAuthUser`, and handle `NOT_AUTHENTICATED` where you previously caught
   the bare `Error`.

### Codemod

The import and rename for the nullable variant are mechanical. Run from
`services/backend`:

```bash
grep -rl "getAuthUserOptional" convex | while read -r f; do
  sed -i '' \
    -e "s#import { getAuthUserOptional } from '\(.*\)/modules/auth/getAuthUser';#import { getAuthUser } from '\1/modules/auth/session';#" \
    -e 's#getAuthUserOptional(#getAuthUser(#g' \
    "$f"
done
```

Review the diff, then run `pnpm typecheck && pnpm test`. Sites that only need
`user._id` should be hand-tuned to `getAuthUserId` afterward.

## Error handling

The `require…` helpers throw a structured error:

```ts
throw new ConvexError({ code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
```

Catch it on the client (or in calling functions) by inspecting
`error.data.code === 'NOT_AUTHENTICATED'`. The `get…` helpers never throw for a
missing session — they return `null`, leaving the authentication decision to the
caller.
