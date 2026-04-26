import { mergeDefaults, Sigma } from "preact-sigma";
import {
  hydrate,
  hydrateSync,
  persist,
  restore,
  restoreSync,
  type PersistRecord,
  type PersistStore,
  type SyncPersistStore,
} from "preact-sigma/persist";
import { afterEach, assert, test, vi } from "vitest";

type CounterState = {
  count: number;
};

class Counter extends Sigma<CounterState> {
  declare count: number;

  static defaultState: CounterState = {
    count: 0,
  };

  constructor(initialState?: Partial<CounterState>) {
    super(mergeDefaults(initialState, Counter.defaultState));
  }

  increment() {
    this.count += 1;
  }
}

type SearchState = {
  draft: string;
  page: number;
};

class Search extends Sigma<SearchState> {
  declare draft: string;
  declare page: number;

  static defaultState: SearchState = {
    draft: "",
    page: 1,
  };

  constructor(initialState?: Partial<SearchState>) {
    super(mergeDefaults(initialState, Search.defaultState));
  }

  nextPage() {
    this.page += 1;
  }

  setDraft(draft: string) {
    this.draft = draft;
  }
}

function createSyncStore<TStored>(initial?: Iterable<readonly [string, PersistRecord<TStored>]>) {
  const records = new Map(initial);
  const writes: Array<{ key: string; record: PersistRecord<TStored> }> = [];

  const store: SyncPersistStore<TStored> = {
    get(key) {
      return records.get(key);
    },
    set(key, record) {
      writes.push({ key, record });
      return records.set(key, record);
    },
    delete(key) {
      return records.delete(key);
    },
  };

  return {
    records,
    store,
    writes,
  };
}

function createAsyncStore<TStored>(initial?: Iterable<readonly [string, PersistRecord<TStored>]>) {
  const records = new Map(initial);
  const writes: Array<{ key: string; record: PersistRecord<TStored> }> = [];

  const store: PersistStore<TStored> = {
    async get(key) {
      return records.get(key);
    },
    async set(key, record) {
      writes.push({ key, record });
      return records.set(key, record);
    },
    async delete(key) {
      return records.delete(key);
    },
  };

  return {
    records,
    store,
    writes,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test("restoreSync returns missing when no record exists", () => {
  const counter = new Counter();
  const { store } = createSyncStore<CounterState>();

  assert.deepEqual(restoreSync(counter, { key: "counter", store }), {
    status: "missing",
  });
  assert.equal(counter.count, 0);
});

test("restore applies async codec results with decode context", async () => {
  const { store } = createAsyncStore<{ offset: number }>([
    [
      "counter",
      {
        savedAt: 42,
        value: { offset: 5 },
        version: 3,
      },
    ],
  ]);
  const counter = new Counter({ count: 2 });
  let observedContext:
    | {
        baseCount: number;
        key: string;
        storedVersion: number;
      }
    | undefined;

  const result = await restore(counter, {
    codec: {
      version: 4,
      encode(state) {
        return {
          offset: state.count,
        };
      },
      decode(stored, context) {
        observedContext = {
          baseCount: context.baseState.count,
          key: context.key,
          storedVersion: context.storedVersion,
        };
        return {
          count: context.baseState.count + (stored as { offset: number }).offset,
        };
      },
    },
    key: "counter",
    store,
  });

  assert.deepEqual(result, {
    savedAt: 42,
    status: "restored",
    storedVersion: 3,
  });
  assert.equal(counter.count, 7);
  assert.deepEqual(observedContext, {
    baseCount: 2,
    key: "counter",
    storedVersion: 3,
  });
});

test("hydrateSync restores selected keys through pick", async () => {
  const { records, store, writes } = createSyncStore<Pick<SearchState, "draft">>();
  records.set("search", {
    savedAt: 100,
    value: { draft: "restored" },
    version: 1,
  });

  const search = new Search({ page: 5 });
  const handle = hydrateSync(search, {
    key: "search",
    pick: ["draft"],
    store,
  });

  assert.deepEqual(handle.restored, {
    savedAt: 100,
    status: "restored",
    storedVersion: 1,
  });
  assert.equal(search.draft, "restored");
  assert.equal(search.page, 5);

  search.nextPage();
  search.setDraft("updated");

  await handle.flush();

  assert.lengthOf(writes, 1);
  assert.deepEqual(writes[0]?.record.value, { draft: "updated" });
  await handle.stop();
});

test("persist coalesces microtask writes to the latest committed snapshot", async () => {
  const counter = new Counter();
  const { store, writes } = createSyncStore<CounterState>();
  const handle = persist(counter, {
    key: "counter",
    store,
  });

  counter.increment();
  counter.increment();

  assert.lengthOf(writes, 0);

  await handle.flush();

  assert.lengthOf(writes, 1);
  assert.equal(writes[0]?.record.value.count, 2);
  await handle.stop();
});

test("persist supports debounced writes", async () => {
  vi.useFakeTimers();

  const counter = new Counter();
  const { store, writes } = createSyncStore<CounterState>();
  const handle = persist(counter, {
    key: "counter",
    schedule: { debounceMs: 50 },
    store,
  });

  counter.increment();
  counter.increment();

  vi.advanceTimersByTime(49);
  assert.lengthOf(writes, 0);

  vi.advanceTimersByTime(1);
  await vi.runAllTimersAsync();

  assert.lengthOf(writes, 1);
  assert.equal(writes[0]?.record.value.count, 2);
  await handle.stop();
});

test("persist writes initial state and reports background write failures", async () => {
  const counter = new Counter({ count: 4 });
  const { records, store, writes } = createAsyncStore<CounterState>();
  const observedErrors: Array<{
    count: number;
    error: unknown;
    sameInstance: boolean;
    key: string;
  }> = [];
  let failNextWrite = true;

  const failingStore: PersistStore<CounterState> = {
    get(key) {
      return store.get(key);
    },
    set(key, record) {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("write failed");
      }
      return store.set(key, record);
    },
    delete(key) {
      return store.delete(key);
    },
  };

  const handle = persist(counter, {
    key: "counter",
    onWriteError(error, context) {
      observedErrors.push({
        count: counter.count,
        error,
        key: context.key,
        sameInstance: context.instance === counter,
      });
    },
    schedule: "immediate",
    store: failingStore,
    writeInitial: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.lengthOf(observedErrors, 1);
  const observedError = observedErrors[0]!;
  assert.instanceOf(observedError.error, Error);
  assert.equal(observedError.error.message, "write failed");
  assert.deepInclude(observedError, {
    count: 4,
    key: "counter",
    sameInstance: true,
  });
  assert.lengthOf(writes, 0);

  counter.increment();
  await handle.flush();

  assert.lengthOf(writes, 1);
  assert.equal(records.get("counter")?.value.count, 5);
  await handle.stop();
});

test("clear removes stored state and keeps future persistence active", async () => {
  const counter = new Counter();
  const { records, store } = createSyncStore<CounterState>();
  const handle = persist(counter, {
    key: "counter",
    store,
  });

  counter.increment();
  await handle.flush();
  assert.equal(records.get("counter")?.value.count, 1);

  counter.increment();
  await handle.clear();
  assert.equal(records.has("counter"), false);

  counter.increment();
  await handle.flush();
  assert.equal(records.get("counter")?.value.count, 3);
  await handle.stop();
});

test("hydrate restores asynchronously before persisting future changes", async () => {
  const { records, store } = createAsyncStore<CounterState>([
    [
      "counter",
      {
        savedAt: 10,
        value: { count: 5 },
        version: 1,
      },
    ],
  ]);

  const counter = new Counter();
  const handle = hydrate(counter, {
    key: "counter",
    store,
  });

  assert.deepEqual(await handle.restored, {
    savedAt: 10,
    status: "restored",
    storedVersion: 1,
  });
  assert.equal(counter.count, 5);

  counter.increment();
  await handle.flush();

  assert.equal(records.get("counter")?.value.count, 6);
  await handle.stop();
});

test("hydrate stop before async restore completes skips future persistence", async () => {
  let resolveGet!: (record: PersistRecord<CounterState>) => void;
  const writes: PersistRecord<CounterState>[] = [];
  const store: PersistStore<CounterState> = {
    get() {
      return new Promise((resolve) => {
        resolveGet = resolve;
      });
    },
    async set(_key, record) {
      writes.push(record);
    },
    async delete() {},
  };

  const counter = new Counter();
  const handle = hydrate(counter, {
    key: "counter",
    store,
  });
  const stopped = handle.stop();

  resolveGet({
    savedAt: 10,
    value: { count: 5 },
    version: 1,
  });

  await stopped;

  assert.deepEqual(await handle.restored, {
    savedAt: 10,
    status: "restored",
    storedVersion: 1,
  });
  assert.equal(counter.count, 5);

  counter.increment();
  await handle.flush();

  assert.lengthOf(writes, 0);
});
