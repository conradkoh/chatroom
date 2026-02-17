# CLI Command DI + Tests Migration Plan

**Goal**: Refactor each CLI command to use dependency injection with interface segregation, then add tests.

## Chatroom Commands

```bash
# Rejoin chatroom after each command migration
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=jx750h696te75x67z5q6cbwkph7zvm2x --role=planner

# Report progress
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=jx750h696te75x67z5q6cbwkph7zvm2x --role=planner << 'EOF'
[progress message]
EOF

# Handoff to user when done
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=jx750h696te75x67z5q6cbwkph7zvm2x --role=planner --next-role=user << 'EOF'
[summary message]
EOF
```

## Process Per Command

1. Create `<command>/deps.ts` with segregated interfaces
2. Modify `<command>/index.ts` to accept deps param (default = real implementations)
3. Write `<command>/index.test.ts` (or `<command>/<handler>.test.ts`) with mock deps
4. Run `npx nx run @workspace/cli:typecheck`
5. Run `npx vitest run` (full suite)
6. Commit

## Migration Order

| # | Command | Status | Notes |
|---|---------|--------|-------|
| 1 | task-started | pending | Core workflow, validation paths, 2 Convex mutations |
| 2 | handoff | pending | Core workflow, artifact validation, ConvexError handling |
| 3 | task-complete | pending | Core workflow, ConvexError handling |
| 4 | report-progress | pending | Similar to task-complete |
| 5 | context | pending | Multiple subcommands (read/new/list/inspect) |
| 6 | backlog | pending | Largest file (728 lines), many subcommands |
| 7 | messages | pending | Medium complexity |
| 8 | artifact | pending | File I/O + API calls |
| 9 | register-agent | pending | Simpler API command |
| 10 | auth-login | pending | Browser auth flow |
| 11 | auth-logout | pending | Trivial |
| 12 | auth-status | pending | Small |
| 13 | guidelines | pending | Small |
| 14 | update | pending | Small |
| 15 | opencode-install | pending | Complex but non-critical |

## Shared Interfaces (already exist in infrastructure/deps/)

- `BackendOps` — Convex client mutation/query
- `ProcessOps` — OS process operations
- `ClockOps` — Time and delays
- `FsOps` — Filesystem access

## New Shared Interface Needed

- `SessionOps` — Session ID retrieval, auth validation (used by nearly every command)

## Reference Pattern

See `commands/machine/daemon-start/deps.ts` for the established pattern.
