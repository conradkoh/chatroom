# Convex transport (v2 daemon)

Shared incremental-sync library for cursor-pinned subscriptions and reconcile snapshots.

## Belongs here

- Thin subscriber modules under `subscribers/` (normalize → `InboundEvent`)
- Thin publisher modules under `publishers/` (`OutboundEvent` → mutations)

## Does not belong here

| Kind                                            | Home instead                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `MessageBuffer`, `subscribe-loop`, feed runtime | `packages/cli/src/infrastructure/incremental-sync/` (reuse)          |
| Domain merge rules                              | `domain/usecase/` or legacy consumer snapshots until migrated        |
| Working snapshot maps                           | Co-locate with subscriber during migration, then fold into use cases |

## Shared library

**Do not duplicate** transport primitives. Import from:

`packages/cli/src/infrastructure/incremental-sync/`

See [incremental-sync README](../../../infrastructure/incremental-sync/README.md) for the canonical dual-channel pattern.

## Naming

- Subscribers: `startXxxSubscriber(deps, onEvent): SubscriberHandle`
- Publishers: `createXxxPublisher(deps): { publish(event: OutboundEvent) }`
