import { assertType, expectTypeOf, test } from "vitest";
import { Sigma } from "preact-sigma";
import {
  hydrate,
  hydrateSync,
  restore,
  restoreSync,
  type PersistCodec,
  type PersistOptions,
  type PersistRecord,
  type RestoreResult,
  type SyncPersistOptions,
  type SyncPersistStore,
} from "preact-sigma/persist";

type SearchState = {
  draft: string;
  page: number;
};

class Search extends Sigma<SearchState> {
  declare draft: string;
  declare page: number;

  constructor() {
    super({
      draft: "",
      page: 1,
    });
  }
}

test("persist helpers infer state and store types", () => {
  const search = new Search();

  const syncStore: SyncPersistStore<SearchState> = {
    get() {
      return undefined;
    },
    set() {},
    delete() {},
  };

  const asyncStore = {
    async get() {
      return undefined as PersistRecord<SearchState> | undefined;
    },
    async set() {},
    async delete() {},
  };

  const fullOptions = {
    key: "search",
    store: syncStore,
  } satisfies SyncPersistOptions<SearchState>;

  assertType<RestoreResult>(restoreSync(search, fullOptions));
  assertType<Promise<RestoreResult>>(restore(search, { key: "search", store: asyncStore }));

  const partialCodec = {
    version: 1,
    encode(state) {
      return {
        draft: state.draft,
      };
    },
    decode(stored, context) {
      return {
        ...context.baseState,
        ...(stored as { draft: string }),
      };
    },
  } satisfies PersistCodec<SearchState, { draft: string }>;

  expectTypeOf(partialCodec).toEqualTypeOf<PersistCodec<SearchState, { draft: string }>>();

  const partialOptions = {
    codec: partialCodec,
    key: "search",
    store: {
      get() {
        return undefined as PersistRecord<{ draft: string }> | undefined;
      },
      set() {},
      delete() {},
    },
  } satisfies PersistOptions<SearchState, { draft: string }>;

  const pickedStore: SyncPersistStore<Pick<SearchState, "draft">> = {
    get() {
      return undefined;
    },
    set() {},
    delete() {},
  };

  assertType<Promise<RestoreResult>>(restore(search, partialOptions));
  assertType<RestoreResult>(hydrateSync(search, fullOptions).restored);
  assertType<Promise<RestoreResult>>(hydrate(search, { key: "search", store: asyncStore }).restored);
  assertType<RestoreResult>(
    hydrateSync(search, {
      key: "search",
      pick: ["draft"],
      store: pickedStore,
    }).restored,
  );

  // @ts-expect-error restoreSync requires a synchronous store
  restoreSync(search, { key: "search", store: asyncStore });

  // @ts-expect-error pick keys must exist on the sigma state
  hydrateSync(search, {
    key: "search",
    pick: ["missing"],
    store: pickedStore,
  });
});
