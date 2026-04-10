import { isSigmaState } from "./framework.js";
import { sigmaEventsBrand } from "./internal/symbols.js";
import type { AnyEvents } from "./internal/types.js";

type InferEventMap<TTarget extends EventTarget> = TTarget extends {
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
                : never;

type InferListenerArgs<
  TEvents extends object,
  TTarget extends EventTarget,
  TEvent extends string,
> = [
  (TEvent extends keyof TEvents ? TEvents[TEvent] : never) extends infer TPayload
    ? TTarget extends { [sigmaEventsBrand]: TEvents }
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

/** Infers the listener callback shape for a target and event name. Sigma states receive payloads directly, while DOM targets receive typed events. */
export type InferListener<TTarget extends EventTarget, TEvent extends string = string> =
  InferEventMap<TTarget> extends infer TEvents extends object
    ? ((...args: InferListenerArgs<TEvents, TTarget, TEvent>) => void) & { __eventType?: TEvent }
    : never;

/** Infers the event names accepted by `listen(...)` or `useListener(...)` for a target. */
export type InferEventType<TTarget extends EventTarget> =
  | (InferListener<TTarget> extends { __eventType?: infer TEvent } ? string & TEvent : never)
  | (string & {});

/**
 * A standalone typed event hub with `emit(...)` and `on(...)` methods and full
 * `EventTarget`, `listen(...)`, and `useListener(...)` compatibility.
 */
export class SigmaTarget<TEvents extends AnyEvents = {}> extends EventTarget {
  declare readonly [sigmaEventsBrand]: TEvents;

  /**
   * Emits a typed event from the hub.
   *
   * Void events dispatch a plain `Event`. Payload events dispatch a
   * `CustomEvent` whose `detail` holds the payload.
   */
  emit<TEvent extends string & keyof TEvents>(
    name: TEvent,
    ...args: [TEvents[TEvent]] extends [void] ? [] : [payload: TEvents[TEvent]]
  ) {
    this.dispatchEvent(
      args.length === 0 ? new Event(name) : new CustomEvent(name, { detail: args[0] }),
    );
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
    const adapter: EventListener = (event) =>
      // @ts-expect-error
      listener(event.detail);

    this.addEventListener(name, adapter);
    return () => {
      this.removeEventListener(name, adapter);
    };
  }
}

/** Adds a listener to a sigma state or DOM target and returns a cleanup function that removes it. */
export function listen<TTarget extends EventTarget, TEvent extends InferEventType<TTarget>>(
  target: TTarget,
  name: TEvent,
  listener: InferListener<TTarget, TEvent>,
) {
  const adapter: EventListener =
    isSigmaState(target) || target instanceof SigmaTarget
      ? (event) =>
          // @ts-expect-error
          listener(event.detail)
      : // @ts-expect-error
        (listener as EventListener);

  target.addEventListener(name, adapter);
  return () => {
    target.removeEventListener(name, adapter);
  };
}
