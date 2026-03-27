import { useState } from "preact/hooks";

import {
  listen,
  query,
  ref,
  SigmaType,
  useListener,
  useSigma,
  type SigmaRef,
} from "preact-sigma";

type Command = {
  id: string;
  title: string;
  keywords: readonly string[];
};

const matchesText = query((command: Command, draft: string) => {
  const needle = draft.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return (
    command.title.toLowerCase().includes(needle) ||
    command.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
  );
});

const SearchHistory = new SigmaType<{
  items: string[];
}>()
  .defaultState({
    items: [],
  })
  .actions({
    remember(query: string) {
      const value = query.trim();
      if (!value) {
        return;
      }

      this.items = [value, ...this.items.filter((item) => item !== value)].slice(0, 5);
    },
  });

type SearchHistory = InstanceType<typeof SearchHistory>;

const CommandPalette = new SigmaType<
  {
    commands: Command[];
    cursor: number;
    draft: string;
    history: SearchHistory;
    usage: SigmaRef<Map<string, number>>;
  },
  {
    ran: Command;
  }
>()
  .defaultState({
    commands: [
      { id: "inbox", title: "Open inbox", keywords: ["mail", "messages", "triage"] },
      { id: "capture", title: "Capture note", keywords: ["write", "quick", "idea"] },
      { id: "focus", title: "Start focus timer", keywords: ["pomodoro", "deep work"] },
      { id: "theme", title: "Toggle theme", keywords: ["appearance", "dark", "light"] },
    ],
    cursor: 0,
    draft: "",
    history: () => new SearchHistory(),
    usage: () => ref(new Map<string, number>()),
  })
  .computed({
    visibleCommands() {
      return this.commands.filter((command) => matchesText(command, this.draft));
    },
    activeCommand() {
      return this.visibleCommands[this.cursor] ?? null;
    },
  })
  .queries({
    canRun() {
      return this.activeCommand !== null;
    },
    usageCount(id: string) {
      return this.usage.get(id) ?? 0;
    },
  })
  .actions({
    setDraft(draft: string) {
      this.draft = draft;
      this.cursor = 0;
    },
    move(step: number) {
      if (this.visibleCommands.length === 0) {
        this.cursor = 0;
        return;
      }

      const lastIndex = this.visibleCommands.length - 1;
      this.cursor = Math.max(0, Math.min(lastIndex, this.cursor + step));
    },
    seedDraftFromHistory() {
      const latest = this.history.items[0];
      if (latest) {
        this.setDraft(latest);
      }
    },
    runActive() {
      const command = this.activeCommand;
      if (!command || !this.canRun()) {
        return;
      }

      this.history.remember(this.draft || command.title);
      this.usage.set(command.id, this.usageCount(command.id) + 1);
      this.emit("ran", command);
      this.draft = "";
      this.cursor = 0;
    },
  })
  .setup(function () {
    return [
      this.history.setup(),
      listen(window, "keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "k") {
          event.preventDefault();
          this.seedDraftFromHistory();
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          this.move(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          this.move(-1);
        } else if (event.key === "Enter") {
          this.runActive();
        }
      }),
    ];
  });

export function Showcase() {
  const palette = useSigma(() => new CommandPalette(), []);
  const [lastRun, setLastRun] = useState<string>("Nothing yet");

  useListener(palette, "ran", (command) => {
    setLastRun(`${command.title} (${palette.usageCount(command.id)} runs)`);
  });

  return (
    <section>
      <p>
        <strong>V2 showcase</strong>: setup-owned keyboard shortcuts, computed getters, tracked
        queries with args, typed events, nested sigma state, and a mutable `ref(Map)`.
      </p>

      <label>
        Search
        <input
          value={palette.draft}
          onInput={(event) => palette.setDraft((event.currentTarget as HTMLInputElement).value)}
          placeholder="Try: note, timer, inbox"
        />
      </label>

      <div>
        <button type="button" onClick={() => palette.move(-1)}>
          Up
        </button>
        <button type="button" onClick={() => palette.move(1)}>
          Down
        </button>
        <button type="button" onClick={() => palette.runActive()} disabled={!palette.canRun()}>
          Run
        </button>
      </div>

      <p>Last run: {lastRun}</p>

      <ul>
        {palette.visibleCommands.map((command, index) => (
          <li key={command.id}>
            <button
              type="button"
              onClick={() => {
                palette.setDraft(command.title);
                palette.runActive();
              }}
              style={{
                fontWeight: index === palette.cursor ? "700" : "400",
              }}
            >
              {command.title} · used {palette.usageCount(command.id)} times
            </button>
          </li>
        ))}
      </ul>

      <p>History: {palette.history.items.join(" / ") || "empty"}</p>
    </section>
  );
}
