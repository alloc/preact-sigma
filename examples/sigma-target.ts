import { listen, SigmaTarget } from "preact-sigma";

const notifications = new SigmaTarget<{
  saved: {
    id: string;
    title: string;
  };
  reset: void;
}>();

const stopSaved = notifications.on("saved", ({ id, title }) => {
  console.log(`Saved ${id}: ${title}`);
});

const stopReset = listen(notifications, "reset", () => {
  console.log("Reset");
});

notifications.emit("saved", {
  id: "note-1",
  title: "Draft post",
});
notifications.emit("reset");

stopSaved();
stopReset();
