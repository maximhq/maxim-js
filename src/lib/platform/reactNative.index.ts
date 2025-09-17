// React Native specific platform index - only imports RN adapter
import type { PlatformAdapter } from "./adapter";
import reactNativeAdapter from "./reactNative";

// For React Native, always use the React Native adapter
export const platform: PlatformAdapter = reactNativeAdapter;
export default platform;