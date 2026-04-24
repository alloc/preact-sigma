import { Sigma } from "preact-sigma";
import { hydrateSync, type PersistRecord, type SyncPersistStore } from "preact-sigma/persist";

type SearchState = {
  draft: string;
  page: number;
};

class Search extends Sigma<SearchState> {
  constructor(initialState: Partial<SearchState> = {}) {
    super({
      draft: "",
      page: 1,
      ...initialState,
    });
  }

  nextPage() {
    this.page += 1;
  }

  setDraft(draft: string) {
    this.draft = draft;
  }
}

interface Search extends SearchState {}

const records = new Map<string, PersistRecord<Pick<SearchState, "draft">>>([
  [
    "search",
    {
      savedAt: 100,
      value: { draft: "restored" },
      version: 1,
    },
  ],
]);

const store: SyncPersistStore<Pick<SearchState, "draft">> = {
  read(key) {
    return records.get(key);
  },
  write(key, record) {
    records.set(key, record);
  },
  remove(key) {
    records.delete(key);
  },
};

const search = new Search({ page: 3 });
const persistence = hydrateSync(search, {
  key: "search",
  pick: ["draft"],
  store,
});

console.log(persistence.restored); // { status: "restored", savedAt: 100, storedVersion: 1 }
console.log(search.draft); // "restored"
console.log(search.page); // 3

search.setDraft("signals");
search.nextPage();

await persistence.flush();

console.log(records.get("search")?.value); // { draft: "signals" }

await persistence.stop();
