import { createReadStream, createWriteStream, Stats } from "fs";
import { EOL } from "os";
import { Transform, TransformCallback } from "stream";

/**
 * Options for parsing CSV files.
 */
export type CSVParseOptions = {
	delimiter?: string;
	hasHeader?: boolean;
	quoteChar?: string;
	escapeChar?: string;
};

/**
 * Options for writing CSV files.
 */
export type CSVWriteOptions = {
	delimiter?: string;
	includeHeader?: boolean;
	quoteChar?: string;
	escapeChar?: string;
};

/**
 * Represents the structure of columns in a CSV file.
 */
type ColumnStructure = Record<string, number>;

/**
 * Represents a CSV file with optional type information for its columns.
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
	 * @param filePath The path to the CSV file.
	 * @param columnStructure Optional column structure for typed access. (maps column names to column indices)
	 * @param options Optional parsing options.
	 * @throws {Error} if column structure is provided and headers don't match.
	 * @example
	 * const csvFile = new CSVFile("path/to/file.csv", { column1: 0, column2: 1 });
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
	 * @private
	 * @throws {Error} if headers don't match the column structure.
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
	 * Parses a single row of the CSV file.
	 * @private
	 * @param row The row to parse.
	 * @returns An array of parsed fields.
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
	 * @returns A promise that resolves to the number of rows.
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
	 * @returns A promise that resolves to the number of columns.
	 * @throws {Error} if unable to read the header row.
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
	 * @returns A promise that resolves to an array of header fields, or null if there's no header.
	 * @throws {Error} if unable to read the header row.
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
