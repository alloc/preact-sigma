import { effect, SigmaType } from "preact-sigma";

const Counter = new SigmaType<{
  count: number;
}>("Counter")
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

const stop = effect(() => {
  console.log(counter.get("count").value, counter.get("doubled").value);
});

counter.increment();

stop();
