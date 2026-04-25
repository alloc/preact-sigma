# preact-sigma

## Purpose

`preact-sigma` is a typed state-model layer for Preact and TypeScript. It keeps top-level public state reactive, derived reads local to the model, writes explicit through class actions, and side effects owned by explicit setup.

## Installation

```bash
npm install preact-sigma @preact/signals immer preact
```

## Quick Example

```ts
import { Sigma } from "preact-sigma";

type CounterState = { count: number };

class Counter extends Sigma<CounterState> {
  constructor() {
    super({
      count: 0,
    });
  }

  get doubled() {
    return this.count * 2;
  }

  increment() {
    this.count += 1;
  }
}

interface Counter extends CounterState {}

const counter = new Counter();

counter.increment();

console.log(counter.count); // 1
console.log(counter.doubled); // 2
```

## Documentation Map

- Concepts, lifecycle, invariants, and API selection live in [`docs/context.md`](./docs/context.md).
- Persistence-specific guidance lives in [`docs/persist.md`](./docs/persist.md).
- Migration guidance from v5 lives in [`docs/migrations/v5-to-v6.md`](./docs/migrations/v5-to-v6.md).
- Runnable usage patterns live in [`examples/`](./examples/), starting with [`examples/basic-counter.ts`](./examples/basic-counter.ts) and [`examples/command-palette.tsx`](./examples/command-palette.tsx).
- Exact exported signatures and public API comments live in `dist/index.d.mts` and `dist/persist.d.mts` after `pnpm build`.
