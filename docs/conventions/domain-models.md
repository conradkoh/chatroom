# Domain Models — Multi-Shape Pattern

When defining a well-known set of values in the domain layer (e.g. team kinds, agent roles, statuses), use the **single source of truth → derived shapes** pattern to avoid duplication and keep all representations consistent.

## Pattern

1. Define a `const` array with `as const`:

```ts
export const WELL_KNOWN_TEAM_KINDS = ['pair', 'squad', 'duo', 'solo'] as const;
```

2. Derive all needed shapes from this single array:

| Shape | Purpose | Example |
|-------|---------|---------|
| **Type** | Compile-time union for function signatures | `export type TeamKind = (typeof WELL_KNOWN_TEAM_KINDS)[number];` |
| **Enum-like object** | Runtime lookup (`TeamKindEnum.pair`) | `Object.fromEntries(kinds.map(k => [k, k]))` |
| **Iterable list** | The `as const` array itself — already iterable | `WELL_KNOWN_TEAM_KINDS.includes(value)` |
| **Convex validator** | For `v.union(v.literal(...))` in mutation/query args | `v.union(WELL_KNOWN_TEAM_KINDS.map(k => v.literal(k)))` |
| **Zod schema** | Runtime validation outside Convex (CLI, tests) | `z.enum(WELL_KNOWN_TEAM_KINDS)` |

3. Optionally add a type guard:

```ts
export function isTeamKind(value: string): value is TeamKind {
  return (WELL_KNOWN_TEAM_KINDS as readonly string[]).includes(value);
}
```

## Rules

- **One edit to add a value**: append to the `as const` array. All derived shapes update automatically.
- **Keep the source flat**: use a single array, not multiple const declarations.
- **Place in `src/domain/entities/`**: follow the flat-file convention (one entity per file, no sub-folders).
- **Zod is optional**: only add if the dependency already exists in `package.json`. If absent, skip the zod shape and note the omission in a comment.

## Example

See `services/backend/src/domain/entities/team-kind.ts` for the canonical implementation of `TeamKind`.

## Anti-patterns

❌ Hand-writing the union type separately from the const list:
```ts
// BAD — add a new kind here and forget to update the list
export type TeamKind = 'pair' | 'squad' | 'duo' | 'solo';
export const TEAM_KINDS = ['pair', 'squad', 'duo']; // stale
```

✅ Deriving from source:
```ts
// GOOD — single edit updates everything
export const TEAM_KINDS = ['pair', 'squad', 'duo', 'solo'] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];
```
