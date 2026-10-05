# Domain Models — Multi-Shape Pattern

For a pure backend-owned set of string-literal values (such as statuses), use `z.enum(...)` as the **single source of truth** and derive its TypeScript type, tuple, enum object, runtime guard, and Convex validator. Shared metadata-rich domains are a narrow exception: when compile-time unions and structured projections must be shared across packages, author one shared tuple or literal metadata object and derive backend adapters from it.

## Canonical Pattern: backend-owned literal domains

1. Define a Zod enum schema as the source of truth:

```ts
export const statusSchema = z.enum(['pending', 'complete']);
```

2. Derive all needed shapes:

| Shape                | Derivation                                                     | Purpose                                    |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| **Type**             | `z.infer<typeof statusSchema>`                                 | Compile-time union for function signatures |
| **Tuple**            | `statusSchema.options`                                         | Iterable readonly tuple                    |
| **Enum object**      | `statusSchema.enum`                                            | Runtime lookup                             |
| **Convex validator** | `v.union(...(options.map(v.literal))` via `VLiteralsOf` helper | Mutation/query arg validation              |
| **Runtime guard**    | `statusSchema.safeParse(value).success`                        | Narrowing in conditionals                  |

3. Convex validators use the shared helper (import from `_shared/v-literals-of`) to preserve literal types through `v.union(...)`:

```ts
type VLiteralsOf<T extends readonly (string | number | bigint | boolean)[]> = {
  [K in keyof T]: VLiteral<T[K], 'required'>;
};

export const statusValidator = v.union(...toLiteralValidators(statusSchema.options));
```

4. Add a sync test asserting `validator.members[i].value` matches the source tuple. This catches silent drift.

## Shared metadata-rich domains

Use a shared literal tuple or metadata object as the authored source when a domain needs literal-derived TypeScript unions and structured metadata across packages. Keep the shared package a dependency leaf: do not add backend validators or Zod there.

- Derive unions from keys of a private literal metadata object; do not maintain a second role union or enum.
- Require structural metadata at compile time. Team membership uses a nonempty tuple with explicit team IDs and order values.
- Derive runtime presets and picker projections from this source. Keep presentation-only labels in the owning UI.
- Adapt shared literal tuples downstream to backend Zod schemas and Convex validators; test adapter values against the shared tuple.

The builtin agent-role metadata in `packages/shared/src/domain/agent-role.ts` is the canonical example. Lifecycle and team membership are authored together, and `packages/shared/src/domain/team-presets.ts` derives team structures from those memberships.

For the complete builtin-role ownership map and add-role verification checklist, see [Builtin agent role contracts](agent-role-contracts.md).

## Shared team-kind tuple to backend adapter

`packages/shared/src/domain/team-kind.ts` owns the shared tuple and type. The backend adapts that tuple into Zod and derives the Convex validator from the schema options:

```ts
// packages/shared/src/domain/team-kind.ts
export const TEAM_PRESET_IDS = ['duo', 'solo'] as const;
export type TeamPresetId = (typeof TEAM_PRESET_IDS)[number];

// services/backend/src/domain/entities/team-kind.ts
import { TEAM_PRESET_IDS, type TeamPresetId } from '@workspace/shared/domain/team-kind';
export const teamKindSchema = z.enum(TEAM_PRESET_IDS);
export type TeamKind = TeamPresetId;
export const teamKindValidator = v.union(...toLiteralValidators(teamKindSchema.options));
```

The backend adapter is not a second authored list. Add team kinds to the shared tuple, then retain schema, runtime-guard, enum-object, and validator-sync checks downstream.

## Trade-off: mixed-literal domains

Backend-owned string-literal domains use `z.enum(...)` as their source. Mixed-literal domains (numbers, bigints, booleans, or mixed types) cannot use `z.enum` and should use an `as const` tuple as their source instead, deriving the Zod schema from it. The Convex validator pattern (via `VLiteralsOf`) works in both cases.

## Rules

- For pure backend literal sets, add values to the Zod enum and derive its other shapes.
- For shared metadata-rich domains, edit one shared tuple or metadata source and derive projections and backend adapters from it.
- Keep backend entities in `src/domain/entities/`, following the flat-file convention.
- Add a validator-sync test for every Convex literal adapter.

## Example

See `services/backend/src/domain/entities/team-kind.ts` for the backend adapter pattern and `packages/shared/src/domain/agent-role.ts` for metadata-rich shared ownership.

## Anti-patterns

❌ Hand-writing an additional union or validator list:

```ts
export type TeamKind = 'duo' | 'solo';
export const teamKindValidator = v.union(v.literal('duo'), v.literal('solo'));
```

✅ Deriving from the appropriate single source:

```ts
// Backend-owned literal set
export const statusSchema = z.enum(['pending', 'complete']);
export type Status = z.infer<typeof statusSchema>;

// Shared tuple adapted downstream
export const teamKindSchema = z.enum(TEAM_PRESET_IDS);
export type TeamKind = TeamPresetId;
```
