# `framework.ts` Review

## Findings

### 1. Composed managed states are typed as signal-addressable, but `get`/`peek`/`subscribe(key)` only work for signal-backed props

- `InferState<TProps>` includes composed managed states via `Readonly<InferManagedStates<TProps>>`, so the public type says `dashboard.get("child")`, `dashboard.peek("child")`, and `dashboard.subscribe("child", ...)` are valid. See [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L70) and [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L83).
- At runtime, `StateContainer` only records entries in `_signals` for exposed signals, top-level lenses, and the base-state handle. Managed-state properties are exposed as plain values and never added to `_signals`. See [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L266) and [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L282).
- I validated this directly: `get("child")` and `peek("child")` return `undefined`, and `subscribe("child", ...)` throws `Property child is not a signal`.

Concern: this is a public API mismatch, not just an internal edge case.

### 2. `query()` does not preserve the method receiver

- `query()` wraps the supplied function as `computed(() => fn(...args)).value`, which calls `fn` without its original `this`. See [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L129).
- A query method written with `function () { return this.count; }` returns `undefined` instead of reading from the instance. I confirmed that behavior with a small runtime check.

Concern: the exported type accepts any function shape, but the implementation only behaves correctly for closure-based queries that do not depend on `this`.

### 3. `initialState` is not tied to the inferred `TState`

- `defineManagedState()` and `useManagedState()` introduce a separate `TInitialState` generic, but never constrain it to `TState`. See [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L237) and [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L484).
- The implementation then casts `initialState` to `Immutable<TState>` when creating the signal. See [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L251).

Concern: the constructor parameter is the source of state inference, but the second argument can drift from that inferred state type and still be accepted by the signature.

### 4. The subscription docs say "future" values, but listeners receive the current value immediately

- `AnyManagedState.subscribe` is documented as "Subscribe to future immutable state snapshots". See [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L90).
- In practice, `signal.subscribe(...)` fires immediately with the current value. The runtime tests already rely on that behavior for `subscribe("query", ...)`.
- `useSubscribe()` repeats the same "future values" framing. See [framework.ts](/Users/alec/dev/sandbox/immer-test/framework.ts#L513).

Concern: this is public API documentation drift. The current wording will cause incorrect caller expectations.

## Questions

1. For composed managed states, do you want keyed `get`/`peek`/`subscribe` to support them, or should the public types/docs narrow those APIs to signal-backed properties only?
2. For `query()`, do you want to officially require closure-based functions, or should the wrapper preserve `this` so method-style queries work too?

## Notes

- `npm test` passes as-is.
