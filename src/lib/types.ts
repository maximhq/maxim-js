/**
 * Base properties shared by all attachment types in the Maxim logging system.
 */
export type BaseAttachmentProps = {
	id: string;
	name?: string;
	mimeType?: string;
	size?: number; // bytes
	tags?: Record<string, string>;
	metadata?: Record<string, string>;
};

/**
 * File attachment type for referencing files on the local filesystem.
 */
export type FileAttachment = BaseAttachmentProps & {
	type: "file";
	path: string;
};

/**
 * File attachment with storage key for internal processing.
 */
export type FileAttachmentWithKey = FileAttachment & { key: string };

/**
 * File data attachment type for directly embedding binary data.
 */
export type FileDataAttachment = BaseAttachmentProps & {
	type: "fileData";
	data: Buffer;
};

/**
 * File data attachment with storage key for internal processing.
 */
export type FileDataAttachmentWithKey = FileDataAttachment & { key: string };

/**
 * URL attachment type for referencing external resources.
 */
export type UrlAttachment = BaseAttachmentProps & {
	type: "url";
	url: string;
};

/**
 * URL attachment with storage key for internal processing.
 */
export type UrlAttachmentWithKey = UrlAttachment & { key: string };

/**
 * Discriminated union type representing all possible attachment types.
 */
export type Attachment = FileAttachment | FileDataAttachment | UrlAttachment;

/**
 * Attachment with storage key for internal processing.
 */
export type AttachmentWithKey = FileAttachmentWithKey | FileDataAttachmentWithKey | UrlAttachmentWithKey;
