export const signalPrefix = "#";

export const sigmaStateBrand = Symbol("sigma.v2.state");
export const sigmaEventsBrand = Symbol("sigma.v2.events");

export const reservedKeys = new Set(["get", "emit", "commit", "on", "setup"]);
