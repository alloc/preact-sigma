export type AnyFunction = (...args: any[]) => any;

export type Cleanup = () => void;

export type AnyResource = Cleanup | { dispose(): void } | { [Symbol.dispose](): void };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as PromiseLike<unknown>).then === "function";
}
