import { useState } from "preact/hooks";

import { listen, query, Sigma, SigmaTarget, useListener, useSigma } from "preact-sigma";

type Command = {
  id: string;
  title: string;
  keywords: readonly string[];
};

class UsageLedger {
  #counts = new Map<string, number>();

  get(id: string) {
    return this.#counts.get(id) ?? 0;
  }

  increment(id: string) {
    this.#counts.set(id, this.get(id) + 1);
  }
}

function matchesText(command: Command, draft: string) {
  const needle = draft.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return (
    command.title.toLowerCase().includes(needle) ||
    command.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
  );
}

type SearchHistoryState = {
  items: string[];
};

class SearchHistory extends Sigma<SearchHistoryState> {
  constructor() {
    super({
      items: [],
    });
  }

  remember(query: string) {
    const value = query.trim();
    if (!value) {
      return;
    }

    this.items = [value, ...this.items.filter((item) => item !== value)].slice(0, 5);
  }
}

interface SearchHistory extends SearchHistoryState {}

type CommandPaletteState = {
  commands: Command[];
  cursor: number;
  draft: string;
  history: SearchHistory;
  usage: UsageLedger;
};

type CommandPaletteEvents = {
  ran: Command;
};

class CommandPalette extends SigmaTarget<CommandPaletteEvents, CommandPaletteState> {
  constructor() {
    super({
      commands: [
        { id: "inbox", title: "Open inbox", keywords: ["mail", "messages", "triage"] },
        { id: "capture", title: "Capture note", keywords: ["write", "quick", "idea"] },
        { id: "focus", title: "Start focus timer", keywords: ["pomodoro", "deep work"] },
        { id: "theme", title: "Toggle theme", keywords: ["appearance", "dark", "light"] },
      ],
      cursor: 0,
      draft: "",
      history: new SearchHistory(),
      usage: new UsageLedger(),
    });
  }

  get visibleCommands() {
    return this.commands.filter((command) => matchesText(command, this.draft));
  }

  get activeCommand() {
    return this.visibleCommands[this.cursor] ?? null;
  }

  get canRun() {
    return this.activeCommand !== null;
  }

  @query
  usageCount(id: string) {
    return this.usage.get(id);
  }

  setDraft(draft: string) {
    this.draft = draft;
    this.cursor = 0;
  }

  move(step: number) {
    if (this.visibleCommands.length === 0) {
      this.cursor = 0;
      return;
    }

    const lastIndex = this.visibleCommands.length - 1;
    this.cursor = Math.max(0, Math.min(lastIndex, this.cursor + step));
  }

  seedDraftFromHistory() {
    const latest = this.history.items[0];
    if (latest) {
      this.setDraft(latest);
    }
  }

  runActive() {
    const command = this.activeCommand;
    if (!command) {
      return;
    }

    const search = this.draft || command.title;
    this.usage.increment(command.id);
    this.draft = "";
    this.cursor = 0;
    this.commit();

    this.history.remember(search);
    this.emit("ran", command);
  }

  onSetup() {
    return [
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
  }
}

interface CommandPalette extends CommandPaletteState {}

export function CommandPaletteExample() {
  const [instance] = useState(() => new CommandPalette());
  const palette = useSigma(() => instance);
  const [lastRun, setLastRun] = useState<string>("Nothing yet");

  useListener(instance, "ran", (command) => {
    setLastRun(`${command.title} (${palette.usageCount(command.id)} runs)`);
  });

  return (
    <section>
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
        <button type="button" onClick={() => palette.runActive()} disabled={!palette.canRun}>
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
