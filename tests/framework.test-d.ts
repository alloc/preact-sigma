import type { ReadonlySignal } from "@preact/signals";
import { assertType, expectTypeOf, test } from "vitest";

import {
  defineManagedState,
  type Lens,
  query,
  type StateHandle,
  useManagedState,
} from "preact-sigma";

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

test("state handles expose the expected type surface", () => {
  expectTypeOf<StateHandle<{ query: string }>["query"]>().toEqualTypeOf<Lens<string>>();
  expectTypeOf<HasKey<StateHandle<number>, "query">>().toEqualTypeOf<false>();
  expectTypeOf<HasKey<StateHandle<string[]>, 0>>().toEqualTypeOf<false>();

  const identityQuery = query((value: number) => value);
  expectTypeOf(identityQuery).toEqualTypeOf<(value: number) => number>();

  // @ts-expect-error query callbacks are closure-based and do not use `this`
  query(function (this: { count: number }) {
    return this.count;
  });
});

test("managed state instances expose the inferred public API", () => {
  const SearchManager = defineManagedState(
    (search: StateHandle<{ query: string }>) => ({
      query: search.query,
    }),
    { query: "" },
  );

  const search = new SearchManager();
  assertType<string>(search.query);
  assertType<ReadonlySignal<string>>(search.get("query"));
  assertType<string>(search.peek("query"));
  assertType<ReadonlySignal<{ query: string }>>(search.get());

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

  assertType<number>(dashboard.child.counter.count);
  assertType<boolean>(dashboard.dashboard.ready);
  assertType<typeof dashboard.child>(dashboard.peek().child);
  assertType<typeof dashboard.child>(dashboard.get().value.child);

  const StatusManager = defineManagedState(
    (status: StateHandle<"idle" | "busy">) => ({
      status,
    }),
    "idle",
  );

  const status = new StatusManager();
  assertType<"idle" | "busy">(status.status);
  assertType<() => void>(status.dispose);
  assertType<() => void>(status[Symbol.dispose]);

  useManagedState(
    (value: StateHandle<{ query: string }>) => ({
      query: value.query,
    }),
    () => ({ query: "" }),
  );
});

test("managed state types reject invalid API usage", () => {
  const CounterManager = defineManagedState(
    (counter: StateHandle<{ count: number }>) => ({
      counter,
    }),
    { count: 0 },
  );

  const DashboardManager = defineManagedState(
    (dashboard: StateHandle<{ ready: boolean }>) => ({
      dashboard,
      child: new CounterManager(),
    }),
    { ready: false },
  );

  const dashboard = new DashboardManager();

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
});

test("state handles accept supported owned resources", () => {
  const CounterManager = defineManagedState(
    (counter: StateHandle<{ count: number }>) => ({
      counter,
    }),
    { count: 0 },
  );

  const OwningManager = defineManagedState((handle: StateHandle<{}>) => {
    const child = new CounterManager();

    handle.own(() => {});
    handle.own(child);
    handle.own({
      [Symbol.dispose]() {},
    });
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
  }, {});

  const owning = new OwningManager();
  owning.dispose();
  owning[Symbol.dispose]();
});
