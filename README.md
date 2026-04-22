# preact-sigma

## Purpose

`preact-sigma` is a typed state-model builder for Preact and TypeScript. It keeps top-level public state reactive, derived reads local to the model, writes explicit through actions, and side effects owned by explicit setup.

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
- Runnable usage patterns live in [`examples/`](./examples/), starting with [`examples/basic-counter.ts`](./examples/basic-counter.ts) for the minimal path and [`examples/command-palette.tsx`](./examples/command-palette.tsx) for a larger end-to-end composition.
- Exact exported signatures live in `dist/index.d.mts` after `pnpm build`.
