import type { Attachment, UrlAttachment, FileAttachment, FileDataAttachment } from "../types";
import {
	VariableType,
	type DatasetEntry,
	type DatasetRow,
	type MaximAPIDatasetResponse,
	type MaximAPIDatasetEntriesResponse,
	type MaximAPIDatasetStructureResponse,
	type MaximAPIDatasetTotalRowsResponse,
	type SignedURLResponse,
	type DatasetAttachmentUploadResponse,
	FileVariablePayload,
	VariableFileAttachment,
} from "../models/dataset";
import { type MaximAPIResponse } from "../models/deployment";
import { MaximAPI } from "./maxim";
import { platform } from "../platform";

export class MaximDatasetAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string, isDebug?: boolean) {
		super(baseUrl, apiKey, isDebug);
	}

	public async addDatasetEntries(datasetId: string, datasetEntries: DatasetEntry[]): Promise<void> {
		let nextRowNo = await this.getDatasetTotalRows(datasetId) + 1;
		const entriesWithFileAttachments: DatasetEntry[] = [];
		const transformedEntries = datasetEntries.map((entry) => {
			const rowNo = nextRowNo++;
			const isFile = entry.cellValue.type === VariableType.FILE;
			if (isFile) {
				entriesWithFileAttachments.push({ ...entry, rowNo });
			}
			return {
				rowNo,
				columnName: entry.columnName,
				type: entry.cellValue.type,
				value: isFile ? [] : entry.cellValue.payload,
			};
		});
		const response = await this.fetch<MaximAPIDatasetEntriesResponse>(`/api/sdk/v4/datasets/entries`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ 
				datasetId, 
				entries: transformedEntries
			}),
		});	

		// Handle the response
		if ("error" in response) {
			throw new Error(response.error.message);
		}

		const mapEntryIDToEntries : Record<string, DatasetEntry> = {};
		for (const entry of entriesWithFileAttachments) {
			for(const cell of response.data.cells) {
				if(cell.columnName === entry.columnName && cell.rowNo === entry.rowNo) {
					entry.columnId = cell.columnId;
					mapEntryIDToEntries[cell.entryId] = entry;
					break;
				}
			}
		}
        const filePayloads: FileVariablePayload[] = await Promise.all(
			Object.entries(mapEntryIDToEntries).map(([entryId, entry]) =>
				this.uploadFileAttachments(datasetId, entryId, entry)
			)
		);

        // Transform file payloads to the updates shape required by the API schema
        const transformedUpdates = filePayloads.map((payload) => ({
            entryId: payload.entryId,
            columnName: mapEntryIDToEntries[payload.entryId].columnName,
            value: {
                type: "file" as const,
                payload: payload,
            },
        }));

		if(transformedUpdates.length > 0) {
        try {
            await this.updateDatasetEntries(datasetId, transformedUpdates);
			} catch (error) {
				throw new Error(`Failed to update dataset entries: ${error}`);
			}
        }
	}

	public async uploadFileAttachments(datasetId: string, entryId: string, entry: DatasetEntry): Promise<FileVariablePayload> {
		const fileAttachments : VariableFileAttachment[] = [];
		for(const file of entry.cellValue.payload as Attachment[]) {
			let file_attachment: VariableFileAttachment;
			let {fileData, mimeType, size} = await this.processAttachment(file);

			if (!mimeType || mimeType === 'application/octet-stream') {
				const source = file.name ?? (file.type === "file" ? (file as FileAttachment).path : undefined);
				if (source) {
					const inferredType = platform.mime.lookup(source);
					if (inferredType) {
						mimeType = inferredType;
					}
				}
			}

			if(file.type !== "url") {
				const signedURLResponse = await this.getUploadUrlForDatasetAttachment(datasetId, entryId, entry.columnId!, file.id, mimeType, size);
				try {
					await this.uploadToSignedUrl(signedURLResponse.url, fileData as Buffer, mimeType, {
						filename: file.name,
						entryId: entryId
					});
				} catch (error) {
					throw new Error(`Failed to upload file ${file.name} to signed URL: ${error}`);
				}
				file_attachment = {
					id: file.id,
					url: signedURLResponse.url,
					hosted: true,
					prefix: signedURLResponse.key,
					props: { 
						"size": size,
						"type": mimeType
					} 
				}
			} else {

				file_attachment = {
					id: file.id,
					url: file.url,
					hosted: false,
					prefix: "",
					props: { 
						"size": size,
						"type": mimeType
					}
				}
			}
			fileAttachments.push(file_attachment);
		}	
		const filePayload : FileVariablePayload = {
			files: fileAttachments,
			entryId: entryId
		}
		return filePayload;
	}
	private async processAttachment(attachment: Attachment): Promise<{fileData: Buffer | null, mimeType: string, size: number}> {
		if (attachment.type === "url") {
			return this.processUrlAttachment(attachment as UrlAttachment);
		} else if (attachment.type === "fileData" || attachment.type === "file") {
			return this.processFileAttachment(attachment as FileDataAttachment | FileAttachment);
		} else {
			throw new Error(`Invalid attachment type: ${(attachment as any).type}. Expected url, fileData, or file.`);
		}
	}

	private async processUrlAttachment(attachment: UrlAttachment): Promise<{fileData: null, mimeType: string, size: number}> {
		try {
			// Validate URL
			if (!attachment.url || (!attachment.url.startsWith('http://') && !attachment.url.startsWith('https://'))) {
				throw new Error(`Invalid URL: ${attachment.url}`);
			}

			// Get file info from HEAD request
			const headResponse = await fetch(attachment.url, { method: 'HEAD' });
			
			if (!headResponse.ok) {
				throw new Error(`HTTP ${headResponse.status}: ${headResponse.statusText}`);
			}

			const mimeType = headResponse.headers.get('content-type') || 'application/octet-stream';
			const contentLength = headResponse.headers.get('content-length');
			
			// Calculate size
			const size = contentLength ? parseInt(contentLength, 10) : 0;
			
			return { fileData: null, mimeType, size };
			
		} catch (error) {
			if (error instanceof Error && error.message.includes('Invalid URL')) {
				throw error;
			}
			throw new Error(`Failed to download URL attachment ${attachment.url}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async processFileAttachment(attachment: FileDataAttachment | FileAttachment): Promise<{fileData: Buffer, mimeType: string, size: number}> {
		try {
			let fileData: Buffer;
			let mimeType: string;
			let size: number;
			const maxFileSizeBytes = 1024 * 1024 * 100; // 100MB


			if (attachment.type === "fileData") {
				fileData = attachment.data;
				mimeType = attachment.mimeType || 'application/octet-stream';
				size = fileData.length;
				if (size > maxFileSizeBytes) {
					throw new Error(`File size exceeds the maximum allowed size of ${maxFileSizeBytes} bytes`);
				  }
			} else {
				if (!platform.features.fileIoSupported) {
					throw new Error("File operations are not supported in this environment");
				}
				
				let stats;
				try {
					stats = await platform.fs.readFile(attachment.path);
				} catch (error) {
					throw new Error(`File not found: ${attachment.path}`);
				}
				if (stats.data.length > maxFileSizeBytes) {
					throw new Error(`File size exceeds the maximum allowed size of ${maxFileSizeBytes} bytes`);
				}
				try {
					fileData = Buffer.from(stats.data);
				} catch (error) {
					throw new Error(`File not found: ${attachment.path}`);
				}
				
				mimeType = attachment.mimeType || 'application/octet-stream';
				size = fileData.length;
			}

			return { fileData, mimeType, size };
			
		} catch (error) {
			if (error instanceof Error && (
				error.message.includes('File size exceeds the maximum allowed size') || 
				error.message.includes('File not found')
			)) {
				throw error;
			}
			const attachmentName = attachment.name || 'unknown';
			throw new Error(`Failed to process file attachment ${attachmentName}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	public async getDatasetTotalRows(datasetId: string): Promise<number> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIDatasetTotalRowsResponse>(`/api/sdk/v1/datasets/total-rows?datasetId=${datasetId}`)
				.then((response) => {
					if ("error" in response) {
						reject(response.error);
					} else {
						resolve(response.data);
					}
				})
				.catch((error) => {
					reject(error);
				});
		});
	}

	public async getDatasetRow(datasetId: string, rowIndex: number): Promise<{ data: DatasetRow; id: string }> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIDatasetResponse>(`/api/sdk/v2/datasets/row?datasetId=${datasetId}&row=${rowIndex}`)
				.then((response) => {
					if ("error" in response) {
						reject(response.error);
					} else {
						resolve(response.data);
					}
				})
				.catch((error) => {
					reject(error);
				});
		});
	}

	public async getDatasetDatastructure(datasetId: string): Promise<Record<string, "INPUT" | "EXPECTED_OUTPUT" | "VARIABLE" | "SCENARIO" | "EXPECTED_STEPS">> {
		return new Promise((resolve, reject) => {
			this.fetch<MaximAPIDatasetStructureResponse>(`/api/sdk/v1/datasets/structure?datasetId=${datasetId}`)
				.then((response) => {
					if ("error" in response) {
						reject(response.error);
					} else {
						resolve(response.data);
					}
				})
				.catch((error) => {
					reject(error);
				});
		});
	}

	private async getUploadUrlForDatasetAttachment(
		datasetId: string, 
		entryId: string, 
		columnId: string,
		key: string, 
		mimeType: string, 
		size: number
	): Promise<SignedURLResponse> {
		try {
			const response = await this.fetch<DatasetAttachmentUploadResponse>("/api/sdk/v4/datasets/entries/attachments/", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					datasetId: datasetId,
					entryId: entryId,
					columnId: columnId,
					file: {
						id: key,
						type: mimeType,
						size: size,
					}
				}),
			});

			if (this.isDebug) {
				console.log("Upload URL Response: ", response);
			}

			// Handle the response
			if ("error" in response) {
				throw new Error(response.error.message);
			}

			return {
				url: response.data.url,
				key: response.data.key
			};

		} catch (error) {
			// Handle axios errors with response data
			if (error && typeof error === 'object' && 'response' in error) {
				const axiosError = error as any;
				if (axiosError.response?.data) {
					const errorData = axiosError.response.data;
					if (errorData && 
						typeof errorData === 'object' && 
						'error' in errorData &&
						typeof errorData.error === 'object' &&
						'message' in errorData.error) {
						throw new Error(errorData.error.message);
					}
				}
			}
			
			// Re-throw the error if it's already an Error instance
			if (error instanceof Error) {
				throw error;
			}
			
			// For any other type of error, convert to Error
			throw new Error(String(error));
		}
	}
	public async uploadToSignedUrl(url: string, data: Buffer, mimeType: string, fileContext?: { filename?: string; entryId?: string }): Promise<void> {
		try {
			const response = await this.axiosInstance.put(url, data, {
				headers: {
					"Content-Type": mimeType,
					"Content-Length": data.length.toString(),
				},
				responseType: "text",
				timeout: 120000, 
				transformRequest: [(data: Buffer) => data],
				transformResponse: [(data: unknown) => data],
				baseURL: "",
			});

			if (response.status >= 200 && response.status < 300) {
				return;
			}

			if (response.data && typeof response.data === "object" && "error" in response.data) {
				throw response.data.error;
			}
			throw response.data;
		} catch (error) {
			// Wrap network/DNS errors with file context for better debugging
			const context = fileContext ? 
				` (file: ${fileContext.filename || 'unknown'}, entryId: ${fileContext.entryId || 'unknown'})` : '';
			
			if (error instanceof Error) {
				throw new Error(`Failed to upload file to signed URL${context}: ${error.message}`);
			}
			
			throw new Error(`Failed to upload file to signed URL${context}: ${String(error)}`);
		}
	}

    public async updateDatasetEntries(
        datasetId: string,
        updates: Array<{
            entryId: string;
            columnName: string;
            value: { type: "file"; payload: FileVariablePayload };
        }>,
    ): Promise<void> {
		try {
			const response = await this.fetch<MaximAPIResponse>("/api/sdk/v4/datasets/entries", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					datasetId: datasetId,
					updates: updates
				}),
			});

					if (this.isDebug) {
			console.log("Update dataset entries: ", response);
		}

		// Handle the response
		if (response.error) {
			throw new Error(response.error.message);
		}

		} catch (error) {
			// Handle axios errors with response data
			if (error && typeof error === 'object' && 'response' in error) {
				const axiosError = error as any;
				if (axiosError.response?.data) {
					const errorData = axiosError.response.data;
					if (errorData && 
						typeof errorData === 'object' && 
						'error' in errorData &&
						typeof errorData.error === 'object' &&
						'message' in errorData.error) {
						throw new Error(errorData.error.message);
					}
				}
			}
			
			// Re-throw the error if it's already an Error instance
			if (error instanceof Error) {
				throw new Error(`Failed to update dataset entries with attachments: ${error.message}`);
			}
			
			// For any other type of error, convert to Error
			throw new Error(`Failed to update dataset entries with attachments: ${String(error)}`);
		}
	}
}
