import { assertType, expectTypeOf, test } from "vitest";
import { castProtected, Sigma } from "preact-sigma";
import {
  hydrate,
  hydrateSync,
  persist,
  restore,
  restoreSync,
  type PersistCodec,
  type PersistOptions,
  type PersistRecord,
  type PersistenceHandle,
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
  const protectedSearch = castProtected(search);

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
  assertType<RestoreResult>(restoreSync(protectedSearch, fullOptions));
  assertType<Promise<RestoreResult>>(
    restore(protectedSearch, { key: "search", store: asyncStore }),
  );

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
  assertType<Promise<RestoreResult>>(restore(protectedSearch, partialOptions));
  assertType<PersistenceHandle>(persist(protectedSearch, fullOptions));
  assertType<PersistenceHandle>(
    persist(protectedSearch, {
      key: "search",
      pick: ["draft"],
      store: pickedStore,
    }),
  );
  assertType<RestoreResult>(hydrateSync(search, fullOptions).restored);
  assertType<Promise<RestoreResult>>(hydrate(search, { key: "search", store: asyncStore }).restored);
  assertType<RestoreResult>(
    hydrateSync(search, {
      key: "search",
      pick: ["draft"],
      store: pickedStore,
    }).restored,
  );
  assertType<RestoreResult>(
    hydrateSync(protectedSearch, {
      key: "search",
      pick: ["draft"],
      store: pickedStore,
    }).restored,
  );
  assertType<Promise<RestoreResult>>(
    hydrate(protectedSearch, { key: "search", store: asyncStore }).restored,
  );

  // @ts-expect-error pick persistence and custom codecs are mutually exclusive
  hydrateSync(search, {
    codec: partialCodec,
    key: "search",
    pick: ["draft"],
    store: pickedStore,
  });

  // @ts-expect-error restoreSync requires a synchronous store
  restoreSync(search, { key: "search", store: asyncStore });

  // @ts-expect-error pick keys must exist on the sigma state
  hydrateSync(search, {
    key: "search",
    pick: ["missing"],
    store: pickedStore,
  });

  // @ts-expect-error pick keys must exist on the protected sigma state
  hydrateSync(protectedSearch, {
    key: "search",
    pick: ["missing"],
    store: pickedStore,
  });
});
