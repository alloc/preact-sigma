# preact-sigma

## Purpose

`preact-sigma` is a typed state-model builder for Preact and TypeScript. It keeps top-level public state reactive, derived reads local to the model, writes explicit through actions, and side effects owned by explicit setup. Optional committed-state persistence helpers live in the `preact-sigma/persist` subpath.

## Installation

```bash
npm install preact-sigma @preact/signals immer preact
```

## Quick Example

```ts
import { SigmaType } from "preact-sigma";

const Counter = new SigmaType<{ count: number }>("Counter")
  .defaultState({
    count: 0,
  })
  .computed({
    doubled() {
      return this.count * 2;
    },
  })
  .actions({
    increment() {
      this.count += 1;
    },
  });

const counter = new Counter();

counter.increment();

console.log(counter.count); // 1
console.log(counter.doubled); // 2
```

## Documentation Map

- Concepts, lifecycle, invariants, and API selection live in [`docs/context.md`](./docs/context.md).
- Persistence-specific guidance lives in [`docs/persistence-helpers-design.md`](./docs/persistence-helpers-design.md).
- Runnable usage patterns live in [`examples/`](./examples/), starting with [`examples/basic-counter.ts`](./examples/basic-counter.ts), [`examples/persist-search-draft.ts`](./examples/persist-search-draft.ts), and [`examples/command-palette.tsx`](./examples/command-palette.tsx).
- Exact exported signatures live in [`dist/index.d.mts`](./dist/index.d.mts) and [`dist/persist.d.mts`](./dist/persist.d.mts) after `pnpm build`.
