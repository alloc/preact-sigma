# preact-sigma

## Purpose

`preact-sigma` is a typed state-model builder for Preact and TypeScript. It keeps top-level public state reactive, derived reads local to the model, writes explicit through actions, and side effects owned by explicit setup.

## Installation

```bash
npm install preact-sigma
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
- Quick-start usage lives in [`examples/basic-counter.ts`](./examples/basic-counter.ts).
- An advanced end-to-end example lives in [`examples/command-palette.tsx`](./examples/command-palette.tsx).
- Focused examples for non-obvious APIs live in [`examples/async-commit.ts`](./examples/async-commit.ts), [`examples/observe-and-restore.ts`](./examples/observe-and-restore.ts), [`examples/setup-act.ts`](./examples/setup-act.ts), [`examples/sigma-target.ts`](./examples/sigma-target.ts), and [`examples/signal-access.ts`](./examples/signal-access.ts).
- Exact exported signatures live in `dist/index.d.mts` after `pnpm build`.
