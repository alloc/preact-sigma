import { useEffect, useRef, useState } from "preact/hooks";
import { InferSetupArgs, shouldSetup, type AnySigmaState } from "./framework.js";
import { InferEventType, listen, type InferListener } from "./listener.js";

export function useSigma<T extends AnySigmaState>(create: () => T, setupArgs?: InferSetupArgs<T>) {
  const sigmaState = useState(create)[0];
  if (shouldSetup(sigmaState)) {
    const args = (setupArgs ?? []) as any[];
    useEffect(() => sigmaState.setup(...args), [sigmaState, ...args]);
  }
  return sigmaState;
}

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
