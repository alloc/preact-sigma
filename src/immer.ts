// Copied from: node_modules/.pnpm/immer@11.1.4/node_modules/immer/dist/immer.d.ts
// Adapted to skip SigmaRef and SigmaStateLike types.
import type { AnySigmaState, SigmaRef } from "./framework";

type PrimitiveType = number | string | boolean;

/** Object types that should never be mapped */
type AtomicObject =
  | Function
  | Promise<any>
  | Date
  | RegExp
  | EventTarget
  | AnySigmaState
  | SigmaRef;

/**
 * If the lib "ES2015.Collection" is not included in tsconfig.json,
 * types like ReadonlyArray, WeakMap etc. fall back to `any` (specified nowhere)
 * or `{}` (from the node types), in both cases entering an infinite recursion in
 * pattern matching type mappings
 * This type can be used to cast these types to `void` in these cases.
 */
type IfAvailable<T, Fallback = void> = true | false extends (T extends never ? true : false)
  ? Fallback
  : keyof T extends never
    ? Fallback
    : T;

/**
 * These should also never be mapped but must be tested after regular Map and
 * Set
 */
type WeakReferences = IfAvailable<WeakMap<any, any>> | IfAvailable<WeakSet<any>>;

type WritableDraft<T> = T extends any[]
  ? number extends T["length"]
    ? Draft<T[number]>[]
    : WritableNonArrayDraft<T>
  : WritableNonArrayDraft<T>;

type WritableNonArrayDraft<T> = {
  -readonly [K in keyof T]: T[K] extends infer V ? (V extends object ? Draft<V> : V) : never;
};

/**
 * Convert a readonly type into a mutable type, if possible.
 *
 * Use this instead of `immer.Draft`
 */
export type Draft<T> = T extends PrimitiveType
  ? T
  : T extends AtomicObject
    ? T
    : T extends ReadonlyMap<infer K, infer V>
      ? Map<Draft<K>, Draft<V>>
      : T extends ReadonlySet<infer V>
        ? Set<Draft<V>>
        : T extends WeakReferences
          ? T
          : T extends object
            ? WritableDraft<T>
            : T;

/**
 * Convert a mutable type into a readonly type.
 *
 * Use this instead of `immer.Immutable`
 */
export type Immutable<T> = T extends PrimitiveType
  ? T
  : T extends AtomicObject
    ? T
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<Immutable<K>, Immutable<V>>
      : T extends ReadonlySet<infer V>
        ? ReadonlySet<Immutable<V>>
        : T extends WeakReferences
          ? T
          : T extends object
            ? {
                readonly [K in keyof T]: Immutable<T[K]>;
              }
            : T;
