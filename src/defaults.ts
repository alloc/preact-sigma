/**
 * Shallowly applies defined initial values over a defaults object.
 *
 * `undefined` initial values leave their matching default value in place.
 */
export function mergeDefaults<T extends object>(initial: Partial<T> | undefined, defaults: T): T {
  if (!initial) {
    return defaults;
  }
  const merged = { ...defaults };
  for (const key in initial) {
    if (initial[key] !== undefined) {
      merged[key] = initial[key];
    }
  }
  return merged;
}
