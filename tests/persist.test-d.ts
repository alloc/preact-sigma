import { assertType, expectTypeOf, test } from "vitest";
import { SigmaType } from "preact-sigma";
import {
  bindPersistence,
  bindPersistenceSync,
  pickStateCodec,
  restoreState,
  restoreStateSync,
  type PersistCodec,
  type PersistOptions,
  type PersistRecord,
  type RestoreResult,
  type SyncPersistOptions,
  type SyncPersistStore,
} from "preact-sigma/persist";

test("persist helpers infer state and store types", () => {
  const Search = new SigmaType<{
    draft: string;
    page: number;
  }>().defaultState({
    draft: "",
    page: 1,
  });

  const search = new Search();

  const syncStore: SyncPersistStore<PersistRecord<{ draft: string; page: number }>> = {
    read() {
      return undefined;
    },
    write() {},
    remove() {},
  };

  const asyncStore = {
    async read() {
      return undefined as PersistRecord<{ draft: string; page: number }> | undefined;
    },
    async write() {},
    async remove() {},
  };

  const fullOptions = {
    key: "search",
    store: syncStore,
  } satisfies SyncPersistOptions<typeof search>;

  assertType<RestoreResult>(restoreStateSync(search, fullOptions));
  assertType<Promise<RestoreResult>>(restoreState(search, { key: "search", store: asyncStore }));

  const partialCodec = pickStateCodec<{ draft: string; page: number }, "draft">(["draft"]);
  expectTypeOf(partialCodec).toEqualTypeOf<
    PersistCodec<{ draft: string; page: number }, { draft: string }>
  >();

  const partialOptions = {
    codec: partialCodec,
    key: "search",
    store: {
      read() {
        return undefined as PersistRecord<{ draft: string }> | undefined;
      },
      write() {},
      remove() {},
    },
  } satisfies PersistOptions<typeof search, { draft: string }>;

  assertType<Promise<RestoreResult>>(restoreState(search, partialOptions));
  assertType<RestoreResult>(bindPersistenceSync(search, fullOptions).restored);
  assertType<Promise<RestoreResult>>(bindPersistence(search, { key: "search", store: asyncStore }).restored);

  // @ts-expect-error restoreStateSync requires a synchronous store
  restoreStateSync(search, { key: "search", store: asyncStore });
});