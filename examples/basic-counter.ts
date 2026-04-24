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
