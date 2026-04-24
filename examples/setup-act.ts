import { listen, Sigma } from "preact-sigma";

type ClickTrackerState = {
  clicks: number;
  status: "idle" | "ready";
};

class ClickTracker extends Sigma<ClickTrackerState> {
  constructor() {
    super({
      clicks: 0,
      status: "idle",
    });
  }

  onSetup(target: EventTarget) {
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
  }
}

interface ClickTracker extends ClickTrackerState {}

const target = new EventTarget();
const tracker = new ClickTracker();
const cleanup = tracker.setup(target);

target.dispatchEvent(new Event("click"));
target.dispatchEvent(new Event("click"));

console.log(tracker.status, tracker.clicks); // ready 2

cleanup();
