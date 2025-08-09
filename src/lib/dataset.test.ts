import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Maxim, VariableType } from "../../index";
import { MaximDatasetAPI } from "./apis/dataset";
import type { DatasetEntry } from "./models/dataset";
import type { FileAttachment, FileDataAttachment, UrlAttachment } from "./types";

// Gate external integration tests behind environment flag
const RUN_E2E = process.env['MAXIM_E2E'] === "1";

// Load configuration only when running E2E to avoid CI failures
let baseUrl = "";
let apiKey = "";
let testDatasetId = "test-dataset-id";
if (RUN_E2E) {
  const config = JSON.parse(fs.readFileSync(`${process.cwd()}/testConfig.json`, "utf-8"));
  const env = "dev"; // Change this to your test environment
  if (!config[env]?.apiKey) throw new Error("Missing apiKey in testConfig.json");
  if (!config[env]?.baseUrl) throw new Error("Missing baseUrl in testConfig.json");
  baseUrl = config[env].baseUrl;
  apiKey = config[env].apiKey;
  testDatasetId = config[env].datasetId || testDatasetId;
}

let datasetAPI: MaximDatasetAPI;

// Test data setup
const testDir = path.join(__dirname, "test-data");
const testImagePath = path.join(testDir, "test-image.png");
const testTextPath = path.join(testDir, "test-document.txt");
const testJsonPath = path.join(testDir, "test-data.json");

if (RUN_E2E) beforeAll(async () => {
	datasetAPI = new MaximDatasetAPI(baseUrl, apiKey, true); // Enable debug mode

	// Create test directory if it doesn't exist
	if (!fs.existsSync(testDir)) {
		fs.mkdirSync(testDir, { recursive: true });
	}

	// Create test files if they don't exist
	await createTestFiles();
});

if (RUN_E2E) afterAll(async () => {
	// Clean up test files
	if (fs.existsSync(testDir)) {
		fs.rmSync(testDir, { recursive: true, force: true });
	}
});

async function createTestFiles(): Promise<void> {
	// Create a test image (1x1 pixel PNG)
	const pngBuffer = Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
		0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00,
		0xff, 0xff, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33,
		0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
	]);
	fs.writeFileSync(testImagePath, pngBuffer);

	// Create a test text file
	const textContent = "This is a test document for dataset file attachment testing.\nIt contains multiple lines of text to test file processing.";
	fs.writeFileSync(testTextPath, textContent, "utf-8");

	// Create a test JSON file
	const jsonContent = {
		testData: true,
		timestamp: new Date().toISOString(),
		metadata: {
			purpose: "dataset testing",
			fileType: "json",
			size: "small"
		},
		items: ["item1", "item2", "item3"]
	};
	fs.writeFileSync(testJsonPath, JSON.stringify(jsonContent, null, 2), "utf-8");
}

function createFileAttachment(filePath: string, name: string, mimeType?: string): FileAttachment {
	return {
		id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
		type: "file",
		path: filePath,
		name: name,
		mimeType: mimeType,
		tags: { test: "true" },
		metadata: { source: "test-suite" }
	};
}

function createFileDataAttachment(data: Buffer, name: string, mimeType?: string): FileDataAttachment {
	return {
		id: `filedata-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
		type: "fileData",
		data: data,
		name: name,
		mimeType: mimeType,
		tags: { test: "true" },
		metadata: { source: "test-suite" }
	};
}

function createUrlAttachment(url: string, name: string, mimeType?: string): UrlAttachment {
	return {
		id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
		type: "url",
		url: url,
		name: name,
		mimeType: mimeType,
		tags: { test: "true" },
		metadata: { source: "test-suite" }
	};
}

(RUN_E2E ? describe : describe.skip)("MaximDatasetAPI - addDatasetEntries Integration Tests", () => {
	test("should add dataset entries with file attachments", async () => {
		const fileAttachment = createFileAttachment(testImagePath, "test-image.png", "image/png");
		
		const timestamp = Date.now();
		const uniqueId = `file-attachment-test-${timestamp}-${Math.random().toString(36).slice(2, 11)}`;
		
		const datasetEntries: DatasetEntry[] = [
			{
				columnName: `test_file_attachment_${timestamp}_${uniqueId}`,
				cellValue: {
					type: VariableType.FILE,
					payload: [fileAttachment]
				}
			}
		];

		await datasetAPI.addDatasetEntries(testDatasetId, datasetEntries);
	}, 30000); // 30 second timeout for file upload

	test("should add dataset entries with fileData attachments", async () => {
		const textContent = fs.readFileSync(testTextPath);
		const fileDataAttachment = createFileDataAttachment(textContent, "test-document.txt", "text/plain");
		
		const timestamp = Date.now();
		const uniqueId = `filedata-attachment-test-${timestamp}-${Math.random().toString(36).slice(2, 11)}`;
		
		const datasetEntries: DatasetEntry[] = [
			{
				columnName: `test_filedata_attachment_${timestamp}_${uniqueId}`,
				cellValue: {
					type: VariableType.FILE,
					payload: [fileDataAttachment]
				}
			}
		];

		await datasetAPI.addDatasetEntries(testDatasetId, datasetEntries);
	}, 30000);

	test("should add dataset entries with URL attachments", async () => {
		// Using a publicly accessible test image URL
		const urlAttachment = createUrlAttachment(
			"https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png", 
			"test-url-image.png", 
			"image/png"
		);
		
		const timestamp = Date.now();
		const uniqueId = `url-attachment-test-${timestamp}-${Math.random().toString(36).slice(2, 11)}`;
		
		const datasetEntries: DatasetEntry[] = [
			{
				columnName: `test_url_attachment_${timestamp}_${uniqueId}`,
				cellValue: {
					type: VariableType.FILE,
					payload: [urlAttachment]
				}
			}
		];

		await datasetAPI.addDatasetEntries(testDatasetId, datasetEntries);
	}, 30000);

	test("should add dataset entries with multiple file types", async () => {
		const fileAttachment = createFileAttachment(testJsonPath, "test-data.json", "application/json");
		const jsonContent = fs.readFileSync(testJsonPath);
		const fileDataAttachment = createFileDataAttachment(jsonContent, "test-data-copy.json", "application/json");
		const urlAttachment = createUrlAttachment(
			"https://httpbin.org/json", 
			"remote-json.json", 
			"application/json"
		);
		
		const timestamp = Date.now();
		const uniqueId = `multiple-files-test-${timestamp}-${Math.random().toString(36).slice(2, 11)}`;
		
		const datasetEntries: DatasetEntry[] = [
			{
				columnName: `test_multiple_files_${timestamp}_${uniqueId}`,
				cellValue: {
					type: VariableType.FILE,
					payload: [fileAttachment, fileDataAttachment, urlAttachment]
				}
			}
		];

		await datasetAPI.addDatasetEntries(testDatasetId, datasetEntries);
	}, 45000); // Longer timeout for multiple files

	test("should handle large file size validation", async () => {
		// Create a large buffer (over 100MB limit)
		const largeBuffer = Buffer.alloc(101 * 1024 * 1024, 'a'); // 101MB
		const largeFileAttachment = createFileDataAttachment(largeBuffer, "large-file.txt", "text/plain");
		
		const timestamp = Date.now();
		const uniqueId = `large-file-test-${timestamp}-${Math.random().toString(36).slice(2, 11)}`;
		
		const datasetEntries: DatasetEntry[] = [
			{
				columnName: `test_large_file_${timestamp}_${uniqueId}`,
				cellValue: {
					type: VariableType.FILE,
					payload: [largeFileAttachment]
				}
			}
		];

		await expect(datasetAPI.addDatasetEntries(testDatasetId, datasetEntries))
			.rejects.toThrow(/File size exceeds the maximum allowed size/);
	});

	test("should infer MIME types from file extensions", async () => {
		// Test with file that has no explicit MIME type
		const fileAttachment = createFileAttachment(testImagePath, "test-without-mimetype.png");		
		const timestamp = Date.now();
		const uniqueId = `mime-inference-test-${timestamp}-${Math.random().toString(36).slice(2, 11)}`;
		
		const datasetEntries: DatasetEntry[] = [
			{
				columnName: `test_mime_inference_${timestamp}_${uniqueId}`,
				cellValue: {
					type: VariableType.FILE,
					payload: [fileAttachment]
				}
			}
		];

		await datasetAPI.addDatasetEntries(testDatasetId, datasetEntries);
	}, 30000);

	test("should handle invalid URL attachments gracefully", async () => {
		const timestamp = Date.now();
		const uniqueId = `invalid-url-test-${timestamp}-${Math.random().toString(36).slice(2, 11)}`;
		const invalidUrlAttachment = createUrlAttachment("invalid-url", `${uniqueId}.txt`, "text/plain");
		
		const datasetEntries: DatasetEntry[] = [
			{
				columnName: `test_invalid_url_${timestamp}_${uniqueId}`,
				cellValue: {
					type: VariableType.FILE,
					payload: [invalidUrlAttachment]
				}
			}
		];

		await expect(datasetAPI.addDatasetEntries(testDatasetId, datasetEntries))
			.rejects.toThrow(/Invalid URL/);
	});

	test("should handle non-existent file attachments gracefully", async () => {
		const nonExistentFileAttachment = createFileAttachment("/path/to/nonexistent/file.txt", "missing.txt", "text/plain");
		
		const datasetEntries: DatasetEntry[] = [
			{
				columnName: "context",
				cellValue: {
					type: VariableType.FILE,
					payload: [nonExistentFileAttachment]
				}
			}
		];

		await expect(datasetAPI.addDatasetEntries(testDatasetId, datasetEntries))
			.rejects.toThrow(/File not found/);
	});

	test("should add text and JSON dataset entries", async () => {
		const datasetEntries: DatasetEntry[] = [
			{
				columnName: "Input",
				cellValue: {
					type: VariableType.TEXT,
					payload: "This is a test text entry"
				}
			},
			{
				columnName: "expected_output",
				cellValue: {
					type: VariableType.JSON,
					payload: JSON.stringify({ test: true, value: 42, array: [1, 2, 3] })
				}
			}
		];

		await datasetAPI.addDatasetEntries(testDatasetId, datasetEntries);
	});
});

(RUN_E2E ? describe : describe.skip)("MaximDatasetAPI - Helper Methods Tests", () => {
	test("should get dataset total rows", async () => {
		const totalRows = await datasetAPI.getDatasetTotalRows(testDatasetId);
		expect(typeof totalRows).toBe("number");
		expect(totalRows).toBeGreaterThanOrEqual(0);
	});

	test("should get dataset structure", async () => {
		const structure = await datasetAPI.getDatasetDatastructure(testDatasetId);
		expect(typeof structure).toBe("object");
		expect(structure).not.toBeNull();
	});
});
