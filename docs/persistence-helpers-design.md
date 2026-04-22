# Persistence Helpers Design

Status: draft

## Overview

This document proposes an optional set of persistence helpers for `preact-sigma`.

The helpers persist and restore committed sigma-state snapshots without making `SigmaType` declarations aware of storage, hydration, versioning, or migration concerns.

The design builds on the existing instance-level seams that already exist in the library:

- `new SomeSigma(initialState)` creates an instance with optional initial overrides.
- `sigma.getState(instance)` reads committed top-level public state.
- `sigma.replaceState(instance, nextState)` restores committed top-level public state.
- `sigma.subscribe(instance, handler)` observes future committed state changes.

Persistence stays outside the sigma-type builder. A sigma type continues to describe state shape, derived reads, actions, events, and setup only.

## Context

`preact-sigma` already supports manual observe-and-restore flows. Consumers can snapshot committed state with `sigma.getState(...)`, store it elsewhere, and later restore it with `sigma.replaceState(...)`.

That manual pattern is sufficient for one-off use, but it leaves several recurring concerns to each application:

- storage adapter shape
- restore timing
- write scheduling
- versioned stored payloads
- partial persistence
- migrations
- write error handling

The library should offer a small persistence layer for those repeated concerns without moving them into `SigmaType`.

## Goals

- Persist committed top-level public state for any sigma-state instance.
- Restore persisted state through existing committed-state APIs.
- Keep `SigmaType` free of persistence and hydration responsibilities.
- Support both synchronous and asynchronous storage adapters.
- Support versioned stored payloads and migrations.
- Support partial persistence while preserving the full-shape requirement of `sigma.replaceState(...)`.
- Keep the API small enough that applications can understand the full lifecycle locally.

## Non-Goals

- No `.persist(...)`, `.hydrate(...)`, or similar builder methods on `SigmaType`.
- No persistence of computeds, queries, actions, setup resources, events, or signals.
- No persistence of unpublished drafts.
- No patch-log, event-sourcing, or operation-replay design in the initial slice.
- No change to `useSigma(...)` in the initial slice.
- No cross-tab synchronization or remote conflict resolution in the initial slice.

## Assumptions And Constraints

- Sigma only tracks top-level public state keys.
- `sigma.getState(...)` returns the committed public state snapshot.
- `sigma.replaceState(...)` requires a plain object with the exact top-level state-key shape.
- `sigma.replaceState(...)` throws when an async action still owns unpublished changes.
- Persistence should compose entirely through public APIs that already exist or can be added as optional helpers.
- Stored data may be malformed, stale, or produced by an older application version.

## Terminology

- Sigma state: a live instance created from a configured sigma type.
- Committed snapshot: the object returned by `sigma.getState(instance)`.
- Store: a user-provided adapter that reads, writes, and removes persisted records.
- Codec: a user-provided adapter that converts between in-memory state and stored payloads.
- Restore: reading stored data, decoding it, and applying it to a live instance.
- Persist: subscribing to future committed state changes and writing stored records.
- Partial persistence: storing only a subset of top-level state keys while reconstructing a full restore snapshot during decode.

## Proposed Design

### Package Boundary

Persistence ships as an optional subpath export:

```ts
import {
  bindPersistence,
  persistState,
  restoreState,
  restoreStateSync,
  pickStateCodec,
} from "preact-sigma/persist";
```

The helpers operate on sigma-state instances. They do not modify `SigmaType`, `Sigma`, or the core runtime contract.

### Design Model

The persistence model has three parts:

1. A store adapter owns I/O.
2. A codec owns payload shape, versioning, and migrations.
3. Helper functions connect a live sigma-state instance to that store and codec.

The default mental model is:

1. Create a sigma-state instance.
2. Restore persisted state into that instance when desired.
3. Subscribe to future committed changes and persist them.

### Why The Design Uses Instance Helpers

Persistence policy is environmental. It depends on storage backends, schema lifetimes, user sessions, quota behavior, and product-level decisions about what should survive reloads.

Those are application concerns, not model-definition concerns.

Keeping persistence at the instance boundary has these properties:

- sigma types remain reusable across environments
- tests can exercise persistence independently from model construction
- the design reuses the existing committed-state contract
- partial persistence and migrations stay local to codecs

## API Specification

### Shared Types

```ts
import type { SigmaState } from "preact-sigma";

type MaybePromise<T> = T | Promise<T>;

type StateOf<T extends SigmaState<any>> =
  T extends SigmaState<infer TDefinition> ? TDefinition["state"] : never;

export interface PersistRecord<TStored = unknown> {
  version: number;
  savedAt: number;
  value: TStored;
}

export interface PersistStore<TRecord> {
  read(key: string): MaybePromise<TRecord | undefined>;
  write(key: string, record: TRecord): MaybePromise<void>;
  remove(key: string): MaybePromise<void>;
}

export interface SyncPersistStore<TRecord> extends PersistStore<TRecord> {
  read(key: string): TRecord | undefined;
  write(key: string, record: TRecord): void;
  remove(key: string): void;
}

export interface PersistCodec<TState extends object, TStored = TState> {
  version: number;
  encode(state: Readonly<TState>): TStored;
  decode(
    stored: unknown,
    context: {
      key: string;
      storedVersion: number;
      baseState: Readonly<TState>;
    },
  ): TState;
}

export type PersistSchedule =
  | "immediate"
  | "microtask"
  | { debounceMs: number };

export interface PersistOptions<
  T extends SigmaState<any>,
  TStored = StateOf<T>,
> {
  key: string;
  store: PersistStore<PersistRecord<TStored>>;
  codec?: PersistCodec<StateOf<T>, TStored>;
  schedule?: PersistSchedule;
  writeInitial?: boolean;
  onWriteError?: (
    error: unknown,
    context: {
      instance: T;
      key: string;
    },
  ) => void;
}

export interface SyncPersistOptions<
  T extends SigmaState<any>,
  TStored = StateOf<T>,
> extends PersistOptions<T, TStored> {
  store: SyncPersistStore<PersistRecord<TStored>>;
}

export type RestoreResult =
  | { status: "missing" }
  | {
      status: "restored";
      savedAt: number;
      storedVersion: number;
    };

export interface PersistenceHandle {
  flush(): Promise<void>;
  clear(): Promise<void>;
  stop(): Promise<void>;
}
```

### `restoreState(instance, options)`

```ts
export function restoreState<T extends SigmaState<any>>(
  instance: T,
  options: PersistOptions<T>,
): Promise<RestoreResult>;
```

Purpose:

- Read one persisted record.
- Decode it against the current in-memory base state.
- Restore the resulting full snapshot with `sigma.replaceState(...)`.

Inputs:

- a live sigma-state instance
- a persistence key
- a store adapter
- an optional codec

Outputs:

- `{ status: "missing" }` when no record exists for the key
- `{ status: "restored", savedAt, storedVersion }` when restore succeeds

Defaults:

- when `codec` is omitted, the helper uses an identity codec with `version: 1`

Failure behavior:

- read failures reject the returned promise
- decode failures reject the returned promise
- `sigma.replaceState(...)` failures reject the returned promise unchanged

Compatibility expectations:

- the store record version is the codec version that produced the stored payload
- codecs are responsible for supporting older stored versions when desired

### `restoreStateSync(instance, options)`

```ts
export function restoreStateSync<T extends SigmaState<any>>(
  instance: T,
  options: SyncPersistOptions<T>,
): RestoreResult;
```

Purpose:

- perform the same restore flow as `restoreState(...)` without async boundaries

Primary use case:

- `localStorage`-style restoration before component effects or setup should run

### `persistState(instance, options)`

```ts
export function persistState<T extends SigmaState<any>>(
  instance: T,
  options: PersistOptions<T>,
): PersistenceHandle;
```

Purpose:

- subscribe to future committed state changes and write persisted records

Inputs:

- a live sigma-state instance
- a persistence key
- a store adapter
- an optional codec
- optional write scheduling controls

Defaults:

- `schedule` defaults to `"microtask"`
- `writeInitial` defaults to `false`

Guarantees:

- writes only observe committed state
- unpublished drafts are never persisted
- multiple commits may coalesce into one write of the latest committed snapshot
- `stop()` prevents future writes from that binding

Failure behavior:

- invalid setup errors throw immediately when the helper is created
- later write failures do not throw through action execution
- later write failures call `onWriteError(...)` when provided

### `bindPersistence(instance, options)`

```ts
export interface BoundPersistence extends PersistenceHandle {
  readonly restored: Promise<RestoreResult>;
}

export interface SyncBoundPersistence extends PersistenceHandle {
  readonly restored: RestoreResult;
}

export function bindPersistence<T extends SigmaState<any>>(
  instance: T,
  options: PersistOptions<T>,
): BoundPersistence;

export function bindPersistenceSync<T extends SigmaState<any>>(
  instance: T,
  options: SyncPersistOptions<T>,
): SyncBoundPersistence;
```

Purpose:

- provide one convenience entry point for the common sequence of restore first, then persist future changes

Semantics:

- restore runs first
- persistence subscription starts only after restore resolves to `missing` or `restored`
- `writeInitial: true` writes the post-restore committed snapshot once after binding becomes active
- if restore fails, no persistence subscription is left running

Rationale:

- most callers want restore and future persistence together
- the convenience helper can be layered on top of `restoreState(...)` and `persistState(...)`

### `pickStateCodec(keys)`

```ts
export function pickStateCodec<
  TState extends object,
  TKey extends keyof TState,
>(keys: readonly TKey[]): PersistCodec<TState, Pick<TState, TKey>>;
```

Purpose:

- support partial persistence of selected top-level state keys

Encode behavior:

- store only the requested keys

Decode behavior:

- merge the stored subset onto `baseState`
- return a full plain-object snapshot that satisfies `sigma.replaceState(...)`

This helper is important because `sigma.replaceState(...)` intentionally requires the full top-level state shape.

## Behavioral Semantics

### Restore Order Of Operations

For `restoreState(...)` and `restoreStateSync(...)`, the helper performs these steps in order:

1. Read the record from `store.read(key)`.
2. If no record exists, return `{ status: "missing" }`.
3. Capture `baseState` from `sigma.getState(instance)`.
4. Decode `record.value` through the codec using `record.version` and `baseState`.
5. Apply the returned full snapshot with `sigma.replaceState(instance, nextState)`.
6. Return `{ status: "restored", savedAt, storedVersion }`.

Important semantics:

- `baseState` is captured after the instance already exists, so constructor overrides and default-state initializers are visible to decode.
- codecs may use `baseState` to fill newly added state keys or reconstruct omitted keys.
- restore operates on committed state only.
- restore inherits the current `sigma.replaceState(...)` guardrails and error model.

### Persist Order Of Operations

For `persistState(...)`, the helper performs these steps:

1. Register `sigma.subscribe(instance, handler)`.
2. On each committed change, cache the latest committed snapshot.
3. Schedule a write according to `schedule`.
4. When the scheduled write runs, encode the latest cached snapshot.
5. Write `{ version, savedAt, value }` through `store.write(key, record)`.

Important semantics:

- scheduled writes coalesce; only the latest cached committed snapshot is written
- `savedAt` is the time the write payload is constructed, not the time of the original action
- writes use committed snapshots only and never depend on patch payloads
- patch support in `sigma.subscribe(...)` is irrelevant to the persistence contract in the initial slice

### `writeInitial`

When `writeInitial` is `true`, the helper schedules one write of the current committed snapshot after the persistence binding becomes active.

For `bindPersistence(...)` and `bindPersistenceSync(...)`, that means after restore completes.

For `persistState(...)`, that means after subscription setup.

`writeInitial` defaults to `false` so attaching persistence does not immediately overwrite an older stored record before an explicit restore step runs.

### Scheduling Semantics

- `"immediate"` starts a write as soon as a change is observed.
- `"microtask"` queues one microtask and coalesces all changes observed before it runs.
- `{ debounceMs }` waits for inactivity before writing the latest observed committed snapshot.

If a write is already in flight and another committed change arrives:

- the helper records the latest snapshot
- at most one follow-up write is queued after the current write settles

The design intentionally does not guarantee persistence of every intermediate committed snapshot.

### Cleanup Semantics

`PersistenceHandle` methods behave as follows:

- `flush()` writes the latest pending committed snapshot immediately and resolves when that write settles
- `clear()` cancels any scheduled write that has not started yet, removes the stored record, and keeps the binding active for future changes
- `stop()` unsubscribes from sigma changes, cancels any not-yet-started scheduled write, and waits for an in-flight write to settle

`stop()` is idempotent.

### Interaction With Setup

If restored state affects setup-owned resources, restore should run before `instance.setup(...)`.

For synchronous stores, `restoreStateSync(...)` and `bindPersistenceSync(...)` support that directly.

For asynchronous stores, the initial slice does not make `useSigma(...)` persistence-aware. Applications that need async restored state before setup should manage that sequencing outside `useSigma(...)`.

This is a deliberate scope boundary rather than implicit behavior.

## Architecture And Data Flow

### Main Restore Path

```text
app -> sigma instance -> store.read(key)
    -> codec.decode(value, { storedVersion, baseState })
    -> sigma.replaceState(instance, nextState)
    -> restored committed state
```

### Main Persist Path

```text
sigma action -> committed publish -> sigma.subscribe(instance, handler)
             -> latest snapshot cache
             -> scheduled flush
             -> codec.encode(snapshot)
             -> store.write(key, record)
```

### State Ownership

- The sigma instance owns live reactive state.
- The store owns serialized persistence records.
- The codec owns schema translation across versions.
- The persistence helper owns subscription lifecycle, scheduling, and error routing.

## Examples

### Full-State Persistence With `localStorage`

```ts
import { SigmaType } from "preact-sigma";
import { bindPersistenceSync, type SyncPersistStore } from "preact-sigma/persist";

const localStorageStore: SyncPersistStore<any> = {
  read(key) {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : undefined;
  },
  write(key, record) {
    localStorage.setItem(key, JSON.stringify(record));
  },
  remove(key) {
    localStorage.removeItem(key);
  },
};

const Search = new SigmaType<{
  draft: string;
  page: number;
}>()
  .defaultState({
    draft: "",
    page: 1,
  })
  .actions({
    setDraft(draft: string) {
      this.draft = draft;
    },
  });

const search = new Search();

const persistence = bindPersistenceSync(search, {
  key: "search",
  store: localStorageStore,
});

void persistence;
```

### Partial Persistence For Selected Keys

```ts
import { bindPersistenceSync, pickStateCodec } from "preact-sigma/persist";

const search = new Search();

bindPersistenceSync(search, {
  key: "search",
  store: localStorageStore,
  codec: pickStateCodec(["draft"]),
});
```

If `page` was added later or should remain session-only, the codec restores a full snapshot by merging the stored `draft` value onto the current base state.

### Versioned Migration

```ts
const codec = {
  version: 2,
  encode(state: { draft: string; page: number }) {
    return {
      query: state.draft,
    };
  },
  decode(
    stored: unknown,
    context: {
      storedVersion: number;
      baseState: { draft: string; page: number };
      key: string;
    },
  ) {
    if (context.storedVersion === 1) {
      const value = stored as { draft?: string };
      return {
        ...context.baseState,
        draft: value.draft ?? "",
      };
    }

    const value = stored as { query?: string };
    return {
      ...context.baseState,
      draft: value.query ?? "",
    };
  },
} satisfies PersistCodec<{ draft: string; page: number }, { query: string }>;
```

## Alternatives And Tradeoffs

### Add Persistence To `SigmaType`

Rejected.

That approach couples model declarations to environmental concerns such as storage backends, key naming, retention policy, and schema lifetimes. It also makes reusable model definitions harder to share across applications and test environments.

### Add Persistence Methods To The Core `sigma` Helper

Rejected for the initial slice.

The behavior is optional and may pull in browser- or app-specific adapter code. A subpath export keeps the core entry point focused on runtime state semantics.

### Persist Immer Patches Instead Of Snapshots

Rejected for the initial slice.

Patch persistence introduces replay ordering, compaction, recovery, and migration complexity. Snapshot persistence is simpler and already aligned with `sigma.getState(...)` and `sigma.replaceState(...)`.

### Expose Only `persistState(...)` And `restoreState(...)`

Partially rejected.

Those two helpers are the real primitives, but `bindPersistence(...)` is worth including because restore-then-persist is the most common application path and the convenience wrapper does not require new semantics.

## Failure Modes And Edge Cases

- Missing record: restore returns `{ status: "missing" }`.
- Malformed stored payload: codec decode throws and restore fails.
- Unsupported stored version: codec decode throws and restore fails.
- Store read failure: restore fails.
- Store write failure: persistence remains subscribed and routes the error through `onWriteError(...)`.
- Store remove failure during `clear()`: `clear()` rejects.
- Async action with unpublished changes during restore: `sigma.replaceState(...)` throws unchanged.
- Partial persistence without a codec that reconstructs missing keys: restore fails the exact-shape validation in `sigma.replaceState(...)`.
- Nested sigma-state values in top-level state: persistence behavior depends on the chosen codec and stored representation; the initial design does not define automatic recursive persistence.

## Testing And Observability

### Runtime Tests

Add focused runtime tests for:

- missing-record restore
- successful full-state restore
- successful partial restore via `pickStateCodec(...)`
- versioned migration through a custom codec
- coalesced writes for microtask scheduling
- debounce scheduling
- `writeInitial` behavior
- `clear()` behavior while the binding remains active
- `stop()` behavior with queued and in-flight writes
- unchanged propagation of `sigma.replaceState(...)` errors

### Type Tests

Add type tests for:

- state inference through `PersistOptions<T>`
- `pickStateCodec(keys)` key inference
- sync-store requirements for `restoreStateSync(...)` and `bindPersistenceSync(...)`

### Observability

The initial slice should not add logging or metrics hooks to the public API.

Applications that need observability can instrument their store adapter and error callbacks.

## Rollout And Migration

Implementation can land as an additive feature with no migration pressure on existing sigma users.

Suggested implementation order:

1. Add the `preact-sigma/persist` subpath and store or codec types.
2. Implement `restoreState(...)` and `restoreStateSync(...)`.
3. Implement `persistState(...)` and `PersistenceHandle`.
4. Add `bindPersistence(...)` and `bindPersistenceSync(...)` as thin composition helpers.
5. Add docs examples for synchronous local persistence and partial persistence.

Rollback is simple because the feature is isolated to an optional subpath.

## Open Questions

- Should the library ship first-party `localStorage` or IndexedDB store adapters, or keep adapters fully user-land in the initial release?
- Should `bindPersistence(...)` swallow restore errors behind a callback option, or should restore remain an explicit promise the caller must observe?
- Should the default codec include a runtime plain-object check before `sigma.replaceState(...)`, or should shape validation stay entirely delegated to the existing runtime guardrails?

## Ambiguities And Blockers

- AB-1 - Non-blocking - Async restore before automatic setup in components
  - Affected area: Preact integration
  - Issue: `useSigma(...)` automatically runs setup for sigma states that define it, but async persistence restore may need to happen first.
  - Why it matters: setup-owned resources may start with default state instead of restored state.
  - Next step: keep async component hydration out of the initial slice and revisit a dedicated `usePersistedSigma(...)` helper only if real usage demands it.

- AB-2 - Non-blocking - First-party adapter scope
  - Affected area: Package surface
  - Issue: The design does not yet decide whether browser storage adapters should ship with the library.
  - Why it matters: shipping adapters increases convenience but also expands surface area and environment assumptions.
  - Next step: start with interface types and helper functions only.

- AB-3 - Non-blocking - Default scheduling policy
  - Affected area: Persist runtime semantics
  - Issue: `"microtask"` is the proposed default write schedule, but applications may prefer immediate durability or explicit debouncing.
  - Why it matters: the default affects write volume and timing expectations.
  - Next step: keep `"microtask"` as the proposed default unless early implementation feedback shows surprising behavior.