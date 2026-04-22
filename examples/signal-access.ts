import { effect, sigma, SigmaType } from "preact-sigma";

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
  console.log(
    sigma.getSignal(counter, "count").value,
    sigma.getSignal(counter, "doubled").value,
  );
});

counter.increment();

stop();
