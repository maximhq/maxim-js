import type { PlatformAdapter } from "./adapter";

// Conditional imports to avoid bundling Node.js modules in React Native
function detectPlatform(): PlatformAdapter {
  // Dynamic platform detection based on availability of Node.js modules
  // Try to detect Node.js environment by attempting to access Node.js modules
  // If they fail, fallback to React Native
  
  try {
    // Check if we can access Node.js modules without actually requiring them in bundling
    // Use eval to prevent static analysis from including these in the bundle
    (0, eval)('require')('os');
    (0, eval)('require')('fs');
    
    // If we reach here, Node.js modules are available
    console.log('[MAXIM PLATFORM] Node.js environment detected, loading Node adapter');
    // Also use eval to hide the node adapter require from static analysis
    const nodeAdapter = (0, eval)('require')("./node").default;
    return nodeAdapter;
  } catch (error) {
    // Node.js modules not available - we're in React Native or browser environment
    console.log('[MAXIM PLATFORM] Node.js modules not available, loading React Native adapter');
    const reactNativeAdapter = require("./reactNative").default;
    return reactNativeAdapter;
  }
}

export const platform: PlatformAdapter = detectPlatform();
export default platform;


