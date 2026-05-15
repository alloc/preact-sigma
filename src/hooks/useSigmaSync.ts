import { useEffect, useRef } from "preact/hooks";
import { isPlainObject } from "../internal/utils.js";
import type { Protected, Sigma } from "../sigma.js";

type PlainObject = Record<string, unknown>;

function assertStableKeys(cachedKeys: readonly string[], nextKeys: readonly string[]) {
  if (cachedKeys.length !== nextKeys.length || nextKeys.some((key) => !cachedKeys.includes(key))) {
    throw new Error("[preact-sigma] useSigmaSync() input keys must stay stable between renders.");
  }
}

function hasChanged(previous: PlainObject, next: PlainObject, keys: readonly string[]) {
  return keys.some((key) => !Object.is(previous[key], next[key]));
}

/**
 * Synchronizes changed external data into a sigma instance after the initial render.
 *
 * `input` must be a plain object with stable keys. Its values are shallow-compared with
 * `Object.is(...)`, and `sync(...)` runs only after at least one value changes.
 *
 * A changed `instance` resets the baseline input, so newly created component-owned sigma
 * instances can receive their initial external data through construction or setup before
 * later renders synchronize changes through this hook.
 */
export function useSigmaSync<TInstance extends Sigma<any>, TInput extends PlainObject>(
  instance: TInstance | Protected<TInstance>,
  input: TInput,
  sync: (input: Readonly<TInput>) => void,
) {
  if (!isPlainObject(input)) {
    throw new Error("[preact-sigma] useSigmaSync() input must be a plain object.");
  }

  const previousInput = useRef<TInput>(undefined);
  const previousKeys = useRef<string[]>(undefined);
  const previousInstance = useRef<typeof instance>(undefined);

  useEffect(() => {
    const nextKeys = Object.keys(input);

    if (previousInstance.current !== instance) {
      previousInstance.current = instance;
      previousInput.current = input;
      previousKeys.current = nextKeys;
      return;
    }

    assertStableKeys(previousKeys.current!, nextKeys);

    if (hasChanged(previousInput.current!, input, nextKeys)) {
      previousInput.current = input;
      sync(input);
    }
  });
}
