import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Protected, Sigma } from "../sigma.js";

export type UseSigmaOptions<TSetup extends readonly any[] = any[]> = {
  setup: TSetup | (() => TSetup);
  deps?: readonly any[];
};

const isArray = Array.isArray as (value: unknown) => value is readonly any[];

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
    return true;
  }
  if (
    deps &&
    cachedDeps &&
    (deps.length !== cachedDeps.length ||
      deps.some((dep, index) => !Object.is(dep, cachedDeps[index])))
  ) {
    return true;
  }
  return false;
}

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
