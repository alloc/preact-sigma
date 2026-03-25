import type { ReadonlySignal } from "@preact/signals";

import {
  defineManagedState,
  type Lens,
  query,
  type StateHandle,
  useManagedState,
} from "../framework.js";

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

type SearchHandle = StateHandle<{ query: string }>;
type _lensIsExposed = Assert<Equal<SearchHandle["query"], Lens<string>>>;
type _primitiveHasNoLens = Assert<
  Equal<HasKey<StateHandle<number>, "query">, false>
>;
type _arrayHasNoLens = Assert<Equal<HasKey<StateHandle<string[]>, 0>, false>>;
const identityQuery = query((value: number) => value);
type _queryPreservesType = Assert<
  Equal<typeof identityQuery, (value: number) => number>
>;
// @ts-expect-error query callbacks are closure-based and do not use `this`
query(function (this: { count: number }) {
  return this.count;
});

const SearchManager = defineManagedState(
  (search: StateHandle<{ query: string }>) => ({
    query: search.query,
  }),
  { query: "" },
);

const search = new SearchManager();
const queryValue: string = search.query;
const querySignal: ReadonlySignal<string> = search.get("query");
const querySnapshot: string = search.peek("query");
const searchSnapshotSignal: ReadonlySignal<{ query: string }> = search.get();

const CounterManager = defineManagedState(
  (counter: StateHandle<{ count: number }>) => ({
    counter,
    increment() {
      counter.count.set((value) => value + 1);
    },
  }),
  { count: 0 },
);

const DashboardManager = defineManagedState(
  (dashboard: StateHandle<{ ready: boolean }>) => {
    const child = new CounterManager();

    return {
      dashboard,
      child,
      toggleReady() {
        dashboard.ready.set((ready) => !ready);
      },
    };
  },
  { ready: false },
);

const dashboard = new DashboardManager();

dashboard.child.increment();

const count: number = dashboard.child.counter.count;
const ready: boolean = dashboard.dashboard.ready;
const childFromSnapshot: typeof dashboard.child = dashboard.peek().child;
const childFromSignalSnapshot: typeof dashboard.child = dashboard.get().value.child;

const StatusManager = defineManagedState(
  (status: StateHandle<"idle" | "busy">) => ({
    status,
  }),
  "idle",
);

const status = new StatusManager();
const statusValue: "idle" | "busy" = status.status;
const disposeStatus: () => void = status.dispose;
const disposeSymbolStatus: () => void = status[Symbol.dispose];

useManagedState(
  (search: StateHandle<{ query: string }>) => ({
    query: search.query,
  }),
  () => ({ query: "" }),
);

// @ts-expect-error keyed APIs only accept signal-backed properties
dashboard.get("child");
// @ts-expect-error keyed APIs only accept signal-backed properties
dashboard.peek("child");
// @ts-expect-error keyed APIs only accept signal-backed properties
dashboard.subscribe("child", () => {});

defineManagedState(
  (value: StateHandle<{ query: string }>) => ({
    value,
  }),
  // @ts-expect-error initial state must extend the inferred state type
  { query: 123 },
);

useManagedState(
  (value: StateHandle<{ query: string }>) => ({
    value,
  }),
  // @ts-expect-error lazy initial state must extend the inferred state type
  () => ({ query: 123 }),
);

const OwningManager = defineManagedState(
  (handle: StateHandle<{}>) => {
    const child = new CounterManager();

    handle.own([
      () => {},
      child,
      {
        [Symbol.dispose]() {},
      },
    ]);

    return {
      child,
    };
  },
  {},
);

const owning = new OwningManager();
owning.dispose();
owning[Symbol.dispose]();

void count;
void ready;
void childFromSnapshot;
void childFromSignalSnapshot;
void queryValue;
void querySignal;
void querySnapshot;
void searchSnapshotSignal;
void statusValue;
void disposeStatus;
void disposeSymbolStatus;
