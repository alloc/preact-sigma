export const signalPrefix = "#";

export const sigmaTypeBrand = Symbol("sigma.type");
export const sigmaStateBrand = Symbol("sigma.state");
export const sigmaEventsBrand = Symbol("sigma.events");
export const sigmaRefBrand = Symbol("sigma.ref");

export const reservedKeys = new Set(["act", "get", "emit", "commit", "on", "setup"]);
