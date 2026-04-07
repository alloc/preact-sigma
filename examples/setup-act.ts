import { listen, SigmaType } from "preact-sigma";

const ClickTracker = new SigmaType<{
  clicks: number;
  status: "idle" | "ready";
}>("ClickTracker")
  .defaultState({
    clicks: 0,
    status: "idle",
  })
  .setup(function (target: EventTarget) {
    this.act(function () {
      this.status = "ready";
    });

    return [
      listen(target, "click", () => {
        this.act(function () {
          this.clicks += 1;
        });
      }),
    ];
  });

const target = new EventTarget();
const tracker = new ClickTracker();
const cleanup = tracker.setup(target);

target.dispatchEvent(new Event("click"));
target.dispatchEvent(new Event("click"));

console.log(tracker.status, tracker.clicks); // ready 2

cleanup();
