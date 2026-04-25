import { type Cleanup } from "./internal/listener.js";
import { listenersSymbol, typeSymbol } from "./internal/symbols.js";
import { SigmaTarget } from "./sigma.js";

/** Sigma targets and protected sigma target views that carry typed event metadata. */
export type SigmaListenable<TEvents extends object = any> = {
  readonly [typeSymbol]: {
    readonly events: TEvents;
  };
};

/** Target types supported by `listen(...)` and `useListener(...)`. */
export type Listenable = SigmaListenable | EventTarget;

type InferEventMap<TTarget extends Listenable> =
  TTarget extends SigmaListenable<infer TEvents>
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
    ? TTarget extends SigmaListenable<any>
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

/** Adds a listener to a sigma target or DOM target and returns a cleanup function that removes it. */
export function listen<TTarget extends Listenable, TEvent extends InferEventType<TTarget>>(
  target: TTarget,
  name: TEvent,
  listener: InferListener<TTarget, TEvent>,
): Cleanup;

export function listen(target: Listenable, name: string, listener: (...args: any[]) => void) {
  if (target instanceof SigmaTarget) {
    target[listenersSymbol].addListener(name, listener);
    return () => {
      target[listenersSymbol].removeListener(name, listener);
    };
  }
  const eventTarget = target as EventTarget;
  eventTarget.addEventListener(name, listener);
  return () => {
    eventTarget.removeEventListener(name, listener);
  };
}
