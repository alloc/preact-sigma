import { defineManagedState, StateHandle } from "./framework";

function getDoubledCount(count: number) {
  return count * 2;
}

const Counter = defineManagedState(
  (count: StateHandle<number>) => ({
    count,
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
getDoubledCount(counter.count);
counter.subscribe((state) => {});
counter.get("count").subscribe((value) => {});
