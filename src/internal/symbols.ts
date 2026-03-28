export const signalPrefix = "#";

export const sigmaStateBrand = Symbol("sigma.v2.state");
export const sigmaEventsBrand = Symbol("sigma.v2.events");
export const sigmaRefBrand = Symbol("sigma.v2.ref");

export const reservedKeys = new Set(["get", "emit", "commit", "on", "setup"]);
export const sigmaRefs = new WeakSet<object>();
