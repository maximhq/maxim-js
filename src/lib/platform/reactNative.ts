/*
 * React Native platform adapter. Avoids Node built-ins and provides safe
 * fallbacks. File IO and CSV are disabled by default. Randomness prefers
 * expo-crypto when available, falling back to Math.random-based polyfill.
 */

import type { PlatformAdapter, PlatformFeatures, HttpAgentLike } from "./adapter";

// Lazy import for expo-crypto if present
let expoCryptoRandomBytes: ((size: number) => Uint8Array) | null = null;
let expoCryptoAvailable = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const expoCrypto = require("expo-crypto");
  if (expoCrypto && typeof expoCrypto.getRandomBytesAsync === "function") {
    // Store sync wrapper for expo-crypto async function
    expoCryptoRandomBytes = (size: number) => {
      // For sync usage, we'll need to implement a cache or use different approach
      // For now, throw error indicating async version should be used
      throw new Error("expo-crypto requires async usage. Use platform.crypto.randomBytesAsync() instead.");
    };
    expoCryptoAvailable = true;
  }
} catch {
  // expo-crypto not available
}

const timers = {
  setInterval: (handler: () => void, ms: number) => setInterval(handler, ms),
  clearInterval: (handle: any) => clearInterval(handle as number as any),
  maybeUnref: (_handle: any) => {
    // No-op on RN; handle is a number
  },
};

const rnFs = {
  hasAccessToFilesystem(): boolean {
    // Assume /tmp-like access is not standard in RN; disable
    return false;
  },
  existsSync(_p: string): boolean {
    return false;
  },
  mkdirpSync(_p: string): void {
    // no-op
  },
  async readFile(_p: string) {
    return { data: new Uint8Array() };
  },
  readFileSync(_p: string) {
    return new Uint8Array();
  },
  async writeFile(_p: string, _data: Uint8Array | Buffer | string) {
    // no-op
  },
  readdirSync(_p: string): string[] {
    return [];
  },
  rmSync(_p: string): void {
    // no-op
  },
  statSync(_p: string) {
    return { size: 0 };
  },
};

const rnPath = {
  basename: (filePath: string) => filePath.split("/").pop() || filePath,
  extname: (filePath: string) => {
    const idx = filePath.lastIndexOf(".");
    return idx >= 0 ? filePath.slice(idx) : "";
  },
  join: (...parts: string[]) => parts.join("/").replace(/\/+/, "/"),
};

const rnMime = {
  lookup: (filePath: string) => {
    const ext = (filePath.split(".").pop() || "").toLowerCase();
    const map: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      pdf: "application/pdf",
      txt: "text/plain",
      json: "application/json",
      html: "text/html",
      css: "text/css",
      js: "application/javascript",
      zip: "application/zip",
      csv: "text/csv",
    };
    return map[ext] || false;
  },
};

const net = {
  httpAgent: (_options?: Record<string, unknown>): HttpAgentLike | undefined => {
    // Axios uses native stack on RN; no agents needed
    return undefined;
  },
  httpsAgent: (_options?: Record<string, unknown>): HttpAgentLike | undefined => {
    return undefined;
  },
};

function insecureRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function simpleHashHex(input: string | Uint8Array): string {
  const str = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

async function secureRandomBytesAsync(size: number): Promise<Uint8Array> {
  if (expoCryptoAvailable) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const expoCrypto = require("expo-crypto");
      const result = await expoCrypto.getRandomBytesAsync(size);
      return new Uint8Array(result);
    } catch (error) {
      console.warn('[Maxim-SDK] expo-crypto failed, falling back to insecure random:', error);
    }
  }
  return insecureRandomBytes(size);
}

const rnCrypto = {
  randomBytes: (size: number): Uint8Array => {
    // Synchronous version - falls back to insecure for compatibility
    // Recommend using randomBytesAsync for better security on RN
    if (expoCryptoAvailable) {
      console.warn('[Maxim-SDK] Using insecure randomBytes. Consider using platform.crypto.randomBytesAsync() for better security.');
    }
    return insecureRandomBytes(size);
  },
  randomBytesAsync: secureRandomBytesAsync,
  createHash: (_algorithm: string) => ({
    update: (data: string | Uint8Array) => ({
      digest: (_encoding: "hex") => simpleHashHex(data),
    }),
  }),
  hostname: () => "react-native-device",
  isSecureRandomAvailable: expoCryptoAvailable,
};

const stream = {
  Transform: class Transform {
    private options: any;
    private _transform: any;
    private _flush: any;
    private _destroyed: boolean;
    
    constructor(options: any) {
      this.options = options;
      this._transform = options.transform;
      this._flush = options.flush;
      this._destroyed = false;
    }
    
    transform(chunk: any, encoding: any, callback: any) {
      if (this._destroyed) return;
      try {
        this._transform(chunk, encoding, callback);
      } catch (err) {
        callback(err);
      }
    }
    
    flush(callback: any) {
      if (this._destroyed) return;
      try {
        this._flush(callback);
      } catch (err) {
        callback(err);
      }
    }
    
    destroy() {
      this._destroyed = true;
    }
    
    pipe(destination: any) {
      // Simple pipe implementation for React Native
      return destination;
    }
  }
};

const features: PlatformFeatures = {
  csvSupported: false,
  fileIoSupported: false,
};

export const reactNativeAdapter: PlatformAdapter = {
  name: "react-native",
  fs: rnFs,
  path: rnPath,
  mime: rnMime,
  timers,
  net,
  crypto: rnCrypto,
  stream,
  tmpdir: () => "/tmp",
  features,
};

export default reactNativeAdapter;


