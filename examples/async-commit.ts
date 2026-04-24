import { listen, SigmaTarget } from "preact-sigma";

type SaveIndicatorState = {
  savedCount: number;
  saving: boolean;
};

type SaveIndicatorEvents = {
  saved: {
    count: number;
  };
};

class SaveIndicator extends SigmaTarget<SaveIndicatorEvents, SaveIndicatorState> {
  constructor() {
    super({
      savedCount: 0,
      saving: false,
    });
  }

  async save() {
    this.saving = true;
    this.commit(); // Publish before the async boundary.

    await Promise.resolve();

    this.savedCount += 1;
    this.saving = false;
    this.commit(); // Publish before emitting the event boundary.

    this.emit("saved", { count: this.savedCount });
  }
}

interface SaveIndicator extends SaveIndicatorState {}

const indicator = new SaveIndicator();

const stop = listen(indicator, "saved", ({ count }) => {
  console.log(`Saved ${count} times`);
});

await indicator.save();

console.log(indicator.saving); // false
console.log(indicator.savedCount); // 1

stop();
