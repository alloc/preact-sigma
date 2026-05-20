import { useEffect } from "preact/hooks";
import { disposeResources, type AnyResource } from "../internal/utils.js";

/** Setup callback that returns resources owned by one effect run. */
export type SetupCallback = () => readonly AnyResource[];

/**
 * Runs a component setup effect and disposes returned resources in reverse order.
 *
 * The returned resources use the same cleanup protocol as `Sigma.setup(...)`.
 */
export function useSetup(setup: SetupCallback, deps?: readonly any[]) {
  useEffect(() => {
    const resources = setup();
    return () => disposeResources(resources);
  }, deps);
}
