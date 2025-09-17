import os from "os";
import fs from "fs";
import path from "path";
import mime from "mime-types";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import crypto from "crypto";
import { Transform } from "stream";
import type { PlatformAdapter, PlatformFeatures, HttpAgentLike } from "./adapter";

const timers = {
	setInterval: (handler: () => void, ms: number) => setInterval(handler, ms),
	clearInterval: (handle: any) => clearInterval(handle as NodeJS.Timeout),
	maybeUnref: (handle: any) => {
		if (handle && typeof (handle as NodeJS.Timeout).unref === "function") {
			(handle as NodeJS.Timeout).unref();
		}
	},
};

const nodeFs = {
	hasAccessToFilesystem(): boolean {
		try {
			fs.accessSync(os.tmpdir(), fs.constants.W_OK);
			return true;
		} catch {
			return false;
		}
	},
	existsSync: (p: string) => fs.existsSync(p),
	mkdirpSync: (p: string) => {
		if (!fs.existsSync(p)) {
			fs.mkdirSync(p, { recursive: true });
		}
	},
	readFile: async (p: string) => ({ data: await fs.promises.readFile(p) }),
	readFileSync: (p: string) => fs.readFileSync(p),
	writeFile: async (p: string, data: Uint8Array | Buffer | string) => {
		await fs.promises.writeFile(p, data as any);
	},
	readdirSync: (p: string) => fs.readdirSync(p),
	rmSync: (p: string, opts?: { recursive?: boolean; force?: boolean }) => fs.rmSync(p, opts as any),
	statSync: (p: string) => fs.statSync(p),
};

const nodePath = {
	basename: (p: string) => path.basename(p),
	extname: (p: string) => path.extname(p),
	join: (...parts: string[]) => path.join(...parts),
};

const nodeMime = {
	lookup: (filePath: string) => mime.lookup(filePath) || false,
};

const net = {
	httpAgent: (options?: Record<string, unknown>): HttpAgentLike => new HttpAgent({ keepAlive: true, ...(options as any) }) as any,
	httpsAgent: (options?: Record<string, unknown>): HttpAgentLike => new HttpsAgent({ keepAlive: true, ...(options as any) }) as any,
};

const nodeCrypto = {
	randomBytes: (size: number) => crypto.randomBytes(size),
	randomBytesAsync: async (size: number) => crypto.randomBytes(size),
	createHash: (algorithm: string) => crypto.createHash(algorithm) as any,
	hostname: () => os.hostname(),
	isSecureRandomAvailable: true,
};

const stream = {
	Transform,
};

const features: PlatformFeatures = {
	csvSupported: true,
	fileIoSupported: true,
};

export const nodeAdapter: PlatformAdapter = {
	name: "node",
	fs: nodeFs,
	path: nodePath,
	mime: nodeMime,
	timers,
	net,
	crypto: nodeCrypto,
	stream,
	tmpdir: () => os.tmpdir(),
	features,
};

export default nodeAdapter;
