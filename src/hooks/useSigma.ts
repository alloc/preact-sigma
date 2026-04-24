import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Protected, Sigma } from "../sigma.js";

/** Setup arguments and recreation dependencies for `useSigma(...)`. */
export type UseSigmaOptions<TSetup extends readonly any[] = any[]> = {
  /** Arguments passed to the sigma instance's `onSetup(...)` method. */
  setup: TSetup | (() => TSetup);
  /** Dependencies that recreate the sigma instance when they change. */
  deps?: readonly any[];
};

const isArray = Array.isArray as (value: unknown) => value is readonly any[];

/** Infers the accepted `useSigma(...)` call shape from a sigma class and its setup parameters. */
export type UseSigmaArgs<T extends Sigma<any>> = T extends {
  onSetup: (...params: infer TParams) => any;
}
  ? [] extends TParams
    ? [create: () => T, options?: Partial<UseSigmaOptions<TParams>>]
    : [create: () => T, options: UseSigmaOptions<TParams>]
  : [create: () => T, deps?: readonly any[]];

const depsCache = new WeakMap<RefObject<any>, readonly any[] | undefined>();

function depsChanged<T>(container: RefObject<T | null>, deps?: readonly any[]) {
  const cachedDeps = depsCache.get(container);
  if (!deps && !cachedDeps) {
    return false;
  }
  if (!deps || !cachedDeps) {
    return true;
  }
  if (
    deps.length !== cachedDeps.length ||
    deps.some((dep, index) => !Object.is(dep, cachedDeps[index]))
  ) {
    return true;
  }
  return false;
}

/**
 * Creates or reuses a sigma instance for a component and returns its protected consumer view.
 *
 * Classes with `onSetup(...)` run setup in an effect and clean it up on unmount.
 */
export function useSigma<T extends Sigma<any>>(...args: UseSigmaArgs<T>): Protected<T>;
export function useSigma<T extends Sigma<any>>(
  create: () => T,
  optionsOrDeps?: Partial<UseSigmaOptions> | readonly any[],
) {
  // HACK: avoid useMemo so that HMR doesn't recreate the instance
  const container = useRef<Protected<T> | null>(null);

  let setup: Partial<UseSigmaOptions>["setup"];
  let deps: readonly any[] | undefined;

  if (isArray(optionsOrDeps)) {
    deps = optionsOrDeps;
  } else {
    setup = optionsOrDeps?.setup;
    deps = optionsOrDeps?.deps;
  }

  if (!container.current || depsChanged(container, deps)) {
    depsCache.set(container, deps);
    container.current = create().protect();
  }

  const instance = container.current;

  const setupDeps = isArray(setup) ? setup : [];
  useEffect(() => {
    if ("onSetup" in instance) {
      const setupArgs: any = setup ? (isArray(setup) ? setup : setup()) : [];
      return instance.setup(...setupArgs);
    }
  }, [instance, ...setupDeps]);

  return instance;
}
