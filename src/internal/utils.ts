export type AnyFunction = (...args: any[]) => any;

/** Function cleanup returned from setup-owned resources. */
export type Cleanup = () => void;

/** Cleanup resource returned from setup hooks and disposed during teardown. */
export type AnyResource = Cleanup | { dispose(): void } | { [Symbol.dispose](): void };

export function disposeResource(resource: AnyResource) {
  if (typeof resource === "function") {
    resource();
  } else if ("dispose" in resource) {
    resource.dispose();
  } else {
    resource[Symbol.dispose]();
  }
}

export function disposeResources(resources: readonly AnyResource[]) {
  for (let i = resources.length - 1; i >= 0; i--) {
    disposeResource(resources[i]);
  }
}

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
