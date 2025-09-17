import { uniqueId } from "../utils";
import type { Attachment } from "../../types";
import { platform } from "../../platform";
/**
 * Auto-populates missing fields in an attachment based on available information.
 *
 * This utility function automatically fills in missing properties like name, MIME type,
 * and size based on the attachment type and content. For file attachments, it reads
 * filesystem metadata. For data attachments, it performs content analysis. For URL
 * attachments, it extracts information from the URL structure.
 *
 * @template T - The specific attachment type being processed
 * @param attachment - The attachment object to populate
 * @returns A new attachment object with auto-populated fields
 * Note: The function suppresses I/O errors when reading file metadata; in such
 * cases the size property remains undefined.
 */
export function populateAttachmentFields<T extends Attachment>(attachment: T): T {
	// Make a copy to avoid mutating the original
	const result = { ...attachment };

	// Ensure ID is present
	if (!result.id) {
		result.id = uniqueId();
	}

	// Auto-populate based on attachment type
	switch (result.type) {
		case "file": {
			const filePath = result.path;

			// Auto-populate name if missing
			if (!result.name) {
				result.name = platform.path.basename(filePath);
			}

			// Auto-populate mimeType if missing
			if (!result.mimeType) {
				result.mimeType = platform.mime.lookup(filePath) || "application/octet-stream";
			}

			// Auto-populate size if missing
			if (!result.size) {
				try {
					const stats = platform.fs.statSync(filePath);
					result.size = stats.size;
				} catch (e) {
					// Leave size undefined if we can't determine it
				}
			}
			break;
		}

		case "fileData": {
			// Auto-populate size if missing
			if (!result.size && result.data) {
				result.size = result.data.length;
			}

			// Try to detect mime type from buffer header if not provided
			if (!result.mimeType && result.data && result.data.length > 4) {
				// Simple magic number detection for common formats
				const header = result.data.subarray(0, 4).toString("hex");

				if (header.startsWith("89504e47")) {
					result.mimeType = "image/png";
				} else if (header.startsWith("ffd8ff")) {
					result.mimeType = "image/jpeg";
				} else if (header.startsWith("47494638")) {
					result.mimeType = "image/gif";
				} else if (header.startsWith("25504446")) {
					result.mimeType = "application/pdf";
				} else if (result.data.slice(0, 5).toString() === "%PDF-") {
					result.mimeType = "application/pdf";
				} else if (header.startsWith("504b0304")) {
					result.mimeType = "application/zip";
				} else {
					// Try to detect if it's text
					let isText = true;
					const sampleSize = Math.min(result.data.length, 512);
					for (let i = 0; i < sampleSize; i++) {
						// Check if byte is outside printable ASCII and common whitespace
						const byte = result.data[i];
						if ((byte < 32 || byte > 126) && ![9, 10, 13].includes(byte)) {
							isText = false;
							break;
						}
					}

					if (isText) {
						// Try to detect if it's JSON
						try {
							JSON.parse(result.data.toString("utf8").trim());
							result.mimeType = "application/json";
						} catch {
							// Check if it looks like HTML
							if (result.data.toString("utf8").match(/<html|<!doctype html/i)) {
								result.mimeType = "text/html";
							} else {
								result.mimeType = "text/plain";
							}
						}
					} else {
						result.mimeType = "application/octet-stream";
					}
				}
			}

			break;
		}

		case "url": {
			try {
				const urlObj = new URL(result.url);

				// Auto-populate name if missing
				if (!result.name) {
					const urlPath = urlObj.pathname;
					result.name = platform.path.basename(urlPath) || urlObj.hostname;
				}

				// Try to determine MIME type from URL if not already specified
				if (!result.mimeType) {
					// First check if the URL path has a file extension
					const urlPath = urlObj.pathname;
					const extension = platform.path.extname(urlPath);

					if (extension) {
						// Try to get MIME type from extension
						const detectedMimeType = platform.mime.lookup(extension);
						if (detectedMimeType) {
							result.mimeType = detectedMimeType;
						}
					}

					// If still no MIME type and the URL ends with a query string or hash,
					// try to extract file path before those
					if (!result.mimeType && (urlObj.search || urlObj.hash)) {
						const cleanPath = urlPath.split(/[?#]/)[0];
						const extension = platform.path.extname(cleanPath);
						if (extension) {
							const detectedMimeType = platform.mime.lookup(extension);
							if (detectedMimeType) {
								result.mimeType = detectedMimeType;
							}
						}
					}
				}
			} catch (e) {
				// If URL parsing fails, leave name and mimeType as is
			}

			break;
		}

		default:
			const exhaustiveCheck: never = result;
	}

	return result;
}
