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

| # | Command | Status | Tests |
|---|---------|--------|-------|
| 1 | task-started | done | 8 tests |
| 2 | handoff | done | 5 tests |
| 3 | task-complete | done | 6 tests |
| 4 | report-progress | done | 4 tests |
| 5 | context | done | 7 tests |
| 6 | backlog | done | 9 tests |
| 7 | messages | done | 6 tests |
| 8 | artifact | done | 9 tests |
| 9 | register-agent | done | 6 tests |
| 10 | auth-login | done | deps only (browser auth hard to test) |
| 11 | auth-logout | done | 3 tests |
| 12 | auth-status | done | 5 tests |
| 13 | guidelines | done | 7 tests |
| 14 | update | done | 5 tests |
| 15 | opencode-install | done | 4 tests |

## Shared Interfaces (already exist in infrastructure/deps/)

- `BackendOps` — Convex client mutation/query
- `ProcessOps` — OS process operations
- `ClockOps` — Time and delays
- `FsOps` — Filesystem access

## New Shared Interface Needed

- `SessionOps` — Session ID retrieval, auth validation (used by nearly every command)

## Reference Pattern

See `commands/machine/daemon-start/deps.ts` for the established pattern.
