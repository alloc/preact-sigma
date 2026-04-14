# Changelog

All notable changes to this project will be documented in this file.

## v4.0.0

### Breaking Changes

- **Peer Dependencies:** `preact`, `@preact/signals`, and `immer` are now peer dependencies instead of direct dependencies. You must ensure they are installed in your project alongside `preact-sigma`.

## v3.0.0

### Breaking Changes

- **Simplified `SigmaType` Generics:** The internal and public type signatures for `SigmaType` and its related contexts (`ActionContext`, `ReadonlyContext`, etc.) have been refactored to use a single `SigmaDefinition` object instead of multiple individual type parameters.
  - While this is largely an internal refactor to improve maintainability and reduce type complexity, any manual usage of the `SigmaType` or context types in your own code (e.g., `SigmaType<State, Events, ...>`) will need to be updated to the new structure.
  - The `AnySigmaType` utility type no longer takes multiple `any` arguments and is now simplified to `AnySigmaType`.

### Internal Improvements

- **Improved Type Merging:** Incremental builder methods like `.computed()`, `.queries()`, and `.actions()` now use a more robust merging strategy, reducing the risk of type degradation in complex models.
- **Refined `MergeObjects`:** The internal utility for merging state and definition objects is now more reliable when dealing with optional properties.

### Migration Guide

If you are using the `SigmaType` builder pattern (e.g., `new SigmaType<{ count: number }>("Counter")...`), no changes are required to your runtime code.

If you have manually annotated variables or functions with `SigmaType` or its context types, you must update the generic arguments:

**Before:**
```ts
function myHelper(ctx: ActionContext<MyState, MyEvents, MyComputeds, MyQueries, MyActions>) { ... }
```

**After:**
```ts
import { ActionContext, SigmaDefinition } from "preact-sigma";

type MyDefinition = {
  state: MyState;
  events: MyEvents;
  computeds: MyComputeds;
  queries: MyQueries;
  actions: MyActions;
};

function myHelper(ctx: ActionContext<MyDefinition>) { ... }
```
