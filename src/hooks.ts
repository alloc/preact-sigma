import type { ReadonlySignal } from "@preact/signals";
import type { Immutable } from "immer";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type {
  AnyManagedState,
  EventsDefinition,
  Lens,
  ManagedState,
  StateConstructor,
  StateHandle,
} from "./framework.ts";
import { defineManagedState } from "./framework.ts";
import { isManagedState } from "./internal.ts";

type FilterProperties<T extends object, U> = {} & {
  [P in {
    [K in keyof T]: [T[K]] extends [never] ? never : T[K] extends U ? K : never;
  }[keyof T]]: T[P];
};

type InferActions<TProps extends object> = {} & FilterProperties<TProps, (...args: any[]) => any>;

type InferManagedStates<TProps extends object> = {} & FilterProperties<TProps, AnyManagedState>;

type InferPublicProps<TProps extends object> = InferActions<TProps> & InferManagedStates<TProps>;

type InferState<TProps extends object> = {} & Immutable<{
  [K in keyof FilterProperties<
    TProps,
    ReadonlySignal | StateHandle<any, any> | Lens
  >]: TProps[K] extends ReadonlySignal<infer T> | StateHandle<infer T> | Lens<infer T> ? T : never;
}> &
  Readonly<InferManagedStates<TProps>>;

function isFunction(value: unknown): value is (...args: any[]) => any {
  return typeof value === "function";
}

/**
 * Clean encapsulation of complex UI state.
 *
 * Use this when a component needs the same managed-state API without defining a
 * separate class. The constructor follows the same rules as
 * `defineManagedState()`, including explicit typing of the `StateHandle`
 * parameter for state and event inference.
 */
export function useManagedState<
  TState,
  TEvents extends EventsDefinition,
  TProps extends object = {},
  TInitialState extends TState = TState,
>(
  constructor: StateConstructor<TState, TEvents, [], TProps>,
  initialState: TInitialState | (() => TInitialState),
): ManagedState<InferState<TProps>, TEvents, InferPublicProps<TProps>> {
  const managedState = useState(
    () =>
      new (defineManagedState(
        constructor,
        isFunction(initialState) ? initialState() : initialState,
      ))(),
  )[0];
  useEffect(() => () => managedState.dispose(), [managedState]);
  return managedState;
}

/**
 * Any subscribable source, including a managed state or any Preact signal.
 */
export type SubscribeTarget<T> = {
  subscribe: (listener: (value: T) => void) => () => void;
};

/**
 * Subscribe to future values from a subscribable source inside `useEffect`.
 *
 * The listener is kept fresh automatically, so a dependency array is not part
 * of this API. The listener receives the current value immediately and then
 * future updates. Pass `null` to disable the subscription temporarily.
 */
export function useSubscribe<T>(
  target: SubscribeTarget<T> | null,
  listener: (value: T) => void,
): void {
  listener = useStableCallback(listener);
  useEffect(() => target?.subscribe(listener), [target]);
}

type InferEvent<T extends EventTarget | AnyManagedState> =
  T extends AnyManagedState<any, infer TEvents extends EventsDefinition>
    ? string & keyof TEvents
    : T extends { addEventListener: (name: infer TEvent) => any }
      ? string & TEvent
      : string;

type InferEventListener<T extends EventTarget | AnyManagedState, TEvent extends string = any> =
  T extends AnyManagedState<any, infer TEvents extends EventsDefinition>
    ? TEvent extends string & keyof TEvents
      ? (...args: TEvents[TEvent]) => void
      : never
    : T extends {
          addEventListener: (
            name: TEvent,
            listener: infer TListener extends (event: any) => any,
          ) => any;
        }
      ? TListener
      : (event: Event) => void;

/**
 * Subscribe to events from an `EventTarget` or managed state inside `useEffect`.
 *
 * The listener is kept fresh automatically, so a dependency array is not part
 * of this API. Pass `null` to disable the subscription temporarily.
 *
 * For managed-state events, your listener receives the emitted argument
 * directly, or no argument at all.
 */
export function useEventTarget<
  T extends EventTarget | AnyManagedState,
  TEvent extends InferEvent<T>,
>(target: T | null, name: TEvent, listener: InferEventListener<T, TEvent>): void {
  listener = useStableCallback(listener) as typeof listener;
  useEffect(() => {
    if (!target) {
      return;
    }
    if (isManagedState(target)) {
      return target.on(name, listener);
    }
    target.addEventListener(name, listener);
    return () => target.removeEventListener(name, listener);
  }, [target, name]);
}

function useStableCallback<TParams extends any[], TResult>(
  callback: (...params: TParams) => TResult,
) {
  const ref = useRef(callback);
  ref.current = callback;

  return useCallback((...params: TParams) => (0, ref.current)(...params), []);
}
