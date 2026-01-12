import {
	RealtimeConversationItemAssistantMessage,
	RealtimeConversationItemSystemMessage,
	RealtimeConversationItemUserMessage,
} from "openai/resources/realtime/realtime";

/**
 * Convert PCM16 audio data to WAV format.
 */
export function pcm16ToWav(pcmData: Buffer, sampleRate: number = 24000, channels: number = 1): Buffer {
	const byteRate = sampleRate * channels * 2; // 16-bit = 2 bytes
	const blockAlign = channels * 2;
	const dataSize = pcmData.length;
	const headerSize = 44;
	const fileSize = headerSize + dataSize;

	const buffer = Buffer.alloc(fileSize);

	// RIFF header
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(fileSize - 8, 4);
	buffer.write("WAVE", 8);

	// fmt subchunk
	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16); // Subchunk1Size
	buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
	buffer.writeUInt16LE(channels, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(byteRate, 28);
	buffer.writeUInt16LE(blockAlign, 32);
	buffer.writeUInt16LE(16, 34); // BitsPerSample

	// data subchunk
	buffer.write("data", 36);
	buffer.writeUInt32LE(dataSize, 40);
	pcmData.copy(buffer, 44);

	return buffer;
}

/**
 * Extract message content from a conversation item.
 */
export function extractMessageContent(item: RealtimeConversationItemUserMessage): string {
	const content = item.content;
	if (!content) return "";

	if (typeof content === "string") return content;

	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const contentItem of content) {
			if (typeof contentItem === "string") {
				parts.push(contentItem);
			} else if (contentItem?.type === "input_text") {
				parts.push(contentItem.text || "");
			} else if (contentItem?.type === "input_audio") {
				const transcript = contentItem.transcript;
				if (transcript) {
					parts.push(transcript);
				}
			} else if (contentItem?.type === "input_image") {
				parts.push("[image]");
			}
		}
		return parts.join("");
	}

	return String(content);
}

/**
 * Extract output text from a response message.
 */
export function extractOutputText(
	item: RealtimeConversationItemSystemMessage | RealtimeConversationItemUserMessage | RealtimeConversationItemAssistantMessage,
): string {
	const content = item.content;
	if (!content) return "";

	if (typeof content === "string") return content;

	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const contentItem of content) {
			if (contentItem?.type === "output_text") {
				parts.push(contentItem.text || "");
			} else if (contentItem?.type === "output_audio") {
				parts.push(contentItem.transcript || "");
			}
		}
		return parts.join("");
	}

	return "";
}
