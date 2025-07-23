import fs from "fs";
import mimeTypes from "mime-types";
import os from "os";
import { v4 as uuid } from "uuid";
import { MaximAttachmentAPI } from "../apis/attachment";
import { MaximLogsAPI } from "../apis/logs";
import { MaximCache } from "../cache/cache";
import { Mutex } from "../utils/mutex";
import { Queue } from "../utils/queue";
import { generateUniqueId } from "../utils/utils";
import {
	Attachment,
	AttachmentWithKey,
	FileAttachmentWithKey,
	FileDataAttachmentWithKey,
	populateAttachmentFields,
} from "./components/attachment";
import { CommitLog, Entity } from "./components/types";

export type LogWriterConfig = {
	baseUrl: string;
	apiKey: string;
	repositoryId: string;
	autoFlush?: boolean;
	flushInterval?: number;
	isDebug?: boolean;
	maxInMemoryLogs?: number;
};

export class LogWriter {
	private readonly id = generateUniqueId();
	private config: LogWriterConfig;
	private queue: Queue<CommitLog> = new Queue<CommitLog>();
	private attachmentQueue: Queue<CommitLog> = new Queue<CommitLog>();
	private storageQueue: Queue<CommitLog> = new Queue<CommitLog>();
	private mutex: Mutex = Mutex.get(`maxim-logs-${this.id}`);
	private readonly isDebug: boolean;
	private flushInterval: NodeJS.Timeout | null = null;
	private readonly logsDir = `${os.tmpdir()}/maxim-sdk/${this.id}/maxim-logs`;
	private logsAPIService: MaximLogsAPI;
	private attachmentAPIService: MaximAttachmentAPI;
	private readonly maxInMemoryLogs;
	private readonly cache: MaximCache;
	private readonly _raiseExceptions: boolean;
	private readonly STORAGE_LOG_THRESHOLD = 900_000; // ~900KB

	constructor(config: LogWriterConfig & { cache: MaximCache; raiseExceptions: boolean }) {
		this.config = config;
		this.isDebug = config.isDebug || false;
		this._raiseExceptions = config.raiseExceptions;
		this.maxInMemoryLogs = config.maxInMemoryLogs || 100;
		this.cache = config.cache;
		this.logsAPIService = new MaximLogsAPI(config.baseUrl, config.apiKey, config.isDebug);
		this.attachmentAPIService = new MaximAttachmentAPI(config.baseUrl, config.apiKey, config.isDebug);
		if (config.autoFlush) {
			this.flushInterval = setInterval(
				() => {
					this.flush();
					this.flushStorageLogs();
					this.flushAttachments();
				},
				config.flushInterval ? config.flushInterval * 1000 : 10000,
			);

			// Call unref() to tell Node.js that this interval should not keep the process alive
			this.flushInterval.unref();
		}
	}

	get writerConfig(): LogWriterConfig {
		return this.config;
	}

	get raiseExceptions(): boolean {
		return this._raiseExceptions;
	}

	get writerLogsAPIService(): MaximLogsAPI {
		return this.logsAPIService;
	}

	get writerCache(): MaximCache {
		return this.cache;
	}

	private isOnAWSLambda(): boolean {
		return process.env["AWS_LAMBDA_FUNCTION_NAME"] !== undefined;
	}

	private hasAccessToFilesystem(): boolean {
		try {
			fs.accessSync(os.tmpdir(), fs.constants.W_OK);
			return true;
		} catch (err) {
			return false;
		}
	}

	private writeToFile(logs: CommitLog[]) {
		try {
			return new Promise<string>((resolve, reject) => {
				if (!fs.existsSync(this.logsDir)) {
					fs.mkdirSync(this.logsDir, { recursive: true });
				}
				const content = logs.map((l) => l.serialize()).join("\n");
				const filename = `logs-${new Date().toISOString()}.log`;
				fs.writeFile(`${this.logsDir}/${filename}`, content, (err) => {
					if (err) {
						reject(err);
						return;
					}
					resolve(`${this.logsDir}/${filename}`);
				});
			});
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while writing to file: ${err instanceof Error ? err.message : err}`);
				return undefined;
			}
		}
	}

	private async flushLogFiles() {
		if (!this.hasAccessToFilesystem() || !fs.existsSync(this.logsDir)) {
			return;
		}
		const files = fs.readdirSync(this.logsDir);
		await Promise.all(
			files.map(async (file) => {
				const logs = fs.readFileSync(`${this.logsDir}/${file}`, "utf-8");
				// Now will push these to the server
				try {
					await this.logsAPIService.pushLogs(this.config.repositoryId, logs);
					try {
						fs.rmSync(`${this.logsDir}/${file}`);
					} catch (ignored) {}
				} catch (err: unknown) {
					if (err && typeof err === "object" && "message" in err && typeof err.message === "string")
						console.error(`Error while pushing logs: ${err.message}`);
				}
			}),
		);
	}

	private async uploadFile(attachmentData: FileAttachmentWithKey, entity: Entity, entityId: string) {
		try {
			if (!attachmentData.path) {
				console.error("[MaximSDK] Path is not set for file attachment. Skipping upload");
				return;
			}

			// Detect mimetype if not provided
			const mimeType = attachmentData.mimeType || mimeTypes.lookup(attachmentData.path) || "application/octet-stream";
			const size = fs.statSync(attachmentData.path).size;
			const key = attachmentData.key;
			const data = fs.readFileSync(attachmentData.path);

			// Get upload URL
			const resp = await this.attachmentAPIService.getUploadUrl(key, mimeType, size);

			// Create a copy of attachment without the path
			const addAttachmentData = { ...attachmentData } as Partial<FileAttachmentWithKey>;
			delete addAttachmentData.path;

			// Create CommitLog for add-attachment action
			const addAttachmentLog = new CommitLog(entity, entityId, "add-attachment", addAttachmentData);

			// Queue it
			this.queue.enqueue(addAttachmentLog);

			// Uploading file to the Maxim API
			await this.attachmentAPIService.uploadToSignedUrl(resp.url, data, mimeType);

			if (this.isDebug) {
				console.log(`[MaximSDK] File uploaded to the Maxim API. URL: ${resp.url}, Mime type: ${mimeType}, Size: ${size}`);
			}
		} catch (err) {
			const currentRetry = "retry" in attachmentData && typeof attachmentData.retry === "number" ? (attachmentData.retry ?? 0) : 0;
			if (currentRetry < 3) {
				(attachmentData as FileAttachmentWithKey & { retry?: number }).retry = currentRetry + 1;
				const retryLog = new CommitLog(entity, entityId, "upload-attachment", attachmentData);
				this.attachmentQueue.enqueue(retryLog);
			} else {
				console.error(`[MaximSDK] Failed to upload file: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	private async uploadFileData(attachmentData: FileDataAttachmentWithKey, entity: Entity, entityId: string) {
		try {
			if (!attachmentData.data) {
				console.error("[MaximSDK] Data is not set for file data attachment. Skipping upload");
				return;
			}

			const mimeType = attachmentData.mimeType || "application/octet-stream";
			const key = attachmentData.key;
			const size = attachmentData.data.length;

			// Get upload URL
			const resp = await this.attachmentAPIService.getUploadUrl(key, mimeType, size);

			// Create a copy of attachment without the data
			const addAttachmentData = { ...attachmentData } as Partial<FileDataAttachmentWithKey>;
			delete addAttachmentData.data;

			// Create CommitLog for add-attachment action
			const addAttachmentLog = new CommitLog(entity, entityId, "add-attachment", addAttachmentData);

			// Queue it
			this.queue.enqueue(addAttachmentLog);

			// Uploading file data to the Maxim API
			await this.attachmentAPIService.uploadToSignedUrl(resp.url, attachmentData.data, mimeType);

			if (this.isDebug) {
				console.log(`[MaximSDK] File data uploaded to the Maxim API. URL: ${resp.url}, Mime type: ${mimeType}, Size: ${size}`);
			}
		} catch (err) {
			const currentRetry = "retry" in attachmentData && typeof attachmentData.retry === "number" ? (attachmentData.retry ?? 0) : 0;
			if (currentRetry < 3) {
				(attachmentData as FileDataAttachmentWithKey & { retry?: number }).retry = currentRetry + 1;
				const retryLog = new CommitLog(entity, entityId, "upload-attachment", attachmentData);
				this.attachmentQueue.enqueue(retryLog);
			} else {
				console.error(`[MaximSDK] Failed to upload file data: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	private async uploadAttachment(attachment: CommitLog) {
		const entity = attachment.type;
		const entityId = attachment.id;

		const attachmentData = attachment.data as AttachmentWithKey;
		const populatedAttachment = populateAttachmentFields(attachmentData);
		const attachmentType = populatedAttachment.type;

		switch (attachmentType) {
			case "file":
				await this.uploadFile(populatedAttachment, entity, entityId);
				break;
			case "fileData":
				await this.uploadFileData(populatedAttachment, entity, entityId);
				break;
			case "url":
				// For URL attachments, we just need to add them to the queue for sending to the server
				const addAttachmentLog = new CommitLog(entity, entityId, "add-attachment", populatedAttachment);
				this.queue.enqueue(addAttachmentLog);
				break;
			default:
				const exhaustiveCheck: never = attachmentType;
				console.error(`[MaximSDK] Unknown attachment type: ${attachmentType}. Skipping upload.`);
		}
	}

	private async flushAttachments() {
		const attachments = this.attachmentQueue.dequeueAll();
		if (attachments.length === 0) {
			return;
		}

		await Promise.all(
			attachments.map(async (attachment) => {
				return this.uploadAttachment(attachment);
			}),
		);
	}

	private async flushLogs(logs: CommitLog[]) {
		try {
			// We can try to flush old failed logs first
			await this.flushLogFiles();
			if (this.isDebug) {
				console.log("[MaximSDK] Flushing new logs");
				logs.map((l) => console.log(l.serialize()));
			}
			// Flushing new logs
			// Split logs into chunks of 5MB max
			const MAX_SIZE = 5242880; // 5MB in bytes
			const chunks: string[] = [];
			let currentChunk = "";
			for (const log of logs) {
				const serialized = log.serialize() + "\n";
				if (currentChunk.length + serialized.length > MAX_SIZE) {
					chunks.push(currentChunk);
					currentChunk = serialized;
				} else {
					currentChunk += serialized;
				}
			}
			if (currentChunk.length > 0) {
				chunks.push(currentChunk);
			}
			// Make multiple requests if needed
			for (const chunk of chunks) {
				await this.logsAPIService.pushLogs(this.config.repositoryId, chunk);
				if (this.isDebug) console.log(`[MaximSDK] Flushed chunk of size ${chunk.length} bytes`);
			}
			// Return early since we've already made the API calls
			return;
		} catch (err) {
			console.error("Error while pushing logs", err);
			if (this.isOnAWSLambda() || !this.hasAccessToFilesystem()) {
				// Here we don't write it to filesystem
				this.queue.enqueueAll(logs);
				return;
			}
			await this.writeToFile(logs);
		}
	}

	private getAttachmentKey(log: CommitLog): string | null {
		if (log.action === "upload-attachment") {
			const repoId = this.config.repositoryId;
			const entity = log.type;
			const entityId = log.id;
			const attachmentData = log.data as Attachment;
			const fileId = attachmentData.id;
			return `${repoId}/${entity}/${entityId}/files/original/${fileId}`;
		}
		return null;
	}

	private async uploadStorageLog(log: CommitLog): Promise<void> {
		try {
			if (!log.data || !log.data["logContent"]) {
				console.error("[MaximSDK] Log content is not set for storage upload. Skipping upload.");
				return;
			}

			const logContent = log.data["logContent"] as string;
			const storageId = uuid();

			const key = `${this.config.repositoryId}/large-logs/${storageId}`;

			const resp = await this.attachmentAPIService.getUploadUrl(key, "text/plain", Buffer.byteLength(logContent, "utf8"));

			await this.attachmentAPIService.uploadToSignedUrl(resp.url, Buffer.from(logContent, "utf8"), "text/plain");

			const storageLog = new CommitLog(Entity.STORAGE, storageId, "process-large-log", { key });
			this.queue.enqueue(storageLog);

			if (this.isDebug) {
				console.log(`[MaximSDK] Large log uploaded to storage. Key: ${key}, Size: ${logContent.length} bytes`);
			}
		} catch (err) {
			const currentRetry = "retry" in log.data && typeof log.data["retry"] === "number" ? (log.data["retry"] ?? 0) : 0;
			if (currentRetry < 3) {
				(log.data as any)["retry"] = currentRetry + 1;
				this.storageQueue.enqueue(log);
			} else {
				console.error(`[MaximSDK] Failed to upload large log to storage: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	private async flushStorageLogs() {
		const storageLogs = this.storageQueue.dequeueAll();
		if (storageLogs.length === 0) {
			return;
		}

		await Promise.all(
			storageLogs.map(async (log) => {
				return this.uploadStorageLog(log);
			}),
		);
	}

	public commit(log: CommitLog): void {
		try {
			const serializedLog = log.serialize();
			if (this.isDebug) console.log("[MaximSDK] Committing log: ", serializedLog);
			if (!/^[a-zA-Z0-9_-]+$/.test(log.id)) {
				if (this._raiseExceptions) {
					throw new Error(
						`Invalid ID: ${log.id}. ID must only contain alphanumeric characters, hyphens, and underscores. Event will not be logged.`,
					);
				}
				return;
			}

			// Check if this is a large log that should be uploaded to storage
			if (Buffer.byteLength(serializedLog, "utf8") > this.STORAGE_LOG_THRESHOLD && log.action !== "upload-attachment") {
				const storageLog = new CommitLog(log.type, log.id, "upload-storage-log", { logContent: serializedLog });
				this.storageQueue.enqueue(storageLog);
			}
			// Special handling for upload-attachment action
			else if (log.action === "upload-attachment") {
				if (!log.data) {
					console.error("[MaximSDK] Attachment data is not set for log. Skipping upload.");
					return;
				}

				// Attach key
				const key = this.getAttachmentKey(log);
				if (key) {
					// Add key to attachment data
					(log.data as AttachmentWithKey).key = key;

					// Add to upload queue
					this.attachmentQueue.enqueue(log);
				} else {
					console.error(`[MaximSDK] Failed to generate attachment key due to invalid action: ${log.action}. Skipping upload.`);
				}
			} else {
				this.queue.enqueue(log);
			}

			if (this.queue.size + this.attachmentQueue.size + this.storageQueue.size > this.maxInMemoryLogs) {
				this.flush();
			}
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while committing log: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	public async flush() {
		try {
			let items: CommitLog[] = [];

			// Add a timeout to the mutex lock to prevent deadlocks
			const MUTEX_TIMEOUT_MS = 30000; // 30 seconds

			// Create a promise that resolves after the timeout
			const timeoutPromise = new Promise<void>((_, reject) => {
				setTimeout(() => {
					reject(new Error(`Mutex acquisition timed out after ${MUTEX_TIMEOUT_MS}ms`));
				}, MUTEX_TIMEOUT_MS);
			});

			// Race between the mutex lock and the timeout
			await Promise.race([
				new Promise<void>(async (resolve) => {
					await this.mutex.withLock(async () => {
						try {
							await this.flushStorageLogs();
							await this.flushAttachments();

							items = this.queue.dequeueAll();
							if (items.length === 0) {
								await this.flushLogFiles();
								if (this.isDebug) console.log("[MaximSDK] No logs to flush");
								resolve();
							}

							if (this.isDebug) console.log("[MaximSDK] Flushing logs");

							await this.flushLogs(items);
						} catch (err) {
							console.error("[MaximSDK] Couldn't flush logs", err);
							resolve();
						}
					});
					resolve();
				}),
				timeoutPromise,
			]);

			if (this.isDebug) console.log("[MaximSDK] Flush complete");
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while flushing logs: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	public async cleanup() {
		try {
			if (this.flushInterval) clearInterval(this.flushInterval);
			await this.flush();

			// Destroy the HTTP/HTTPS agents to close any lingering connections
			this.logsAPIService.destroyAgents();
			this.attachmentAPIService.destroyAgents();
		} catch (err) {
			if (this._raiseExceptions) {
				throw err;
			} else {
				console.error(`[Maxim-SDK] Error while cleaning up: ${err instanceof Error ? err.message : err}`);
			}
		}
	}
}
