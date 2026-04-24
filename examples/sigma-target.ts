import { listen, SigmaTarget } from "preact-sigma";

type NotificationEvents = {
  saved: {
    id: string;
    title: string;
  };
  reset: void;
};

class Notifications extends SigmaTarget<NotificationEvents> {
  saved(id: string, title: string) {
    this.emit("saved", { id, title });
  }

  reset() {
    this.emit("reset");
  }
}

const notifications = new Notifications();

const stopSaved = listen(notifications, "saved", ({ id, title }) => {
  console.log(`Saved ${id}: ${title}`);
});

const stopReset = listen(notifications, "reset", () => {
  console.log("Reset");
});

notifications.saved("note-1", "Draft post");
notifications.reset();

stopSaved();
stopReset();
