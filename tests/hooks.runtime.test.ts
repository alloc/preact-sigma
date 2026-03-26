// @vitest-environment jsdom

import { render, type FunctionComponent, h } from "preact";
import { act } from "preact/test-utils";
import { afterEach, assert, test } from "vitest";

import {
  defineManagedState,
  type StateHandle,
  useEventTarget,
  useManagedState,
  useSubscribe,
} from "preact-sigma";

function createContainer() {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

type Subscribable<T> = {
  current: T;
  emit(value: T): void;
  subscribe(listener: (value: T) => void): () => void;
  subscribeCount: number;
  unsubscribeCount: number;
};

function createSubscribable<T>(initialValue: T): Subscribable<T> {
  const listeners = new Set<(value: T) => void>();

  return {
    current: initialValue,
    subscribeCount: 0,
    unsubscribeCount: 0,
    emit(value) {
      this.current = value;
      for (const listener of listeners) {
        listener(value);
      }
    },
    subscribe(listener) {
      this.subscribeCount += 1;
      listeners.add(listener);
      listener(this.current);
      return () => {
        this.unsubscribeCount += 1;
        listeners.delete(listener);
      };
    },
  };
}

test("useManagedState initializes once and disposes on unmount", async () => {
  const container = createContainer();
  let initializations = 0;
  let disposals = 0;
  let manager!: {
    count: number;
    increment(): void;
  };

  const Probe: FunctionComponent = () => {
    manager = useManagedState(
      (count: StateHandle<number>) => {
        count.own(() => {
          disposals += 1;
        });

        return {
          count,
          increment() {
            count.set((value) => value + 1);
          },
        };
      },
      () => {
        initializations += 1;
        return 0;
      },
    );

    return null;
  };

  await act(() => render(h(Probe, {}), container));
  const firstInstance = manager;

  assert.equal(initializations, 1);
  assert.equal(manager.count, 0);

  manager.increment();
  assert.equal(manager.count, 1);

  await act(() => render(h(Probe, {}), container));

  assert.equal(initializations, 1);
  assert.equal(manager, firstInstance);

  await act(() => render(null, container));

  assert.equal(disposals, 1);
});

test("useSubscribe keeps listeners fresh and unsubscribes when disabled", async () => {
  const container = createContainer();
  const observedValues: string[] = [];
  const target = createSubscribable(0);

  const Probe: FunctionComponent<{
    label: string;
    target: Subscribable<number> | null;
  }> = ({ label, target }) => {
    useSubscribe(target, (value) => {
      observedValues.push(`${label}:${value}`);
    });

    return null;
  };

  await act(() => render(h(Probe, { label: "a", target }), container));
  await act(() => render(h(Probe, { label: "b", target }), container));

  target.emit(1);

  await act(() => render(h(Probe, { label: "c", target: null }), container));

  target.emit(2);

  assert.deepEqual(observedValues, ["a:0", "b:1"]);
  assert.equal(target.subscribeCount, 1);
  assert.equal(target.unsubscribeCount, 1);
});

test("useEventTarget supports DOM event targets", async () => {
  const container = createContainer();
  const observedValues: string[] = [];

  const Probe: FunctionComponent<{
    label: string;
    target: EventTarget | null;
  }> = ({ label, target }) => {
    useEventTarget(target, "ping", (event: Event) => {
      observedValues.push(`${label}:${(event as CustomEvent<number>).detail}`);
    });

    return null;
  };

  await act(() => render(h(Probe, { label: "a", target: window }), container));
  window.dispatchEvent(new CustomEvent("ping", { detail: 1 }));

  await act(() => render(h(Probe, { label: "b", target: window }), container));
  window.dispatchEvent(new CustomEvent("ping", { detail: 2 }));

  await act(() => render(h(Probe, { label: "c", target: null }), container));
  window.dispatchEvent(new CustomEvent("ping", { detail: 3 }));

  assert.deepEqual(observedValues, ["a:1", "b:2"]);
});

test("useEventTarget supports managed-state events", async () => {
  const container = createContainer();
  type CounterEvents = {
    thresholdReached: [{ count: number }];
  };

  const CounterManager = defineManagedState(
    (count: StateHandle<number, CounterEvents>) => ({
      increment() {
        count.set((value) => value + 1);
        count.emit("thresholdReached", { count: count.get() });
      },
    }),
    0,
  );

  const counter = new CounterManager();
  const observedCounts: string[] = [];

  const Probe: FunctionComponent<{
    label: string;
    target: InstanceType<typeof CounterManager> | null;
  }> = ({ label, target }) => {
    useEventTarget(target, "thresholdReached", (event) => {
      observedCounts.push(`${label}:${event.count}`);
    });

    return null;
  };

  await act(() => render(h(Probe, { label: "a", target: counter }), container));
  counter.increment();

  await act(() => render(h(Probe, { label: "b", target: counter }), container));
  counter.increment();

  await act(() => render(h(Probe, { label: "c", target: null }), container));
  counter.increment();

  assert.deepEqual(observedCounts, ["a:1", "b:2"]);
});
