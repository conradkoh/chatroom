---
type: best-practice
title: Explicit optional props for intermediate states
description: TypeScript component props should distinguish omitted capabilities from values that are temporarily unavailable.
tags: [typescript, react, type-safety, props, conventions]
status: stable
---

# Explicit optional props for intermediate states

Use optional-property syntax (`prop?: T`) only when omitting the prop is a supported and meaningful behavior.

When a prop is required by the component contract but may be unavailable during loading, hydration, or another intermediate state, declare the property as required and include `undefined` in its value type:

```ts
interface PanelProps {
  teamStructure: TeamStructure | undefined;
  isLoading: boolean;
}
```

This forces every caller to acknowledge the state explicitly. It prevents a missing binding from silently becoming indistinguishable from an intentional unavailable value.

Use `null` when the application has a deliberate semantic empty state, such as “this chatroom has no team.” Use `undefined` for unresolved or not-yet-loaded data. If both states are real, use `T | null | undefined` on a required property.

Avoid defaults such as `items = []` or `isActive ?? false` at component boundaries when they can conceal missing data or incomplete wiring. Prefer explicit loading state and required bindings.

For related optional capabilities, prefer one explicitly optional object over several independently optional props. For example:

```ts
interface PanelProps {
  teamSelector:
    | {
        teams: readonly TeamConfigEntry[];
        onChange: (team: TeamConfigEntry) => Promise<void>;
      }
    | undefined;
}
```

This keeps invalid partial combinations out of the component API.

## Scope

This convention applies especially to React component boundaries and hooks that expose asynchronous state. It does not prohibit optional fields in persisted documents or external API payloads where omission is part of the data contract.

The `AgentPanel` role-display cleanup is the reference application: structural team data is explicitly supplied as `TeamStructure | null | undefined`, while runtime booleans, arrays, and callbacks are required bindings.
