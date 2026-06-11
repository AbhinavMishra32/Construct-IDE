import type { RuntimeInfo } from "./types";

declare global {
  interface Window {
    construct: {
      getRuntimeInfo(): RuntimeInfo;
    };
  }
}

export {};
