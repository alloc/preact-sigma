import { sigmaEventsBrand, sigmaTargetBrand } from "./internal/symbols.js";
import type { AnyEvents, Cleanup } from "./internal/types.js";

/** Structural event-target shape used by `listen(...)` for sigma targets and sigma states. */
export type SigmaTargetLike = {
  readonly [sigmaTargetBrand]: SigmaListenerMap;
};

/** Target types supported by `listen(...)` and `useListener(...)`. */
export type Listenable = SigmaTargetLike | EventTarget;

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

type InferEventMap<TTarget extends Listenable> = TTarget extends {
  [sigmaEventsBrand]: infer TEvents extends AnyEvents;
}
  ? TEvents
  : TTarget extends Window
    ? WindowEventMap
    : TTarget extends Document
      ? DocumentEventMap
      : TTarget extends HTMLBodyElement
        ? HTMLBodyElementEventMap
        : TTarget extends HTMLMediaElement
          ? HTMLMediaElementEventMap
          : TTarget extends HTMLElement
            ? HTMLElementEventMap
            : TTarget extends SVGSVGElement
              ? SVGSVGElementEventMap
              : TTarget extends SVGElement
                ? SVGElementEventMap
                : TTarget extends EventTarget
                  ? Record<string, Event>
                  : never;

type InferListenerArgs<
  TEvents extends object,
  TTarget extends Listenable,
  TEvent extends string,
> = [
  (TEvent extends keyof TEvents ? TEvents[TEvent] : never) extends infer TPayload
    ? TTarget extends SigmaTargetLike
      ? [TPayload] extends [never]
        ? never
        : [TPayload] extends [void]
          ? undefined
          : TPayload
      : ([TPayload] extends [never] ? CustomEvent : Extract<TPayload, Event>) & {
          readonly currentTarget: TTarget;
        }
    : never,
];

/** Infers the listener callback shape for a target and event name. Sigma targets receive payloads directly, while DOM targets receive typed events. */
export type InferListener<TTarget extends Listenable, TEvent extends string = string> =
  InferEventMap<TTarget> extends infer TEvents extends object
    ? ((...args: InferListenerArgs<TEvents, TTarget, TEvent>) => void) & { __eventType?: TEvent }
    : never;

/** Infers the event names accepted by `listen(...)` or `useListener(...)` for a target. */
export type InferEventType<TTarget extends Listenable> =
  | (InferListener<TTarget> extends { __eventType?: infer TEvent } ? string & TEvent : never)
  | (string & {});

/** Infers the detail parameter for a typed emit. */
export type EventParameters<T> = [void] extends [T]
  ? [detail?: T extends void ? undefined : T]
  : [undefined] extends [T]
    ? [detail?: T]
    : [detail: T];

/**
 * A standalone typed event hub with `emit(...)` and `on(...)` methods.
 *
 * `SigmaTarget` also works with `listen(...)` and `useListener(...)`.
 */
export class SigmaTarget<TEvents extends AnyEvents = {}> {
  declare readonly [sigmaEventsBrand]: TEvents;
  readonly [sigmaTargetBrand] = new SigmaListenerMap();

  /**
   * Emits a typed event from the hub.
   *
   * Void events notify listeners with `undefined`. Payload events pass their
   * payload directly to listeners.
   */
  emit<TEvent extends string & keyof TEvents>(
    name: TEvent,
    ...[detail]: EventParameters<TEvents[TEvent]>
  ) {
    this[sigmaTargetBrand].emit(name, detail);
  }

  /**
   * Registers a typed event listener and returns an unsubscribe function.
   *
   * Payload events pass their payload directly to the listener. Void events
   * call the listener with no arguments.
   */
  on<TEvent extends string & keyof TEvents>(
    name: TEvent,
    listener: (...args: InferListenerArgs<TEvents, this, TEvent>) => void,
  ) {
    this[sigmaTargetBrand].addListener(name, listener as RawSigmaListener);
    return () => {
      this[sigmaTargetBrand].removeListener(name, listener as RawSigmaListener);
    };
  }
}

/** Adds a listener to a sigma target or DOM target and returns a cleanup function that removes it. */
export function listen<TTarget extends Listenable, TEvent extends InferEventType<TTarget>>(
  target: TTarget,
  name: TEvent,
  listener: InferListener<TTarget, TEvent>,
): Cleanup;

export function listen(target: Listenable, name: string, listener: (event: unknown) => void) {
  if (Object.hasOwn(target, sigmaTargetBrand)) {
    const sigmaTarget = target as SigmaTargetLike;
    sigmaTarget[sigmaTargetBrand].addListener(name, listener);
    return () => {
      sigmaTarget[sigmaTargetBrand].removeListener(name, listener);
    };
  }

  const eventTarget = target as EventTarget;
  const eventListener = listener as EventListener;
  eventTarget.addEventListener(name, eventListener);
  return () => {
    eventTarget.removeEventListener(name, eventListener);
  };
}
