import { SigmaType } from "preact-sigma";
import {
  bindPersistenceSync,
  pickStateCodec,
  type PersistRecord,
  type SyncPersistStore,
} from "preact-sigma/persist";

const Search = new SigmaType<{
  draft: string;
  page: number;
}>("Search")
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

const records = new Map<string, PersistRecord<{ draft: string }>>([
  [
    "search",
    {
      savedAt: 100,
      value: { draft: "restored" },
      version: 1,
    },
  ],
]);

const store: SyncPersistStore<PersistRecord<{ draft: string }>> = {
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
const persistence = bindPersistenceSync(search, {
  codec: pickStateCodec(["draft"]),
  key: "search",
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
