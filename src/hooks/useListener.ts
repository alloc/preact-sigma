import { useEffect, useRef } from "preact/hooks";
import { InferEventType, listen, type InferListener, type Listenable } from "../listener.js";

/**
 * Attaches an event listener in a component and cleans it up automatically.
 *
 * Passing `null` disables the listener. The latest callback is used without
 * forcing the effect to resubscribe on every render.
 */
export function useListener<TTarget extends Listenable, TEvent extends InferEventType<TTarget>>(
  target: TTarget | null,
  name: TEvent,
  listener: InferListener<TTarget, TEvent>,
) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (!target) {
      return;
    }
    return listen(target, name, ((event: any) => listenerRef.current(event)) as any);
  }, [target, name]);
}
