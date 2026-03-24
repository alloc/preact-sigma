import { defineManagedState, StateHandle } from "./framework";

const Counter = defineManagedState(
  (count: StateHandle<number>) => ({
    count,
    doubledCount: count.select((count) => count * 2),
    increment() {
      count.set((count) => count + 1);
    },
    decrement() {
      count.set((count) => count - 1);
    },
  }),
  0,
);

const counter = new Counter();
counter.peek();
counter.increment();
counter.subscribe((state) => {});
counter.get("doubledCount").subscribe((value) => {});
