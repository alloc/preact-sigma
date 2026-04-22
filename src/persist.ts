import { sigma } from "./internal/runtime.js";
import type { Immutable } from "./immer.js";
import type { InferSigmaStateDefinition, SigmaDefinition, SigmaState } from "./internal/types.js";

type MaybePromise<T> = T | Promise<T>;
type SnapshotOf<T extends SigmaState<any>> =
  T extends SigmaState<infer TDefinition extends SigmaDefinition>
    ? Immutable<TDefinition["state"]>
    : never;
type MutableObject<T extends object> = {
  -readonly [K in keyof T]: T[K];
};

type CodecContext<TState extends object> = {
  key: string;
  storedVersion: number;
  baseState: Readonly<TState>;
};

/** A stored persistence record with version and save-time metadata. */
export interface PersistRecord<TStored = unknown> {
  version: number;
  savedAt: number;
  value: TStored;
}

/** Storage adapter used by persistence helpers. */
export interface PersistStore<TRecord> {
  read(key: string): MaybePromise<TRecord | undefined>;
  write(key: string, record: TRecord): MaybePromise<void>;
  remove(key: string): MaybePromise<void>;
}

/** Synchronous storage adapter used by sync restore helpers. */
export interface SyncPersistStore<TRecord> extends PersistStore<TRecord> {
  read(key: string): TRecord | undefined;
  write(key: string, record: TRecord): void;
  remove(key: string): void;
}

/** Codec that maps between in-memory sigma state and stored payloads. */
export interface PersistCodec<TState extends object, TStored = TState> {
  version: number;
  encode(state: Readonly<TState>): TStored;
  decode(stored: unknown, context: CodecContext<TState>): TState;
}

/** Scheduling policy for persistence writes. */
export type PersistSchedule = "immediate" | "microtask" | { debounceMs: number };

/** Options shared by restore and persistence helpers. */
export interface PersistOptions<T extends SigmaState<any>, TStored = SnapshotOf<T>> {
  key: string;
  store: PersistStore<PersistRecord<TStored>>;
  codec?: PersistCodec<SnapshotOf<T>, TStored>;
  schedule?: PersistSchedule;
  writeInitial?: boolean;
  onWriteError?: (
    error: unknown,
    context: {
      instance: T;
      key: string;
    },
  ) => void;
}

/** Options that require a synchronous store. */
export interface SyncPersistOptions<T extends SigmaState<any>, TStored = SnapshotOf<T>>
  extends PersistOptions<T, TStored> {
  store: SyncPersistStore<PersistRecord<TStored>>;
}

/** Result returned by restore helpers. */
export type RestoreResult =
  | { status: "missing" }
  | {
      status: "restored";
      savedAt: number;
      storedVersion: number;
    };

/** Handle returned by persistence bindings. */
export interface PersistenceHandle {
  flush(): Promise<void>;
  clear(): Promise<void>;
  stop(): Promise<void>;
}

/** Async restore-plus-persist binding result. */
export interface BoundPersistence extends PersistenceHandle {
  readonly restored: Promise<RestoreResult>;
}

/** Sync restore-plus-persist binding result. */
export interface SyncBoundPersistence extends PersistenceHandle {
  readonly restored: RestoreResult;
}

function createIdentityCodec<TState extends object>(): PersistCodec<TState, TState> {
  return {
    version: 1,
    encode(state) {
      return state;
    },
    decode(stored) {
      return stored as TState;
    },
  };
}

function getCodec<T extends SigmaState<any>, TStored>(
  options: PersistOptions<T, TStored>,
): PersistCodec<SnapshotOf<T>, TStored> {
  return (options.codec ?? createIdentityCodec<SnapshotOf<T>>()) as PersistCodec<
    SnapshotOf<T>,
    TStored
  >;
}

function applyRecord<T extends SigmaState<any>, TStored>(
  instance: T,
  key: string,
  record: PersistRecord<TStored> | undefined,
  codec: PersistCodec<SnapshotOf<T>, TStored>,
): RestoreResult {
  if (!record) {
    return { status: "missing" };
  }

  const baseState = sigma.getState(instance) as SnapshotOf<T>;
  const nextState = codec.decode(record.value, {
    baseState,
    key,
    storedVersion: record.version,
  });

  sigma.replaceState(instance, nextState as Immutable<InferSigmaStateDefinition<T>["state"]>);

  return {
    status: "restored",
    savedAt: record.savedAt,
    storedVersion: record.version,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export async function restoreState<T extends SigmaState<any>, TStored = SnapshotOf<T>>(
  instance: T,
  options: PersistOptions<T, TStored>,
): Promise<RestoreResult> {
  const codec = getCodec(options);
  const record = await options.store.read(options.key);
  return applyRecord(instance, options.key, record, codec);
}

/** Restores committed state from a persisted record through a sync store. */
export function restoreStateSync<T extends SigmaState<any>, TStored = SnapshotOf<T>>(
  instance: T,
  options: SyncPersistOptions<T, TStored>,
): RestoreResult {
  const codec = getCodec(options);
  const record = options.store.read(options.key);
  return applyRecord(instance, options.key, record, codec);
}

/** Creates a codec that persists selected top-level state keys and reconstructs a full snapshot on decode. */
export function pickStateCodec<TState extends object, TKey extends keyof TState>(
  keys: readonly TKey[],
): PersistCodec<TState, Pick<TState, TKey>> {
  return {
    version: 1,
    encode(state) {
      const stored = {} as Pick<TState, TKey>;
      for (const key of keys) {
        stored[key] = state[key];
      }
      return stored;
    },
    decode(stored, context) {
      if (!isPlainObject(stored)) {
        throw new Error("[preact-sigma/persist] pickStateCodec() requires a plain object payload");
      }

      const partialStored = stored as Partial<Record<TKey, TState[TKey]>>;
      const restored = {
        ...context.baseState,
      } as MutableObject<TState>;
      for (const key of keys) {
        if (key in partialStored) {
          restored[key] = partialStored[key] as TState[TKey];
        }
      }
      return restored as TState;
    },
  };
}

/** Persists future committed state changes for one sigma-state instance. */
export function persistState<T extends SigmaState<any>, TStored = SnapshotOf<T>>(
  instance: T,
  options: PersistOptions<T, TStored>,
): PersistenceHandle {
  const codec = getCodec(options);
  const schedule = options.schedule ?? "microtask";
  const key = options.key;

  let stopped = false;
  let suspended = false;
  let hasPendingState = false;
  let pendingState: SnapshotOf<T> | undefined;
  let microtaskScheduled = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let runningWrite: Promise<void> | undefined;
  let backgroundWrite: Promise<void> | undefined;

  const cancelScheduledWrite = () => {
    microtaskScheduled = false;
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  };

  const createRecord = (state: SnapshotOf<T>): PersistRecord<TStored> => ({
    version: codec.version,
    savedAt: Date.now(),
    value: codec.encode(state),
  });

  const startBackgroundWrite = () => {
    if (backgroundWrite) {
      return;
    }
    backgroundWrite = drainPendingWrites()
      .catch((error) => {
        options.onWriteError?.(error, {
          instance,
          key,
        });
      })
      .finally(() => {
        backgroundWrite = undefined;
      });
  };

  const scheduleWrite = () => {
    if (stopped || suspended) {
      return;
    }
    if (schedule === "immediate") {
      startBackgroundWrite();
      return;
    }
    if (schedule === "microtask") {
      if (microtaskScheduled) {
        return;
      }
      microtaskScheduled = true;
      queueMicrotask(() => {
        microtaskScheduled = false;
        if (stopped || suspended) {
          return;
        }
        startBackgroundWrite();
      });
      return;
    }

    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      if (stopped || suspended) {
        return;
      }
      startBackgroundWrite();
    }, schedule.debounceMs);
  };

  const queueStateWrite = () => {
    pendingState = sigma.getState(instance) as SnapshotOf<T>;
    hasPendingState = true;
    scheduleWrite();
  };

  async function drainPendingWrites() {
    if (runningWrite) {
      return runningWrite;
    }

    cancelScheduledWrite();
    runningWrite = (async () => {
      while (hasPendingState && !stopped && !suspended) {
        const state = pendingState as SnapshotOf<T>;
        hasPendingState = false;
        await options.store.write(key, createRecord(state));
      }
    })();

    try {
      await runningWrite;
    } finally {
      runningWrite = undefined;
      if (hasPendingState && !stopped && !suspended) {
        startBackgroundWrite();
      }
    }
  }

  const stopSubscription = sigma.subscribe(instance, () => {
    queueStateWrite();
  });

  if (options.writeInitial) {
    queueStateWrite();
  }

  return {
    async flush() {
      cancelScheduledWrite();
      if (!hasPendingState) {
        await runningWrite;
        return;
      }
      await drainPendingWrites();
    },

    async clear() {
      suspended = true;
      cancelScheduledWrite();
      hasPendingState = false;
      pendingState = undefined;

      try {
        await runningWrite;
        await options.store.remove(key);
      } finally {
        suspended = false;
        if (hasPendingState && !stopped) {
          scheduleWrite();
        }
      }
    },

    async stop() {
      if (stopped) {
        await runningWrite;
        return;
      }

      stopped = true;
      suspended = true;
      stopSubscription();
      cancelScheduledWrite();
      hasPendingState = false;
      pendingState = undefined;
      await runningWrite;
    },
  };
}

/** Restores state, then begins persisting future committed changes. */
export function bindPersistence<T extends SigmaState<any>, TStored = SnapshotOf<T>>(
  instance: T,
  options: PersistOptions<T, TStored>,
): BoundPersistence {
  let stopped = false;
  let handle: PersistenceHandle | undefined;

  const restored = (async () => {
    const result = await restoreState(instance, options);
    if (!stopped) {
      handle = persistState(instance, options);
    }
    return result;
  })();

  return {
    restored,

    async flush() {
      await restored;
      await handle?.flush();
    },

    async clear() {
      try {
        await restored;
      } catch {
        await options.store.remove(options.key);
        return;
      }

      if (handle) {
        await handle.clear();
        return;
      }
      await options.store.remove(options.key);
    },

    async stop() {
      if (stopped) {
        await handle?.stop();
        return;
      }

      stopped = true;

      try {
        await restored;
      } catch {
        return;
      }

      await handle?.stop();
    },
  };
}

/** Restores state synchronously, then begins persisting future committed changes. */
export function bindPersistenceSync<T extends SigmaState<any>, TStored = SnapshotOf<T>>(
  instance: T,
  options: SyncPersistOptions<T, TStored>,
): SyncBoundPersistence {
  const restored = restoreStateSync(instance, options);
  const handle = persistState(instance, options);
  return {
    restored,
    clear() {
      return handle.clear();
    },
    flush() {
      return handle.flush();
    },
    stop() {
      return handle.stop();
    },
  };
}
