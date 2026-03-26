import assert from "node:assert/strict";
import test from "node:test";

import {
  computed,
  defineManagedState,
  isManagedState,
  query,
  type StateHandle,
} from "../src/index.js";

test("top-level lenses read tracked values and update shallow properties", () => {
  let searchHandle!: StateHandle<{
    options: { exact: boolean };
    query: string;
  }>;

  const SearchManager = defineManagedState(
    (search: typeof searchHandle) => {
      searchHandle = search;

      return {
        search,
      };
    },
    { options: { exact: false }, query: "" },
  );

  const search = new SearchManager();
  const queryLength = computed(() => searchHandle.query.get().length);

  assert.equal(queryLength.value, 0);
  assert.equal(searchHandle.query.get(), "");

  searchHandle.query.set("hello");
  assert.equal(search.search.query, "hello");
  assert.equal(queryLength.value, 5);

  searchHandle.options.set((options) => {
    options.exact = true;
  });
  assert.equal(search.search.options.exact, true);
});

test("returned top-level lenses become reactive public properties", () => {
  let searchHandle!: StateHandle<{
    options: { exact: boolean };
    query: string;
  }>;

  const SearchManager = defineManagedState(
    (search: typeof searchHandle) => {
      searchHandle = search;

      return {
        query: search.query,
      };
    },
    { options: { exact: false }, query: "" },
  );

  const search = new SearchManager();
  const upperQuery = computed(() => search.query.toUpperCase());
  const observedQueries: string[] = [];
  const stop = search.subscribe("query", (query) => {
    observedQueries.push(query);
  });

  assert.equal(search.query, "");
  assert.equal(search.peek("query"), "");
  assert.equal(search.get("query")?.value, "");
  assert.equal(upperQuery.value, "");

  searchHandle.query.set("hello");

  assert.equal(search.query, "hello");
  assert.equal(search.peek("query"), "hello");
  assert.equal(search.get("query")?.value, "hello");
  assert.equal(upperQuery.value, "HELLO");
  assert.deepEqual(observedQueries, ["", "hello"]);

  stop();
});

test("returned state handles become reactive public properties", () => {
  const CounterManager = defineManagedState(
    (count: StateHandle<number>) => ({
      count,
      increment() {
        count.set((value) => value + 1);
      },
    }),
    0,
  );

  const counter = new CounterManager();
  const doubledCount = computed(() => counter.count * 2);
  const observedCounts: number[] = [];
  const stop = counter.subscribe("count", (count) => {
    observedCounts.push(count);
  });

  assert.equal(counter.count, 0);
  assert.equal(counter.peek("count"), 0);
  assert.equal(counter.get("count")?.value, 0);
  assert.equal(doubledCount.value, 0);

  counter.increment();

  assert.equal(counter.count, 1);
  assert.equal(counter.peek("count"), 1);
  assert.equal(counter.get("count")?.value, 1);
  assert.equal(doubledCount.value, 2);
  assert.deepEqual(observedCounts, [0, 1]);

  stop();
});

test("returned computed signals become reactive public properties", () => {
  const CounterManager = defineManagedState(
    (count: StateHandle<number>) => ({
      doubled: computed(() => count.get() * 2),
      increment() {
        count.set((value) => value + 1);
      },
    }),
    0,
  );

  const counter = new CounterManager();
  const observedValues: number[] = [];
  const stop = counter.subscribe("doubled", (value) => {
    observedValues.push(value);
  });

  assert.equal(counter.doubled, 0);
  assert.equal(counter.peek("doubled"), 0);
  assert.equal(counter.get("doubled")?.value, 0);
  assert.equal(counter.get().value.doubled, 0);

  counter.increment();

  assert.equal(counter.doubled, 2);
  assert.equal(counter.peek("doubled"), 2);
  assert.equal(counter.get("doubled")?.value, 2);
  assert.equal(counter.get().value.doubled, 2);
  assert.deepEqual(observedValues, [0, 2]);

  stop();
});

test("subscriptions emit the current value immediately", () => {
  const CounterManager = defineManagedState(
    (counter: StateHandle<{ count: number }>) => ({
      count: counter.count,
      increment() {
        counter.count.set((value) => value + 1);
      },
    }),
    { count: 0 },
  );

  const counter = new CounterManager();
  const observedCounts: number[] = [];
  const observedSnapshots: number[] = [];

  const stopCount = counter.subscribe("count", (count) => {
    observedCounts.push(count);
  });
  const stopState = counter.subscribe((value) => {
    observedSnapshots.push(value.count);
  });

  assert.deepEqual(observedCounts, [0]);
  assert.deepEqual(observedSnapshots, [0]);

  counter.increment();

  assert.deepEqual(observedCounts, [0, 1]);
  assert.deepEqual(observedSnapshots, [0, 1]);

  stopCount();
  stopState();
});

test("events deliver payloads and unsubscribe cleanly", () => {
  type TodoEvents = {
    saved: [];
    selected: [{ id: string }];
  };

  const TodoManager = defineManagedState(
    (todo: StateHandle<{}, TodoEvents>) => ({
      save() {
        todo.emit("saved");
      },
      select(id: string) {
        todo.emit("selected", { id });
      },
    }),
    {},
  );

  const todo = new TodoManager();
  let savedCount = 0;
  const selectedIds: string[] = [];
  const stopSaved = todo.on("saved", () => {
    savedCount += 1;
  });
  const stopSelected = todo.on("selected", (event) => {
    selectedIds.push(event.id);
  });

  todo.save();
  todo.select("a");

  stopSaved();
  stopSelected();

  todo.save();
  todo.select("b");

  assert.equal(savedCount, 1);
  assert.deepEqual(selectedIds, ["a"]);
});

test("state handles update object state with Immer producers", () => {
  let searchHandle!: StateHandle<{
    page: number;
    query: string;
  }>;

  const SearchManager = defineManagedState(
    (search: typeof searchHandle) => {
      searchHandle = search;

      return {
        query: search.query,
        setQuery(query: string) {
          search.set((draft) => {
            draft.page += 1;
            draft.query = query;
          });
        },
      };
    },
    { page: 1, query: "" },
  );

  const search = new SearchManager();

  search.setQuery("hello");

  assert.equal(search.query, "hello");
  assert.deepEqual(searchHandle.get(), { page: 2, query: "hello" });
  assert.equal(search.peek().query, "hello");
  assert.equal(search.get().value.query, "hello");
  assert.deepEqual(searchHandle.peek(), { page: 2, query: "hello" });
});

test("spreading a state handle exposes top-level lenses without handle methods", () => {
  let searchHandle!: StateHandle<{
    options: { exact: boolean };
    query: string;
  }>;

  const SearchManager = defineManagedState(
    (search: typeof searchHandle) => {
      searchHandle = search;

      return {
        ...search,
      };
    },
    { options: { exact: false }, query: "" },
  );

  const search = new SearchManager();

  assert.equal(search.query, "");
  assert.equal(search.options.exact, false);
  assert.equal(Object.hasOwn(search, "set"), false);

  searchHandle.query.set("hello");
  searchHandle.options.set((options) => {
    options.exact = true;
  });

  assert.equal(search.query, "hello");
  assert.equal(search.options.exact, true);
});

test("keyed subscriptions reject non-signal public properties", () => {
  const CounterManager = defineManagedState(
    (count: StateHandle<number>) => ({
      count,
    }),
    0,
  );

  const DashboardManager = defineManagedState(
    (dashboard: StateHandle<{ ready: boolean }>) => ({
      ready: dashboard.ready,
      child: new CounterManager(),
    }),
    { ready: false },
  );

  const dashboard = new DashboardManager();

  assert.throws(
    () => dashboard.subscribe("child" as never, () => {}),
    /Property child is not a signal/,
  );
});

test("composed managed states pass through unchanged", () => {
  const CounterManager = defineManagedState(
    (count: StateHandle<number>) => ({
      count,
      increment() {
        count.set((value) => value + 1);
      },
    }),
    0,
  );

  const DashboardManager = defineManagedState(
    (dashboard: StateHandle<{ ready: boolean }>) => {
      const counter = new CounterManager();

      return {
        dashboard,
        counter,
        toggleReady() {
          dashboard.ready.set((ready) => !ready);
        },
      };
    },
    { ready: false },
  );

  const dashboard = new DashboardManager();
  const snapshots: Array<{ counter: InstanceType<typeof CounterManager> }> = [];
  const unsubscribe = dashboard.subscribe((value) => {
    snapshots.push(value);
  });
  const baselineSnapshotCount = snapshots.length;

  assert.equal(isManagedState(dashboard.counter), true);
  assert.equal(dashboard.peek().counter, dashboard.counter);

  dashboard.counter.increment();
  assert.equal(dashboard.counter.count, 1);
  assert.equal(snapshots.length, baselineSnapshotCount);

  dashboard.toggleReady();
  assert.equal(snapshots.length, baselineSnapshotCount + 1);
  assert.equal(snapshots.at(-1)?.counter, dashboard.counter);

  unsubscribe();
});

test("query methods keep signal tracking when they read state", () => {
  const CounterManager = defineManagedState(
    (count: StateHandle<number>) => ({
      count,
      readCount: query(() => count.get()),
      readCountUntracked() {
        return count.get();
      },
      increment() {
        count.set((value) => value + 1);
      },
    }),
    0,
  );

  const counter = new CounterManager();
  const trackedCount = computed(() => counter.readCount());
  const untrackedCount = computed(() => counter.readCountUntracked());

  assert.equal(trackedCount.value, 0);
  assert.equal(untrackedCount.value, 0);

  counter.increment();

  assert.equal(trackedCount.value, 1);
  assert.equal(untrackedCount.value, 0);
});

test("state handle peek reads without tracking", () => {
  const CounterManager = defineManagedState(
    (count: StateHandle<number>) => ({
      readCount: query(() => count.peek()),
      increment() {
        count.set((value) => value + 1);
      },
    }),
    0,
  );

  const counter = new CounterManager();
  const untrackedCount = computed(() => counter.readCount());

  assert.equal(untrackedCount.value, 0);

  counter.increment();

  assert.equal(untrackedCount.value, 0);
});
test("owned resources are disposed in reverse order and aggregate errors", () => {
  const steps: string[] = [];
  const firstError = new Error("first");
  const lastError = new Error("last");

  const ChildManager = defineManagedState((child: StateHandle<number>) => {
    child.own(() => {
      steps.push("child cleanup");
    });

    return {
      child,
    };
  }, 0);

  const ParentManager = defineManagedState((parent: StateHandle<{}>) => {
    const child = new ChildManager();

    parent.own([
      () => {
        steps.push("first cleanup");
        throw firstError;
      },
      child,
      {
        [Symbol.dispose]() {
          steps.push("last cleanup");
          throw lastError;
        },
      },
    ]);

    return {
      child,
    };
  }, {});

  const parent = new ParentManager();

  assert.throws(
    () => parent.dispose(),
    (error: unknown) => {
      assert.equal(error instanceof AggregateError, true);
      assert.deepEqual((error as AggregateError).errors, [lastError, firstError]);
      return true;
    },
  );

  assert.deepEqual(steps, ["last cleanup", "child cleanup", "first cleanup"]);

  parent.dispose();
  assert.deepEqual(steps, ["last cleanup", "child cleanup", "first cleanup"]);
});

test("owned resources can be added after disposal and dispose immediately", () => {
  let ownLate!: (
    resources:
      | (() => void)
      | { [Symbol.dispose](): void }
      | readonly ((() => void) | { [Symbol.dispose](): void })[],
  ) => void;
  const steps: string[] = [];

  const Manager = defineManagedState((handle: StateHandle<{}>) => {
    ownLate = handle.own;

    return {
      disposeLater() {
        handle.own([
          () => {
            steps.push("late cleanup");
          },
        ]);
      },
    };
  }, {});

  const manager = new Manager();

  manager.dispose();
  ownLate({
    [Symbol.dispose]() {
      steps.push("late disposable");
    },
  });
  ownLate([
    () => {
      steps.push("late array cleanup");
    },
    {
      [Symbol.dispose]() {
        steps.push("late array disposable");
      },
    },
  ]);
  manager.disposeLater();
  manager[Symbol.dispose]();

  assert.deepEqual(steps, [
    "late disposable",
    "late array disposable",
    "late array cleanup",
    "late cleanup",
  ]);
});
