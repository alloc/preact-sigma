# Persist

## Overview

`preact-sigma/persist` persists and restores committed top-level sigma state without moving storage, scheduling, or migration policy into `SigmaType`.

The module builds on the core committed-state helpers:

- `sigma.getState(instance)` reads the current committed snapshot.
- `sigma.replaceState(instance, nextState)` restores a committed snapshot.
- `sigma.subscribe(instance, handler)` observes future committed publishes.

Use the persist module when those primitives are the right boundary, but you do not want each application to reimplement store adapters, partial persistence, restore sequencing, or write scheduling. Exact signatures live in [`dist/persist.d.mts`](../dist/persist.d.mts).

## When to Use

- State should survive reloads, navigation, or app restarts.
- Persistence needs to stay instance-specific instead of becoming part of the model definition.
- Storage may be synchronous or asynchronous.
- Stored payloads need versioning, migration, or partial persistence.
- Restore and future persistence should share one small lifecycle helper.

## When Not to Use

- A one-off snapshot or replay flow is enough. Use `sigma.getState(...)` and `sigma.replaceState(...)` directly.
- The data is really a remote cache, normalization layer, or conflict-resolution problem.
- You need unpublished drafts, computeds, queries, setup resources, or emitted events persisted.
- The model should start side effects before async restore completes. Sequence that explicitly outside `useSigma(...)`.

## Core Pieces

- Store: owns `read`, `write`, and `remove` for persisted records.
- Codec: owns payload shape, versioning, and migration logic between stored data and a full committed snapshot.
- Helper: owns restore sequencing, subscription lifecycle, and write scheduling for one sigma-state instance.

## Common Tasks -> Recommended APIs

- Restore once through an async store: `restoreState(instance, options)`
- Restore once through a sync store: `restoreStateSync(instance, options)`
- Persist future committed changes only: `persistState(instance, options)`
- Restore first, then persist future changes: `bindPersistence(instance, options)` or `bindPersistenceSync(instance, options)`
- Persist only selected top-level keys while restoring the full state shape: `pickStateCodec(keys)`

## Scheduling and Lifecycle

- Persistence helpers only read and write committed snapshots. Unpublished drafts never reach storage.
- `persistState(...)` defaults to `"microtask"` scheduling so multiple same-turn publishes can coalesce into one write.
- `writeInitial` defaults to `false`, which prevents a new binding from overwriting an older record before restore runs.
- `flush()` waits for scheduled or active writes to finish.
- `clear()` removes the stored record and keeps the binding usable for later writes.
- `stop()` unsubscribes the binding and waits for any in-flight write to settle.
- `bindPersistence(...)` starts future persistence only after restore resolves successfully.

## Constraints

- `sigma.replaceState(...)` still requires a plain object with the exact top-level state-key shape.
- Partial persistence codecs must reconstruct a full replacement snapshot before restore finishes.
- Nested sigma-state values are stored only if the chosen codec and payload format support them explicitly.
- Async restore failures reject through `restoreState(...)` or the `restored` promise from `bindPersistence(...)`.
- Background write failures route through `onWriteError(...)` without automatically stopping persistence.

## Example Routes

- [`examples/persist-search-draft.ts`](../examples/persist-search-draft.ts): sync restore-first persistence with `bindPersistenceSync(...)` and `pickStateCodec(...)`
- [`examples/observe-and-restore.ts`](../examples/observe-and-restore.ts): direct snapshot and restore without the persist subpath
- [`dist/persist.d.mts`](../dist/persist.d.mts): exact exported signatures for the persist module
