# Persist

## Overview

`preact-sigma/persist` persists and restores committed top-level sigma state without moving storage, scheduling, or migration policy into `Sigma` classes.

The module builds on the core committed-state helpers:

- `sigma.captureState(instance)` reads the current committed snapshot.
- `sigma.replaceState(instance, nextState)` restores a committed snapshot.
- `sigma.subscribe(instance, handler)` observes future committed publishes.

Use the persist module when those primitives are the right boundary, but you do not want each application to reimplement store adapters, partial persistence, restore sequencing, or write scheduling. Exact signatures live in [`dist/persist.d.mts`](../dist/persist.d.mts).

## When to Use

- State should survive reloads, navigation, or app restarts.
- Persistence needs to stay instance-specific instead of becoming part of the model class.
- Storage may be synchronous or asynchronous.
- Stored payloads need versioning, migration, or partial persistence.
- Restore and future persistence should share one small lifecycle helper.

## When Not to Use

- A one-off snapshot or replay flow is enough. Use `sigma.captureState(...)` and `sigma.replaceState(...)` directly.
- The data is really a remote cache, normalization layer, or conflict-resolution problem.
- You need unpublished drafts, computeds, queries, setup resources, or emitted events persisted.
- The model should start side effects before async restore completes. Sequence that explicitly outside `useSigma(...)`.

## Core Pieces

- Instance: a raw `Sigma` instance or a protected consumer view returned by `castProtected(...)` or `useSigma(...)`.
- Store: owns `get`, `set`, and `delete` for persisted records. These names match [Keyv](https://github.com/jaredwray/keyv) and `Map`.
- Codec: owns payload shape, versioning, and migration logic between stored data and a full committed snapshot.
- Pick options: persist selected top-level keys without writing a custom codec.
- Helper: owns restore sequencing, subscription lifecycle, and write scheduling for one sigma instance.

## Common Tasks -> Recommended APIs

- Restore once through an async store: `restore(instance, options)`
- Restore once through a sync store: `restoreSync(instance, options)`
- Persist future committed changes only: `persist(instance, options)`
- Restore first, then persist future changes: `hydrate(instance, options)` or `hydrateSync(instance, options)`
- Persist only selected top-level keys while restoring the full state shape: pass `pick: ["key"]`

## Scheduling and Lifecycle

- Persistence helpers only read and write committed snapshots. Unpublished drafts never reach storage.
- `persist(...)` defaults to `"microtask"` scheduling so multiple same-turn publishes can coalesce into one write.
- `writeInitial` defaults to `false`, which prevents a new binding from overwriting an older record before restore runs.
- `flush()` waits for scheduled or active writes to finish.
- `clear()` removes the stored record and keeps the binding usable for later writes.
- `stop()` unsubscribes the binding, cancels unwritten scheduled state, and waits for any active write to settle.
- `hydrate(...)` starts future persistence only after restore resolves successfully.

## Constraints

- Persistence helpers are trusted external model owners. Restore and hydrate helpers may replace committed state even when they receive a protected consumer view.
- `sigma.replaceState(...)` requires a plain object replacement snapshot. In supported TypeScript usage, pass the class's full `TState` or `Immutable<TState>` shape.
- Custom partial persistence codecs should reconstruct a full replacement snapshot before restore finishes.
- Nested sigma-state values are stored only if the chosen codec and payload format support them explicitly.
- Async restore failures reject through `restore(...)` or the `restored` promise from `hydrate(...)`.
- Background write failures route through `onWriteError(...)` without automatically stopping persistence.

## Example Routes

- [`examples/persist-search-draft.ts`](../examples/persist-search-draft.ts): sync restore-first persistence with `hydrateSync(...)` and `pick`
- [`examples/observe-and-restore.ts`](../examples/observe-and-restore.ts): direct snapshot and restore without the persist subpath
- [`dist/persist.d.mts`](../dist/persist.d.mts): exact exported signatures for the persist module
