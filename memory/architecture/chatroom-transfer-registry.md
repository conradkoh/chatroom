---
type: best-practice
title: Chatroom transfer registry invariants
description: Every chatroom-keyed table must be classified in CHATROOM_SCOPED_TABLES, the schema predicate that finds it, the shared families, and the spec that enforces the decision.
tags: [chatroom, export, import, registry, convex]
status: stable
---

# Chatroom transfer registry invariants

## Registry rule

- A new chatroom-keyed table must be classified in `CHATROOM_SCOPED_TABLES` at
  `services/backend/src/domain/usecase/chatroom-transfer/registry.ts`, either individually or as a
  member of a family in `CHATROOM_SCOPED_FAMILIES`.
- Classification is one of `exported`, `rebuilt` or `excluded`, each with a reason. An exported
  table also declares its fields: `copy`, `ref`, `reset`, `rebind`, `derive`, `system` or `drop`,
  with a note for every non-copy rule.
- Every exported table and every table the import writes carries a rollback descriptor, so a
  failed import deletes its rows by chatroom id without scanning.
- The registry also feeds `omittedManifest()`, the export's own list of what it did not carry. The
  reason strings are the user-facing wording, so changing a reason changes the export's output.
- The public guide is [docs/features/chatroom-export-import.md](../../docs/features/chatroom-export-import.md).

## The predicate

`services/backend/src/domain/usecase/chatroom-transfer/registry.spec.ts` walks the real
`convex/schema.ts` and selects a table as chatroom-keyed when its top-level fields (including every
union member) contain any of:

- `chatroomId`;
- `workspaceId`;
- `machineId` together with `workingDir`.

Every selected table must be covered by a `CHATROOM_SCOPED_TABLES` key or a family member. The spec
also runs every read and rollback `(table, index)` descriptor against an empty `convex-test`
database, so a typo in an index name fails instead of silently reading nothing.

## Families

Families group tables that share one decision and one `omittedManifest` key:

- `workspace_caches` — rebuilt by the target daemon, keyed by `machine+workingDir`.
- `workspace_requests` — in-flight source-daemon requests, keyed by `machine+workingDir`.
- `command_runner` — machine-local command runner state, keyed by `machine+workingDir`.

A fourth family, `agentic_query_history`, is keyed by `parent-id` and records the disclosed gap
that user search/ask history is not carried.

## Failure messages

The spec names the decision that is missing, so the fix is local to the registry:

- `unclassified chatroom-keyed table: <names>` — the coverage predicate matched a table with no
  decision.
- `missing field rule for <table>.<field>`, `rule names unknown field <table>.<field>` — an
  exported table's `fields` map drifted from the schema.
- `missing rule for id field <table>.<path>`, `<table>.<path> is an id but its rule is <rule>` — a
  new `v.id()` field needs a `ref`, `system` or `drop` decision.
- `<table>.<field> refs <target>` — a `ref` rule names a table that is not exported.
- `<name> needs rebuiltBy`, `<name> needs a reason` — a rebuilt entry or family lacks its
  justification.
- `omittedManifest is missing <name>`, `omittedManifest reason for <name>` — an exclusion or
  counted category is absent from the manifest.
- `missing rollback for exported table <name>`, `rollback for <name>` — a rollback descriptor is
  missing or its `(table, index)` pair does not exist.
