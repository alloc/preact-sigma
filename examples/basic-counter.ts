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
