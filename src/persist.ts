import type { Immutable } from "./immer.js";
import { isPlainObject } from "./internal/utils.js";
import { sigma, type ReadableSigma, type Sigma } from "./sigma.js";

type MaybePromise<T> = T | Promise<T>;

type MutableObject<T extends object> = {
  -readonly [K in keyof T]: T[K];
};

/** Decode-time context passed to persistence codecs. */
export interface PersistDecodeContext<TState extends object> {
  /** Storage key used to read the record being decoded. */
  key: string;
  /** Version number stored with the record being decoded. */
  storedVersion: number;
  /** Current committed snapshot before the decoded value is applied. */
  baseState: Immutable<TState>;
}

/** Context passed to background write error handlers. */
export interface PersistErrorContext<TState extends object> {
  /** Sigma instance whose state was being persisted. */
  instance: Sigma<TState>;
  /** Storage key used for the failed write. */
  key: string;
}

/** A stored persistence record with version and save-time metadata. */
export interface PersistRecord<TStored = unknown> {
  version: number;
  savedAt: number;
  value: TStored;
}

/** Key-value storage adapter used by persistence helpers. The method names match Keyv and `Map`. */
export interface PersistStore<TStored = unknown> {
  get(key: string): MaybePromise<PersistRecord<TStored> | undefined>;
  set(key: string, record: PersistRecord<TStored>): MaybePromise<unknown>;
  delete(key: string): MaybePromise<unknown>;
}

/** Synchronous storage adapter used by sync restore helpers. */
export interface SyncPersistStore<TStored = unknown> extends PersistStore<TStored> {
  get(key: string): PersistRecord<TStored> | undefined;
  set(key: string, record: PersistRecord<TStored>): unknown;
  delete(key: string): unknown;
}

/** Codec that maps between committed sigma snapshots and stored payloads. */
export interface PersistCodec<TState extends object, TStored = Immutable<TState>> {
  version: number;
  encode(state: Immutable<TState>): TStored;
  decode(stored: unknown, context: PersistDecodeContext<TState>): TState;
}

/** Scheduling policy for persistence writes. */
export type PersistSchedule = "immediate" | "microtask" | { debounceMs: number };

interface PersistLifecycleOptions<TState extends object> {
  /** Storage key used for gets, sets, and deletes. */
  key: string;
  /** Scheduling policy for future writes. Defaults to `"microtask"`. */
  schedule?: PersistSchedule;
  /** Writes the current committed snapshot once after persistence becomes active. */
  writeInitial?: boolean;
  /** Receives background write failures without stopping persistence automatically. */
  onWriteError?: (error: unknown, context: PersistErrorContext<TState>) => void;
}

/** Options shared by restore and persistence helpers. */
export interface PersistOptions<
  TState extends object,
  TStored = Immutable<TState>,
> extends PersistLifecycleOptions<TState> {
  /** Store adapter that owns persistence I/O for stored records. */
  store: PersistStore<TStored>;
  /** Codec that maps committed snapshots to stored payloads. Defaults to an identity codec with version 1. */
  codec?: PersistCodec<TState, TStored>;
  pick?: never;
}

/** Options that persist selected top-level state keys without a custom codec. */
export interface PickPersistOptions<
  TState extends object,
  TKey extends keyof TState = keyof TState,
> extends PersistLifecycleOptions<TState> {
  /** Store adapter that owns persistence I/O for the selected top-level keys. */
  store: PersistStore<Pick<TState, TKey>>;
  /** Top-level state keys to persist and restore from the current base snapshot. */
  pick: readonly TKey[];
  codec?: never;
}

/** Options that require a synchronous store. */
export interface SyncPersistOptions<
  TState extends object,
  TStored = Immutable<TState>,
> extends PersistOptions<TState, TStored> {
  store: SyncPersistStore<TStored>;
}

/** Pick-based options that require a synchronous store. */
export interface SyncPickPersistOptions<
  TState extends object,
  TKey extends keyof TState = keyof TState,
> extends PickPersistOptions<TState, TKey> {
  store: SyncPersistStore<Pick<TState, TKey>>;
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
  /** Waits for any scheduled or active write for this binding to finish. */
  flush(): Promise<void>;
  /** Removes the stored record and keeps the binding active for later writes. */
  clear(): Promise<void>;
  /** Stops future persistence and waits for any active write to settle. */
  stop(): Promise<void>;
}

/** Async restore-plus-persist handle. */
export interface HydrationHandle extends PersistenceHandle {
  /** Resolves when restore finishes and reports whether a record was applied. */
  readonly restored: Promise<RestoreResult>;
}

/** Sync restore-plus-persist handle. */
export interface SyncHydrationHandle extends PersistenceHandle {
  /** Reports the synchronous restore result that ran before persistence started. */
  readonly restored: RestoreResult;
}

function createIdentityCodec<TState extends object>(): PersistCodec<TState> {
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

function createPickCodec<TState extends object, TKey extends keyof TState>(
  keys: readonly TKey[],
): PersistCodec<TState, Pick<TState, TKey>> {
  return {
    version: 1,
    encode(state) {
      const stored = {} as Pick<TState, TKey>;
      for (const key of keys) {
        stored[key] = (state as TState)[key];
      }
      return stored;
    },
    decode(stored, context) {
      if (!isPlainObject(stored)) {
        throw new Error("[preact-sigma/persist] pick requires a plain object payload");
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

type AnyPersistOptions<TState extends object, TStored = Immutable<TState>> =
  | PersistOptions<TState, TStored>
  | PickPersistOptions<TState, keyof TState>;

type AnySyncPersistOptions<TState extends object, TStored = Immutable<TState>> =
  | SyncPersistOptions<TState, TStored>
  | SyncPickPersistOptions<TState, keyof TState>;

function getCodec<TState extends object, TStored>(
  options: AnyPersistOptions<TState, TStored>,
): PersistCodec<TState, TStored> {
  if (options.codec) {
    return options.codec;
  }
  if (options.pick) {
    return createPickCodec(options.pick) as PersistCodec<TState, TStored>;
  }
  return createIdentityCodec<TState>() as PersistCodec<TState, TStored>;
}

function applyRecord<TState extends object, TStored>(
  instance: ReadableSigma<TState>,
  key: string,
  record: PersistRecord<TStored> | undefined,
  codec: PersistCodec<TState, TStored>,
): RestoreResult {
  if (!record) {
    return { status: "missing" };
  }

  const baseState = sigma.captureState(instance as Sigma<TState>);
  const nextState = codec.decode(record.value, {
    baseState,
    key,
    storedVersion: record.version,
  });

  sigma.replaceState(instance as Sigma<TState>, nextState);

  return {
    status: "restored",
    savedAt: record.savedAt,
    storedVersion: record.version,
  };
}

/** Restores committed state from a persisted record through an async store. */
export async function restore<TState extends object, TKey extends keyof TState>(
  instance: ReadableSigma<TState>,
  options: PickPersistOptions<TState, TKey>,
): Promise<RestoreResult>;
export async function restore<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: PersistOptions<TState, TStored>,
): Promise<RestoreResult>;
export async function restore<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: AnyPersistOptions<TState, TStored>,
): Promise<RestoreResult> {
  const codec = getCodec(options);
  const record = (await options.store.get(options.key)) as PersistRecord<TStored> | undefined;
  return applyRecord(instance, options.key, record, codec);
}

/** Restores committed state from a persisted record through a sync store. */
export function restoreSync<TState extends object, TKey extends keyof TState>(
  instance: ReadableSigma<TState>,
  options: SyncPickPersistOptions<TState, TKey>,
): RestoreResult;
export function restoreSync<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: SyncPersistOptions<TState, TStored>,
): RestoreResult;
export function restoreSync<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: AnySyncPersistOptions<TState, TStored>,
): RestoreResult {
  const codec = getCodec(options);
  const record = options.store.get(options.key) as PersistRecord<TStored> | undefined;
  return applyRecord(instance, options.key, record, codec);
}

/** Persists future committed state changes for one sigma instance. */
export function persist<TState extends object, TKey extends keyof TState>(
  instance: ReadableSigma<TState>,
  options: PickPersistOptions<TState, TKey>,
): PersistenceHandle;
export function persist<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: PersistOptions<TState, TStored>,
): PersistenceHandle;
export function persist<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: AnyPersistOptions<TState, TStored>,
): PersistenceHandle {
  const codec = getCodec(options);
  const schedule = options.schedule ?? "microtask";
  const key = options.key;
  const store = options.store as PersistStore<TStored>;

  let stopped = false;
  let suspended = false;
  let hasPendingState = false;
  let pendingState: Immutable<TState> | undefined;
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

  const createRecord = (state: Immutable<TState>): PersistRecord<TStored> => ({
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
          instance: instance as Sigma<TState>,
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
    pendingState = sigma.captureState(instance as Sigma<TState>);
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
        const state = pendingState!;
        hasPendingState = false;
        await store.set(key, createRecord(state));
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

  const stopSubscription = sigma.subscribe(instance as Sigma<TState>, queueStateWrite);

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
        await store.delete(key);
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
export function hydrate<TState extends object, TKey extends keyof TState>(
  instance: ReadableSigma<TState>,
  options: PickPersistOptions<TState, TKey>,
): HydrationHandle;
export function hydrate<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: PersistOptions<TState, TStored>,
): HydrationHandle;
export function hydrate<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: AnyPersistOptions<TState, TStored>,
): HydrationHandle {
  let stopped = false;
  let handle: PersistenceHandle | undefined;

  const restored = (async () => {
    const result = await restore(instance, options as PersistOptions<TState, TStored>);
    if (!stopped) {
      handle = persist(instance, options as PersistOptions<TState, TStored>);
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
        await options.store.delete(options.key);
        return;
      }

      if (handle) {
        await handle.clear();
        return;
      }
      await options.store.delete(options.key);
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
export function hydrateSync<TState extends object, TKey extends keyof TState>(
  instance: ReadableSigma<TState>,
  options: SyncPickPersistOptions<TState, TKey>,
): SyncHydrationHandle;
export function hydrateSync<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: SyncPersistOptions<TState, TStored>,
): SyncHydrationHandle;
export function hydrateSync<TState extends object, TStored = Immutable<TState>>(
  instance: ReadableSigma<TState>,
  options: AnySyncPersistOptions<TState, TStored>,
): SyncHydrationHandle {
  const restored = restoreSync(instance, options as SyncPersistOptions<TState, TStored>);
  const handle = persist(instance, options as PersistOptions<TState, TStored>);
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
