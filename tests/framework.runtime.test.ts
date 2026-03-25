import assert from "node:assert/strict";
import test from "node:test";

import {
  computed,
  defineManagedState,
  isManagedState,
  type StateHandle,
} from "../framework.js";

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
