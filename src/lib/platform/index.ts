import type { PlatformAdapter } from "./adapter";

// Conditional imports to avoid bundling Node.js modules in React Native
function detectPlatform(): PlatformAdapter {
  // Heuristics: if navigator and product is ReactNative or global.__DEV__ with RN-specific globals
  // In Node, process.versions.node exists. In RN, it's typically undefined or browser-like.
  // We'll allow manual override via process.env.MAXIM_PLATFORM when available.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis as any;
    const env = (typeof process !== "undefined" && (process as any).env) ? (process as any).env : undefined;
    const forced = env && env.MAXIM_PLATFORM;
    
    if (forced === "react-native") {
      const reactNativeAdapter = require("./reactNative").default;
      return reactNativeAdapter;
    }
    
    if (forced === "node") {
      try {
        const nodeAdapter = require("./node").default;
        return nodeAdapter;
      } catch {
        // Node adapter not available, use React Native as fallback
        const reactNativeAdapter = require("./reactNative").default;
        return reactNativeAdapter;
      }
    }

    const isNode = typeof process !== "undefined" && !!(process as any).versions && !!(process as any).versions.node;
    if (isNode) {
      try {
        const nodeAdapter = require("./node").default;
        return nodeAdapter;
      } catch {
        // Node adapter not available, use React Native as fallback
        const reactNativeAdapter = require("./reactNative").default;
        return reactNativeAdapter;
      }
    }

    // Check for React Native environment
    const isRN = (typeof (globalThis as any).navigator !== "undefined" && (globalThis as any).navigator.product === "ReactNative")
      || !!g.__REACT_NATIVE__
      || !!g.nativeCallSyncHook;
    
    if (isRN) {
      const reactNativeAdapter = require("./reactNative").default;
      return reactNativeAdapter;
    }

    // Default to node in library contexts
    try {
      const nodeAdapter = require("./node").default;
      return nodeAdapter;
    } catch {
      // Node not available, use React Native as fallback
      const reactNativeAdapter = require("./reactNative").default;
      return reactNativeAdapter;
    }
  } catch {
    // If we can't load node (e.g., in bundled environment), try React Native
    try {
      const reactNativeAdapter = require("./reactNative").default;
      return reactNativeAdapter;
    } catch {
      throw new Error("No platform adapter available");
    }
  }
}

export const platform: PlatformAdapter = detectPlatform();
export default platform;


