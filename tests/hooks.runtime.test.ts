// @vitest-environment jsdom

import { render, type FunctionComponent, h } from "preact";
import { act } from "preact/test-utils";
import { afterEach, assert, test } from "vitest";

import {
  Sigma,
  SigmaTarget,
  useListener,
  useSigma,
  useSigmaSync,
  type Protected,
} from "preact-sigma";

function createContainer() {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("useSigma initializes once, runs setup, and cleans up on unmount", async () => {
  const container = createContainer();
  let setupCount = 0;
  let cleanupCount = 0;
  let state!: Protected<Counter>;

  class Counter extends Sigma<{ count: number }> {
    declare count: number;

    constructor() {
      super({ count: 0 });
    }

    onSetup() {
      setupCount += 1;
      return [
        () => {
          cleanupCount += 1;
        },
      ];
    }

    increment() {
      this.count += 1;
    }
  }

  const Probe: FunctionComponent<{ id: string }> = () => {
    state = useSigma(() => new Counter());
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

test("useSigma reruns setup when setup args change and cleans up the previous run", async () => {
  const container = createContainer();
  const events: string[] = [];
  let state!: Protected<Counter>;

  class Counter extends Sigma<{ count: number }> {
    declare count: number;

    constructor() {
      super({ count: 0 });
    }

    onSetup(label: string) {
      events.push(`setup:${label}`);
      return [
        () => {
          events.push(`cleanup:${label}`);
        },
      ];
    }
  }

  const Probe: FunctionComponent<{ label: string }> = ({ label }) => {
    state = useSigma(() => new Counter(), { setup: [label] });
    return null;
  };

  await act(() => render(h(Probe, { label: "a" }), container));
  const firstState = state;

  await act(() => render(h(Probe, { label: "b" }), container));

  assert.equal(state, firstState);
  assert.deepEqual(events, ["setup:a", "cleanup:a", "setup:b"]);

  await act(() => render(null, container));

  assert.deepEqual(events, ["setup:a", "cleanup:a", "setup:b", "cleanup:b"]);
});

test("useListener keeps the latest callback", async () => {
  const container = createContainer();
  const observed: string[] = [];

  const Probe: FunctionComponent<{ label: string; target: EventTarget | null }> = ({
    label,
    target,
  }) => {
    useListener(target, "sigma-v6-ping", (event: Event) => {
      observed.push(`${label}:${(event as CustomEvent<number>).detail}`);
    });
    return null;
  };

  await act(() => render(h(Probe, { label: "a", target: window }), container));
  window.dispatchEvent(new CustomEvent("sigma-v6-ping", { detail: 1 }));

  await act(() => render(h(Probe, { label: "b", target: window }), container));
  window.dispatchEvent(new CustomEvent("sigma-v6-ping", { detail: 2 }));

  await act(() => render(h(Probe, { label: "c", target: null }), container));
  window.dispatchEvent(new CustomEvent("sigma-v6-ping", { detail: 3 }));

  assert.deepEqual(observed, ["a:1", "b:2"]);
});

test("useListener subscribes to sigma targets", async () => {
  const container = createContainer();
  const observed: string[] = [];

  class PingTarget extends SigmaTarget<{ ping: { count: number } }> {
    ping(count: number) {
      this.commit(function () {
        this.emit("ping", { count });
      });
    }
  }

  const target = new PingTarget();

  const Probe: FunctionComponent<{
    label: string;
    target: PingTarget | null;
  }> = ({ label, target }) => {
    useListener(target, "ping", (payload) => {
      observed.push(`${label}:${payload.count}`);
    });
    return null;
  };

  await act(() => render(h(Probe, { label: "a", target }), container));
  target.ping(1);

  await act(() => render(h(Probe, { label: "b", target }), container));
  target.ping(2);

  await act(() => render(h(Probe, { label: "c", target: null }), container));
  target.ping(3);

  assert.deepEqual(observed, ["a:1", "b:2"]);
});

test("useSigmaSync skips initial render and syncs shallow input changes", async () => {
  const container = createContainer();
  const synced: Array<{ users: readonly string[]; teams: readonly string[] }> = [];
  const usersA = ["ada"];
  const usersB = ["ada", "grace"];
  const teamsA = ["core"];
  let state!: Protected<QueryState>;

  class QueryState extends Sigma<{ count: number }> {
    declare count: number;

    constructor() {
      super({ count: 0 });
    }

    syncQueryData(users: readonly string[], teams: readonly string[]) {
      synced.push({ users, teams });
      this.count += 1;
    }
  }

  const Probe: FunctionComponent<{
    users: readonly string[];
    teams: readonly string[];
  }> = ({ users, teams }) => {
    state = useSigma(() => new QueryState());
    useSigmaSync(state, { users, teams }, ({ users, teams }) => {
      state.syncQueryData(users, teams);
    });
    return null;
  };

  await act(() => render(h(Probe, { users: usersA, teams: teamsA }), container));
  assert.equal(state.count, 0);
  assert.deepEqual(synced, []);

  await act(() => render(h(Probe, { users: usersA, teams: teamsA }), container));
  assert.equal(state.count, 0);

  await act(() => render(h(Probe, { users: usersB, teams: teamsA }), container));
  assert.equal(state.count, 1);
  assert.deepEqual(synced, [{ users: usersB, teams: teamsA }]);
});

test("useSigmaSync treats a recreated instance as a fresh initial render", async () => {
  const container = createContainer();
  const synced: string[] = [];
  let state!: Protected<QueryState>;

  class QueryState extends Sigma<{ value: string }> {
    declare value: string;

    constructor(value: string) {
      super({ value });
    }

    syncValue(value: string) {
      synced.push(value);
      this.value = value;
    }
  }

  const Probe: FunctionComponent<{ id: string; value: string }> = ({ id, value }) => {
    state = useSigma(() => new QueryState(value), [id]);
    useSigmaSync(state, { value }, ({ value }) => {
      state.syncValue(value);
    });
    return null;
  };

  await act(() => render(h(Probe, { id: "a", value: "one" }), container));
  assert.equal(state.value, "one");

  await act(() => render(h(Probe, { id: "a", value: "two" }), container));
  assert.equal(state.value, "two");
  assert.deepEqual(synced, ["two"]);

  await act(() => render(h(Probe, { id: "b", value: "three" }), container));
  assert.equal(state.value, "three");
  assert.deepEqual(synced, ["two"]);
});

test("useSigmaSync requires plain object input with stable keys", async () => {
  const container = createContainer();

  class QueryState extends Sigma<{ count: number }> {
    declare count: number;

    constructor() {
      super({ count: 0 });
    }
  }

  const state = new QueryState();

  const InvalidInput: FunctionComponent = () => {
    useSigmaSync(state, [] as any, () => {});
    return null;
  };

  assert.throws(() => {
    render(h(InvalidInput, {}), container);
  }, /plain object/);

  const ChangingKeys: FunctionComponent<{ mode: "one" | "two" }> = ({ mode }) => {
    useSigmaSync(state, mode === "one" ? { value: 1 } : { value: 2, extra: true }, () => {});
    return null;
  };

  await act(() => render(h(ChangingKeys, { mode: "one" }), container));
  assert.throws(() => {
    act(() => render(h(ChangingKeys, { mode: "two" }), container));
  }, /stable/);
});
