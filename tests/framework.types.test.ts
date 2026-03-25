import {
  defineManagedState,
  type Lens,
  query,
  type StateHandle,
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

void count;
void ready;
void childFromSnapshot;

dashboard.get("child");
