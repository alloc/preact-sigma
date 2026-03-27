// @ts-nocheck
// @vitest-environment jsdom

import { render, type FunctionComponent, h } from "preact";
import { act } from "preact/test-utils";
import { afterEach, assert, test } from "vitest";

import { SigmaType, useListener, useSigma } from "preact-sigma";

function createContainer() {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("useSigmaState initializes once, runs setup, and cleans up on unmount", async () => {
  const container = createContainer();
  let setupCount = 0;
  let cleanupCount = 0;
  let state!: {
    count: number;
    increment(): void;
  };

  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .setup(function () {
      setupCount += 1;
      return [
        () => {
          cleanupCount += 1;
        },
      ];
    })
    .actions({
      increment() {
        this.count += 1;
      },
    });

  const Probe: FunctionComponent<{ id: string }> = () => {
    state = useSigma(() => new Counter(), []);
    return null;
  };

  await act(() => render(h(Probe, { id: "a" }), container));
  const firstState = state;

  state.increment();
  assert.equal(state.count, 1);
  assert.equal(setupCount, 1);

  await act(() => render(h(Probe, { id: "b" }), container));

  assert.equal(state, firstState);

  await act(() => render(null, container));

  assert.equal(cleanupCount, 1);
});

test("useListener keeps the latest callback", async () => {
  const container = createContainer();
  const observed: string[] = [];

  const Probe: FunctionComponent<{ label: string; target: EventTarget | null }> = ({
    label,
    target,
  }) => {
    useListener(target, "sigma-v2-ping", (event: Event) => {
      observed.push(`${label}:${(event as CustomEvent<number>).detail}`);
    });
    return null;
  };

  await act(() => render(h(Probe, { label: "a", target: window }), container));
  window.dispatchEvent(new CustomEvent("sigma-v2-ping", { detail: 1 }));

  await act(() => render(h(Probe, { label: "b", target: window }), container));
  window.dispatchEvent(new CustomEvent("sigma-v2-ping", { detail: 2 }));

  await act(() => render(h(Probe, { label: "c", target: null }), container));
  window.dispatchEvent(new CustomEvent("sigma-v2-ping", { detail: 3 }));

  assert.deepEqual(observed, ["a:1", "b:2"]);
});
