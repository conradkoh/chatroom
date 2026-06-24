# Domain Models — Multi-Shape Pattern

When defining a well-known set of string-literal values in the domain layer (e.g. team kinds, agent roles, statuses), use `z.enum(...)` as the **single source of truth** and derive all other shapes from it.

## Canonical Pattern (string-literal domains)

1. Define a zod enum schema — this is the source of truth:

```ts
export const teamKindSchema = z.enum(['duo', 'solo']);
```

2. Derive all needed shapes:

| Shape                | Derivation                                                     | Purpose                                    |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| **Type**             | `z.infer<typeof teamKindSchema>`                               | Compile-time union for function signatures |
| **Tuple**            | `teamKindSchema.options`                                       | Iterable readonly tuple                    |
| **Enum object**      | `teamKindSchema.enum`                                          | Runtime lookup (`TeamKindEnum.duo`)        |
| **Convex validator** | `v.union(...(options.map(v.literal))` via `VLiteralsOf` helper | Mutation/query arg validation              |
| **Runtime guard**    | `teamKindSchema.safeParse(value).success`                      | Narrowing in conditionals                  |

3. Convex validator uses the shared helper (import from `_shared/v-literals-of`) to preserve literal types through `v.union(...)`:

```ts
type VLiteralsOf<T extends readonly (string | number | bigint | boolean)[]> = {
  [K in keyof T]: VLiteral<T[K], 'required'>;
};

export const teamKindValidator = v.union(...toLiteralValidators(teamKindSchema.options));
```

4. Always add a sync test: assert `teamKindValidator.members[i].value` matches the source tuple. This is the teeth against silent drift.

## Trade-off: mixed-literal domains

**String-literal domains** use `z.enum(...)` as the source of truth — it gives the type, the readonly tuple, and the enum-like object for free. **Mixed-literal domains** (numbers, bigints, booleans, or mixed types) can't use `z.enum` and should use an `as const` tuple as the source instead, deriving the zod schema from it. The Convex validator pattern (via `VLiteralsOf`) works in both cases.

## Rules

- **One edit to add a value**: append to the `z.enum(...)` array. All derived shapes update automatically.
- **Place in `src/domain/entities/`**: follow the flat-file convention (one entity per file).
- **Zod is the source for string-literal domains**: `as const` tuple is the fallback for mixed-literal domains.
- **Add a validator-sync test**: prevents the Convex validator from drifting from the source.

## Example

See `services/backend/src/domain/entities/team-kind.ts` for the canonical implementation.

## Anti-patterns

❌ Hand-writing the union type separately:

```ts
// BAD — add a new kind here and forget to update the validator
export type TeamKind = 'duo' | 'solo';
export const teamKindValidator = v.union(v.literal('duo'), v.literal('solo'));
```

✅ Deriving from source:

```ts
// GOOD — single edit updates everything
export const teamKindSchema = z.enum(['duo', 'solo']);
export type TeamKind = z.infer<typeof teamKindSchema>;
export const teamKindValidator = v.union(
  ...(teamKindSchema.options.map((k) => v.literal(k)) as unknown as VLiteralsOf<
    typeof teamKindSchema.options
  >)
);
```
