import { SigmaType } from "preact-sigma";

const SaveIndicator = new SigmaType<
  {
    savedCount: number;
    saving: boolean;
  },
  {
    saved: {
      count: number;
    };
  }
>("SaveIndicator")
  .defaultState({
    savedCount: 0,
    saving: false,
  })
  .actions({
    async save() {
      this.saving = true;
      this.commit(); // Publish before the async boundary.

      await Promise.resolve();

      this.savedCount += 1;
      this.saving = false;
      this.commit(); // Publish before emitting the event boundary.

      this.emit("saved", { count: this.savedCount });
    },
  });

const indicator = new SaveIndicator();

indicator.on("saved", ({ count }) => {
  console.log(`Saved ${count} times`);
});

await indicator.save();

console.log(indicator.saving); // false
console.log(indicator.savedCount); // 1
