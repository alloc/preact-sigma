import type { Cleanup } from "./utils.js";

export type { Cleanup };

export type AnyEvents = Record<string, unknown>;

/** Untyped listener shape stored internally by `SigmaListenerMap`. */
export type RawSigmaListener = (detail: unknown) => void;

/** Listener registry used by sigma targets and sigma states for typed event delivery. */
export class SigmaListenerMap extends Map<string, Set<RawSigmaListener>> {
  /** Delivers one event payload to the current listeners for `name`. */
  emit(name: string, detail: unknown) {
    const listeners = this.get(name);
    if (!listeners?.size) {
      return;
    }
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) {
      listener(detail);
    }
  }

  /** Adds one listener for `name`, creating the listener set on first use. */
  addListener(name: string, listener: RawSigmaListener) {
    let listeners = this.get(name);
    if (!listeners) {
      listeners = new Set();
      this.set(name, listeners);
    }
    listeners.add(listener);
  }

  /** Removes one listener for `name` and prunes the empty listener set. */
  removeListener(name: string, listener: RawSigmaListener) {
    const listeners = this.get(name);
    if (!listeners) {
      return;
    }
    listeners.delete(listener);
    if (!listeners.size) {
      this.delete(name);
    }
  }
}

/** Infers the detail parameter for a typed emit. */
export type EventParameters<T> = [void] extends [T]
  ? [detail?: T extends void ? undefined : T]
  : [undefined] extends [T]
    ? [detail?: T]
    : [detail: T];
