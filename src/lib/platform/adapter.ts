/*
 * Platform adapter interface to abstract Node vs React Native differences.
 * This layer centralizes environment-specific behavior so SDK modules can
 * depend on a stable API without importing Node built-ins directly.
 */

export type PlatformName = "node" | "react-native" | "unknown";

export interface FileStatLike {
  size: number;
}

export interface ReadFileResult {
  data: Uint8Array | Buffer;
}

export interface PlatformFs {
  hasAccessToFilesystem(): boolean;
  existsSync(path: string): boolean;
  mkdirpSync(path: string): void;
  readFile(path: string): Promise<ReadFileResult>;
  readFileSync(path: string): Uint8Array | Buffer;
  writeFile(path: string, data: Uint8Array | Buffer | string): Promise<void>;
  readdirSync(path: string): string[];
  rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): FileStatLike;
}

export interface PlatformPath {
  basename(filePath: string): string;
  extname(filePath: string): string;
  join(...parts: string[]): string;
}

export interface PlatformMime {
  lookup(filePath: string): string | false;
}

export interface PlatformTimers {
  setInterval(handler: () => void, ms: number): any;
  clearInterval(handle: any): void;
  maybeUnref(handle: any): void;
}

export interface HttpAgentLike {
  // Shape intentionally minimal; acts as a placeholder for axios config
  keepAlive?: boolean;
}

export interface PlatformNet {
  httpAgent(options?: Record<string, unknown>): HttpAgentLike | undefined;
  httpsAgent(options?: Record<string, unknown>): HttpAgentLike | undefined;
}

export interface PlatformCrypto {
  randomBytes(size: number): Uint8Array;
  randomBytesAsync?(size: number): Promise<Uint8Array>;
  createHash(algorithm: string): {
    update(data: string | Uint8Array): { digest(encoding: "hex"): string };
  };
  hostname(): string;
  isSecureRandomAvailable?: boolean;
}

export interface PlatformStream {
  Transform: new (options: any) => any;
}

export interface PlatformFeatures {
  csvSupported: boolean;
  fileIoSupported: boolean;
}

export interface PlatformAdapter {
  name: PlatformName;
  fs: PlatformFs;
  path: PlatformPath;
  mime: PlatformMime;
  timers: PlatformTimers;
  net: PlatformNet;
  crypto: PlatformCrypto;
  stream: PlatformStream;
  tmpdir(): string;
  features: PlatformFeatures;
}


