import { afterEach, assert, test, vi } from "vitest";
import { SigmaType } from "preact-sigma";
import {
  bindPersistence,
  bindPersistenceSync,
  persistState,
  pickStateCodec,
  restoreStateSync,
  type PersistRecord,
  type PersistStore,
  type SyncPersistStore,
} from "preact-sigma/persist";

function createSyncStore<TRecord>() {
  const records = new Map<string, TRecord>();
  const writes: Array<{ key: string; record: TRecord }> = [];

  const store: SyncPersistStore<TRecord> = {
    read(key) {
      return records.get(key);
    },
    write(key, record) {
      writes.push({ key, record });
      records.set(key, record);
    },
    remove(key) {
      records.delete(key);
    },
  };

  return {
    records,
    store,
    writes,
  };
}

function createAsyncStore<TRecord>(initial?: Iterable<readonly [string, TRecord]>) {
  const records = new Map(initial);
  const writes: Array<{ key: string; record: TRecord }> = [];

  const store: PersistStore<TRecord> = {
    async read(key) {
      return records.get(key);
    },
    async write(key, record) {
      writes.push({ key, record });
      records.set(key, record);
    },
    async remove(key) {
      records.delete(key);
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

test("restoreStateSync returns missing when no record exists", () => {
  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      increment() {
        this.count += 1;
      },
    });

  const counter = new Counter();
  const { store } = createSyncStore<PersistRecord<{ count: number }>>();

  assert.deepEqual(restoreStateSync(counter, { key: "counter", store }), {
    status: "missing",
  });
  assert.equal(counter.count, 0);
});

test("bindPersistenceSync restores selected keys through pickStateCodec", async () => {
  const Search = new SigmaType<{
    draft: string;
    page: number;
  }>()
    .defaultState({
      draft: "",
      page: 1,
    })
    .actions({
      nextPage() {
        this.page += 1;
      },
      setDraft(draft: string) {
        this.draft = draft;
      },
    });

  const { records, store, writes } = createSyncStore<PersistRecord<{ draft: string }>>();
  records.set("search", {
    savedAt: 100,
    value: { draft: "restored" },
    version: 1,
  });

  const search = new Search({ page: 5 });
  const handle = bindPersistenceSync(search, {
    codec: pickStateCodec(["draft"]),
    key: "search",
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

test("persistState coalesces microtask writes to the latest committed snapshot", async () => {
  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      increment() {
        this.count += 1;
      },
    });

  const counter = new Counter();
  const { store, writes } = createSyncStore<PersistRecord<{ count: number }>>();
  const handle = persistState(counter, {
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

test("persistState supports debounced writes", async () => {
  vi.useFakeTimers();

  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      increment() {
        this.count += 1;
      },
    });

  const counter = new Counter();
  const { store, writes } = createSyncStore<PersistRecord<{ count: number }>>();
  const handle = persistState(counter, {
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

test("clear removes stored state and keeps future persistence active", async () => {
  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      increment() {
        this.count += 1;
      },
    });

  const counter = new Counter();
  const { records, store } = createSyncStore<PersistRecord<{ count: number }>>();
  const handle = persistState(counter, {
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

test("bindPersistence restores asynchronously before persisting future changes", async () => {
  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      increment() {
        this.count += 1;
      },
    });

  const { records, store } = createAsyncStore<PersistRecord<{ count: number }>>([
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
  const handle = bindPersistence(counter, {
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