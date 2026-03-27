import type { AnySigmaStateWithEvents } from "./framework";

type TryGet<T, K extends PropertyKey, TCatch = never> = K extends keyof T ? T[K] : TCatch;

type TypedEventListener<TEventMap, TEvent extends string, TCurrentTarget extends EventTarget> = ((
  event: TryGet<TEventMap, string extends TEvent ? keyof TEventMap : TEvent, CustomEvent> & {
    readonly currentTarget: TCurrentTarget;
  },
) => void) & { __eventType?: string extends TEvent ? keyof TEventMap : TEvent };

export type InferEventType<TTarget extends EventTarget> =
  | (InferListener<TTarget> extends { __eventType?: infer TEvent } ? string & TEvent : never)
  | (string & {});

export type InferListener<TTarget extends EventTarget, TEvent extends string = string> =
  TTarget extends AnySigmaStateWithEvents<infer TEvents>
    ? TEvent extends keyof TEvents
      ? (event: TEvents[TEvent]) => void
      : never
    : TTarget extends Window
      ? TypedEventListener<WindowEventMap, TEvent, TTarget>
      : TTarget extends Document
        ? TypedEventListener<DocumentEventMap, TEvent, TTarget>
        : TTarget extends HTMLBodyElement
          ? TypedEventListener<HTMLBodyElementEventMap, TEvent, TTarget>
          : TTarget extends HTMLMediaElement
            ? TypedEventListener<HTMLMediaElementEventMap, TEvent, TTarget>
            : TTarget extends HTMLElement
              ? TypedEventListener<HTMLElementEventMap, TEvent, TTarget>
              : TTarget extends SVGSVGElement
                ? TypedEventListener<SVGSVGElementEventMap, TEvent, TTarget>
                : TTarget extends SVGElement
                  ? TypedEventListener<SVGElementEventMap, TEvent, TTarget>
                  : (event: Event & { readonly currentTarget: TTarget }) => void;

export function listen<TTarget extends EventTarget, TEvent extends InferEventType<TTarget>>(
  target: TTarget,
  name: TEvent,
  listener: InferListener<TTarget, TEvent>,
) {
  target.addEventListener(name, listener as EventListener);
  return () => {
    target.removeEventListener(name, listener as EventListener);
  };
}
