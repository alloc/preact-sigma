import { useEffect, useRef, useState } from "preact/hooks";
import { shouldSetup } from "./internal/runtime.js";
import type { AnySigmaState, InferSetupArgs } from "./internal/types.js";
import { InferEventType, listen, type InferListener } from "./listener.js";

/** Creates one sigma-state instance for a component and manages its setup cleanup. */
export function useSigma<T extends AnySigmaState>(create: () => T, setupArgs?: InferSetupArgs<T>) {
  const sigmaState = useState(create)[0];
  if (shouldSetup(sigmaState)) {
    const args = (setupArgs ?? []) as any[];
    useEffect(() => sigmaState.setup(...args), [sigmaState, ...args]);
  }
  return sigmaState;
}

/** Attaches an event listener in a component and cleans it up when dependencies change. */
export function useListener<
  TTarget extends EventTarget | AnySigmaState,
  TEvent extends InferEventType<TTarget>,
>(target: TTarget | null, name: TEvent, listener: InferListener<TTarget, TEvent>) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (!target) {
      return;
    }
    return listen(target, name, ((event: any) => listenerRef.current(event)) as any);
  }, [target, name]);
}
