import { createReadStream, createWriteStream, Stats } from "fs";
import { EOL } from "os";
import { Transform, TransformCallback } from "stream";

/**
 * Configuration options for parsing CSV files.
 *
 * @property delimiter - Character used to separate fields in the CSV
 * @property hasHeader - Whether the first row contains column headers
 * @property quoteChar - Character used to quote fields containing special characters
 * @property escapeChar - Character used to escape quote characters within quoted fields
 * @example
 * // Default CSV parsing
 * const options: CSVParseOptions = {
 *   delimiter: ",",
 *   hasHeader: true,
 *   quoteChar: '"',
 *   escapeChar: '"'
 * };
 *
 * @example
 * // Tab-separated values without headers
 * const tsvOptions: CSVParseOptions = {
 *   delimiter: "\t",
 *   hasHeader: false,
 *   quoteChar: "'",
 *   escapeChar: "\\"
 * };
 */
export type CSVParseOptions = {
	delimiter?: string;
	hasHeader?: boolean;
	quoteChar?: string;
	escapeChar?: string;
};

/**
 * Configuration options for writing CSV files.
 *
 * @property delimiter - Character used to separate fields
 * @property includeHeader - Whether to include column headers in the output
 * @property quoteChar - Character used to quote fields containing special characters
 * @property escapeChar - Character used to escape quote characters within quoted fields
 */
export type CSVWriteOptions = {
	delimiter?: string;
	includeHeader?: boolean;
	quoteChar?: string;
	escapeChar?: string;
};

/**
 * Type representing the structure of columns in a CSV file.
 * Maps column names to their zero-based index positions.
 *
 * @example
 * const structure: ColumnStructure = {
 *   "firstName": 0,
 *   "lastName": 1,
 *   "email": 2,
 *   "age": 3
 * };
 */
type ColumnStructure = Record<string, number>;

/**
 * Represents a CSV file with optional type information for its columns.
 *
 * Provides methods for reading, parsing, and manipulating CSV data with
 * optional type safety through column structure definitions. Supports
 * both streaming and batch operations for efficient processing of large files.
 *
 * @template T - Optional column structure type for typed access
 * @class CSVFile
 * @example
 * // Basic usage without column structure
 * const csvFile = new CSVFile("data.csv");
 * const rowCount = await csvFile.getRowCount();
 * const firstRow = await csvFile.getRow(0);
 *
 * @example
 * // With typed column structure
 * const typedCSV = new CSVFile("users.csv", {
 *   name: 0,
 *   email: 1,
 *   age: 2
 * });
 *
 * const user = await typedCSV.getRow(0);
 * console.log(user.name, user.email, user.age); // Type-safe access
 *
 * @example
 * // Filtering and mapping
 * const adults = await csvFile.filter(row => parseInt(row.age) >= 18);
 * const names = await csvFile.map(row => row.name.toUpperCase());
 *
 * @example
 * // Writing data to CSV
 * await CSVFile.writeToFile(
 *   [{ name: "John", email: "john@example.com" }],
 *   "output.csv",
 *   { name: 0, email: 1 }
 * );
 */
export class CSVFile<T extends ColumnStructure | undefined = undefined> {
	private filePath: string;
	private options: Required<CSVParseOptions>;
	private headerRow: string[] | null = null;
	private rowCount: number | null = null;
	private columnCount: number | null = null;
	private columnStructure: T;
	private fileStats: Stats | null = null;

	/**
	 * Creates a new CSVFile instance.
	 *
	 * @param filePath - The path to the CSV file
	 * @param columnStructure - Optional column structure mapping column names to indices
	 * @param options - Optional parsing configuration
	 * @throws {Error} When column structure is provided but doesn't match the file headers
	 * @example
	 * // Simple CSV file
	 * const csv = new CSVFile("data.csv");
	 *
	 * @example
	 * // With column structure for type safety
	 * const csv = new CSVFile("users.csv", {
	 *   id: 0,
	 *   name: 1,
	 *   email: 2
	 * });
	 *
	 * @example
	 * // With custom parsing options
	 * const csv = new CSVFile("data.tsv", undefined, {
	 *   delimiter: "\t",
	 *   hasHeader: false,
	 *   quoteChar: "'"
	 * });
	 */
	constructor(filePath: string, columnStructure?: T, options: CSVParseOptions = {}) {
		this.filePath = filePath;
		this.columnStructure = columnStructure as T;
		this.options = {
			delimiter: options.delimiter ?? ",",
			hasHeader: columnStructure ? true : (options.hasHeader ?? true),
			quoteChar: options.quoteChar ?? '"',
			escapeChar: options.escapeChar ?? '"',
		};

		// If column structure is provided, validate headers immediately
		if (columnStructure) {
			this.validateHeaders();
		}
	}

	/**
	 * Validates the headers of the CSV file against the provided column structure.
	 *
	 * @private
	 * @async
	 * @returns
	 * @throws {Error} When headers don't match the column structure
	 */
	private async validateHeaders(): Promise<void> {
		const headerRow = await this.getHeader();
		if (!headerRow) {
			throw new Error("Failed to read header row from CSV file.");
		}

		if (this.columnStructure) {
			for (const [columnName, index] of Object.entries(this.columnStructure)) {
				if (headerRow[index] !== columnName) {
					throw new Error(
						`Column structure does not match CSV "${this.filePath}" headers. \nExpected column "${columnName}" at index [${index}], but found "${headerRow[index]}".`,
						{
							cause: JSON.stringify(
								{
									expectedColumn: columnName,
									expectedIndex: index,
									actualColumn: headerRow[index],
									headerRow: headerRow,
								},
								null,
								2,
							),
						},
					);
				}
			}
		}
	}

	/**
	 * Parses a single row of the CSV file, handling quotes and escaping.
	 *
	 * @private
	 * @param row - The raw row string to parse
	 * @returns Array of parsed field values
	 */
	private parseRow(row: string): string[] {
		const { delimiter, quoteChar, escapeChar } = this.options;
		const result: string[] = [];
		let field = "";
		let inQuotes = false;

		for (let i = 0; i < row.length; i++) {
			const char = row[i];
			const nextChar = row[i + 1];

			if (inQuotes) {
				if (char === quoteChar && nextChar === quoteChar) {
					field += char;
					i++;
				} else if (char === quoteChar) {
					inQuotes = false;
				} else {
					field += char;
				}
			} else {
				if (char === quoteChar) {
					inQuotes = true;
				} else if (char === delimiter) {
					result.push(field);
					field = "";
				} else if (char === escapeChar && nextChar === delimiter) {
					field += delimiter;
					i++;
				} else {
					field += char;
				}
			}
		}

		result.push(field);
		return result;
	}

	/**
	 * Gets the total number of rows in the CSV file.
	 *
	 * @async
	 * @returns The total number of rows (excluding header if present)
	 * @example
	 * const csv = new CSVFile("large-dataset.csv");
	 * const totalRows = await csv.getRowCount();
	 * console.log(`Dataset contains ${totalRows} records`);
	 */
	async getRowCount(): Promise<number> {
		if (this.rowCount === null) {
			let count = 0;
			await this.processFile((row) => {
				count++;
			});
			this.rowCount = count;
		}
		return this.rowCount;
	}

	/**
	 * Gets the number of columns in the CSV file.
	 *
	 * @async
	 * @returns The number of columns
	 * @throws {Error} When unable to read the header row
	 * @example
	 * const columnCount = await csv.getColumnCount();
	 * console.log(`CSV has ${columnCount} columns`);
	 */
	async getColumnCount(): Promise<number> {
		if (this.columnCount === null) {
			const headerRow = await this.getHeader();
			if (!headerRow) {
				throw new Error("Failed to read header row from CSV file.");
			}
			this.columnCount = headerRow.length;
		}
		return this.columnCount;
	}

	/**
	 * Gets the header row of the CSV file.
	 *
	 * @async
	 * @returns Array of header field names, or null if no header
	 * @throws {Error} When unable to read the header row
	 * @example
	 * const headers = await csv.getHeader();
	 * console.log("Columns:", headers); // ["name", "email", "age"]
	 */
	async getHeader(): Promise<string[] | null> {
		if (this.headerRow === null) {
			return new Promise((resolve, reject) => {
				let headerProcessed = false;
				const parser = new Transform({
					transform: (chunk: Buffer, encoding: string, callback: TransformCallback) => {
						if (!headerProcessed) {
							const line = chunk.toString().split(EOL)[0];
							this.headerRow = this.parseRow(line);
							headerProcessed = true;
							parser.destroy();
							resolve(this.headerRow);
						}
						callback();
					},
					flush: (callback: TransformCallback) => {
						if (!headerProcessed) {
							reject(new Error("Failed to read header row from CSV file."));
						}
						callback();
					},
				});

				createReadStream(this.filePath)
					.pipe(parser)
					.on("error", (err) => {
						reject(err);
					});
			});
		}
		return this.headerRow;
	}

	/**
	 * Gets a specific row from the CSV file.
	 * @param index The zero-based index of the row to retrieve.
	 * @returns A promise that resolves to the row data, either as an object (if column structure is provided) or as an array of strings.
	 * @throws {Error} if the row index is out of bounds.
	 * @example
	 * const row = await csvFile.getRow(0);
	 * console.log(row);
	 * // { column1: "value1", column2: "value2" } (if column structure is provided)
	 * // OR
	 * // ["value1", "value2"] (if column structure is not provided)
	 */
	async getRow(index: number): Promise<(T extends ColumnStructure ? { [K in keyof T]: string } : string[]) | null> {
		if (index < 0) {
			throw new Error("Row index must be non-negative.");
		}

		return new Promise((resolve, reject) => {
			let currentRow = -1;
			let bytesRead = 0;
			let lineBuffer = "";

			const parser = new Transform({
				transform: (chunk: Buffer, encoding: string, callback: TransformCallback) => {
					bytesRead += chunk.length;
					const data = lineBuffer + chunk.toString();
					const lines = data.split(EOL);
					lineBuffer = lines.pop() || "";

					for (const line of lines) {
						if (this.options.hasHeader && currentRow === -1) {
							currentRow++;
							continue;
						}

						if (currentRow === index) {
							const parsedRow = this.parseRow(line);
							resolve(this.createTypedRow(parsedRow));
							parser.destroy();
							return;
						}

						currentRow++;
					}

					callback();
				},
				flush: (callback: TransformCallback) => {
					if (lineBuffer) {
						currentRow++;
						if (currentRow === index) {
							const parsedRow = this.parseRow(lineBuffer);
							resolve(this.createTypedRow(parsedRow));
						} else {
							reject(new Error(`Row index ${index} is out of bounds.`));
						}
					} else {
						reject(new Error(`Row index ${index} is out of bounds.`));
					}
					callback();
				},
			});

			createReadStream(this.filePath)
				.pipe(parser)
				.on("error", (err) => {
					reject(err);
				});
		});
	}

	/**
	 * Creates a typed row object based on the column structure.
	 * @private
	 * @param row The raw row data as an array of strings.
	 * @returns A typed row object if column structure is provided, otherwise the original array.
	 */
	private createTypedRow(row: string[]): T extends ColumnStructure ? { [K in keyof T]: string } : string[] {
		if (this.columnStructure) {
			const typedRow: any = {} as any;
			for (const [key, index] of Object.entries(this.columnStructure)) {
				typedRow[key as keyof T] = row[index];
			}
			return typedRow;
		}
		return row as any;
	}

	/**
	 * Filters rows of the CSV file based on a predicate function.
	 * @param predicate A function that takes a row and returns true if the row should be included in the result.
	 * @returns A promise that resolves to an array of filtered rows.
	 */
	async filter(
		predicate: (row: T extends ColumnStructure ? { [K in keyof T]: string } : string[]) => boolean,
	): Promise<(T extends ColumnStructure ? { [K in keyof T]: string } : string[])[]> {
		const result: (T extends ColumnStructure ? { [K in keyof T]: string } : string[])[] = [];

		await this.processFile((row) => {
			const typedRow = this.createTypedRow(row);
			if (predicate(typedRow)) {
				result.push(typedRow);
			}
		});

		return result;
	}

	/**
	 * Maps each row of the CSV file using a mapper function.
	 * @param mapper A function that takes a row and returns a transformed value.
	 * @returns A promise that resolves to an array of mapped values.
	 */
	async map<U>(mapper: (row: T extends ColumnStructure ? { [K in keyof T]: string } : string[]) => U): Promise<U[]> {
		const result: U[] = [];

		await this.processFile((row) => {
			const typedRow = this.createTypedRow(row);
			result.push(mapper(typedRow));
		});

		return result;
	}

	/**
	 * Processes the CSV file row by row.
	 * @private
	 * @param rowProcessor A function to process each row.
	 * @returns A promise that resolves when all rows have been processed.
	 */
	private async processFile(rowProcessor: (row: string[]) => void): Promise<void> {
		return new Promise((resolve, reject) => {
			let isFirstRow = true;
			let lineBuffer = "";

			const parser = new Transform({
				transform: (chunk: Buffer, encoding: string, callback: TransformCallback) => {
					const data = lineBuffer + chunk.toString();
					const lines = data.split(EOL);
					lineBuffer = lines.pop() || "";

					for (const line of lines) {
						if (isFirstRow && this.options.hasHeader) {
							isFirstRow = false;
							continue;
						}

						const row = this.parseRow(line);
						rowProcessor(row);
					}

					callback();
				},
				flush: (callback: TransformCallback) => {
					if (lineBuffer) {
						const row = this.parseRow(lineBuffer);
						rowProcessor(row);
					}
					resolve();
					callback();
				},
			});

			createReadStream(this.filePath)
				.pipe(parser)
				.on("error", (err) => {
					reject(err);
				});
		});
	}

	/**
	 * Restructures a CSVFile object with a new column structure.
	 * @param csvFile The original CSVFile object.
	 * @param newColumnStructure The new column structure to apply.
	 * @returns A new CSVFile object with the updated column structure.
	 * @throws {Error} if the new column structure doesn't match the CSV file headers.
	 */
	static async restructure<U extends ColumnStructure>(
		csvFile: CSVFile<ColumnStructure | undefined>,
		newColumnStructure: U,
	): Promise<CSVFile<U>> {
		// Create a new CSVFile object with the same file path
		const newCsvFile = new CSVFile<U>(csvFile.filePath);

		// Copy all enumerable properties from the original object to the new one
		Object.assign(newCsvFile, csvFile);

		// Update the column structure
		newCsvFile.columnStructure = newColumnStructure;

		// Validate headers with the new column structure
		await newCsvFile.validateHeaders();

		// Reset cached values that might be affected by the new structure
		newCsvFile.columnCount = null;

		return newCsvFile;
	}

	/**
	 * Writes data to a CSV file.
	 * @param data The data to write, either as an array of objects or an array of arrays.
	 * @param outputPath The path where the CSV file should be written.
	 * @param columnStructure Optional column structure for typed data.
	 * @param options Optional writing options.
	 * @returns A promise that resolves when the file has been written.
	 * @example
	 * const data = [
	 *     { column1: "value1", column2: "value2" },
	 *     { column1: "value3", column2: "value4" },
	 * ];
	 * await CSVFile.writeToFile(
	 *     data,
	 *     "path/to/output.csv",
	 *     { column1: 0, column2: 1 }
	 * );
	 */
	static async writeToFile<T extends ColumnStructure | undefined = undefined>(
		data: (T extends ColumnStructure ? { [K in keyof T]: string } : string[])[],
		outputPath: string,
		columnStructure?: T,
		options: CSVWriteOptions = {},
	): Promise<void> {
		const writeOptions = {
			delimiter: options.delimiter ?? ",",
			includeHeader: options.includeHeader ?? true,
			quoteChar: options.quoteChar ?? '"',
			escapeChar: options.escapeChar ?? '"',
		};

		return new Promise((resolve, reject) => {
			const writeStream = createWriteStream(outputPath);

			const processRow = (row: T extends ColumnStructure ? { [K in keyof T]: string } : string[]): string => {
				const rowArray = columnStructure
					? Object.keys(columnStructure).map((key) => (row as { [K in keyof T]: string })[key as keyof T])
					: (row as string[]);
				return CSVFile.formatRow(rowArray, writeOptions) + EOL;
			};

			writeStream.on("error", (err) => {
				reject(err);
			});

			writeStream.on("finish", () => {
				resolve();
			});

			const writeData = async () => {
				if (writeOptions.includeHeader && columnStructure) {
					const headerRow = Object.keys(columnStructure);
					if (!writeStream.write(CSVFile.formatRow(headerRow, writeOptions) + EOL)) {
						await new Promise((resolve) => writeStream.once("drain", () => resolve("drained")));
					}
				}

				for (const row of data) {
					if (!writeStream.write(processRow(row))) {
						await new Promise((resolve) => writeStream.once("drain", () => resolve("drained")));
					}
				}

				writeStream.end();
			};

			writeData().catch(reject);
		});
	}

	/**
	 * Formats a row of data for CSV output.
	 * @private
	 * @param row The row data as an array of strings.
	 * @param options The CSV writing options.
	 * @returns A formatted string representing the CSV row.
	 */
	private static formatRow(row: string[], options: CSVWriteOptions): string {
		return row
			.map((field) => {
				if (field.includes(options.delimiter ?? ",") || field.includes(options.quoteChar ?? '"') || field.includes("\n")) {
					return `${options.quoteChar}${field.replace(new RegExp(options.quoteChar ?? '"', "g"), options.escapeChar ?? '"' + options.quoteChar ?? '"')}${options.quoteChar ?? '"'}`;
				}
				return field;
			})
			.join(options.delimiter ?? ",");
	}
}
