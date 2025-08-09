import type { CSVFile } from "../utils/csvParser";
import type { Attachment } from "../types";

/**
 * Enumeration of supported variable types for dataset entries.
 *
 * Defines the data types that can be stored in dataset variables, affecting
 * how the data is processed and validated during test runs and evaluations.
 *
 * @enum {string}
 * @example
 * import { VariableType } from '@maximai/maxim-js';
 *
 * const textVariable = {
 *   type: VariableType.TEXT,
 *   payload: "Hello world"
 * };
 *
 * const jsonVariable = {
 *   type: VariableType.JSON,
 *   payload: JSON.stringify({ key: "value", number: 42 })
 * };
 */
export enum VariableType {
	/**
	 * Plain text data type for simple string values.
	 * @example "Hello world", "user input text", "response content"
	 */
	TEXT = "text",

	/**
	 * JSON data type for structured data stored as serialized JSON.
	 * @example '{"name": "John", "age": 30}', '[1, 2, 3]', '{"metadata": {...}}'
	 */
	JSON = "json",

	/**
	 * File data type for file attachments.
	 * @example "file.pdf", "image.png", "audio.mp3"
	 */
	FILE = "file",
}

export type Variable = {
	type: VariableType.TEXT;
	payload: string;
} | {
	type: VariableType.JSON;
	payload: string;
} | {
	type: VariableType.FILE;
	payload: Attachment[];
};

export type VariableFileAttachment = {
	id: string;
	url: string;
	hosted: boolean;
	prefix?: string;
	props: { [key: string]: number | string | boolean };
};

export type FileVariablePayload = {
	files: VariableFileAttachment[];
	entryId: string;
};

export type DatasetEntry = {
	rowNo?: number;
	columnName: string;
	cellValue: Variable;
	columnId?: string;
};

export type DatasetRow = Record<string, string | string[]>;

export type MaximAPIDatasetResponse =
	| {
			data: { data: DatasetRow; id: string };
	  }
	| {
			error: {
				message: string;
			};
	  };

export type MaximAPIDatasetStructureResponse =
	| {
			data: Record<string, "INPUT" | "EXPECTED_OUTPUT" | "VARIABLE">;
	  }
	| {
			error: {
				message: string;
			};
	  };

export type MaximAPIDatasetTotalRowsResponse =
	| {
			data: number;
	  }
	| {
			error: {
				message: string;
			};
	  };

export type MaximAPIDatasetEntriesResponse =
	| {
			data: {
				ids: string[];
				cells: {
					rowNo: number;
					entryId: string;
					columnId: string;
					columnName: string;
				}[];
			};
	  }
	| {
			error: {
				message: string;
			};
	  };

export type InputColumn = "INPUT";
export type ExpectedOutputColumn = "EXPECTED_OUTPUT";
export type ContextToEvaluateColumn = "CONTEXT_TO_EVALUATE";
export type VariableColumn = "VARIABLE";
export type NullableVariableColumn = "NULLABLE_VARIABLE";
export type OutputColumn = "OUTPUT";

export type DataStructure = Record<
	string,
	InputColumn | ExpectedOutputColumn | ContextToEvaluateColumn | VariableColumn | NullableVariableColumn
>;

export type MapDataStructureToValue<T> = T extends InputColumn
	? string
	: T extends ExpectedOutputColumn
		? string
		: T extends ContextToEvaluateColumn
			? string | string[]
			: T extends VariableColumn
				? string | string[]
				: T extends NullableVariableColumn
					? string | string[] | undefined | null
					: never;

/**
 * Type representing a data entry that conforms to a specific data structure.
 *
 * Provides type-safe access to dataset columns based on the defined data structure.
 * The type automatically handles required vs optional fields based on column types,
 * with nullable variable columns being optional and others being required.
 *
 * @template T - The data structure type defining column names and types
 * @example
 * import { Data, createDataStructure } from '@maximai/maxim-js';
 *
 * // Define a data structure
 * const structure = createDataStructure({
 *   userInput: "INPUT",
 *   expectedResponse: "EXPECTED_OUTPUT",
 *   context: "CONTEXT_TO_EVALUATE",
 *   metadata: "NULLABLE_VARIABLE"
 * });
 *
 * // Data type is automatically inferred
 * const dataEntry: Data<typeof structure> = {
 *   userInput: "What is the weather?",         // Required
 *   expectedResponse: "Sunny, 72°F",           // Required
 *   context: ["weather data", "location"],     // Required
 *   metadata: undefined                        // Optional (nullable)
 * };
 */
export type Data<T extends DataStructure | undefined> = T extends DataStructure
	? {
			[K in keyof T as undefined | null extends MapDataStructureToValue<T[K]> ? never : K]: MapDataStructureToValue<T[K]>;
		} & { [K in keyof T as undefined | null extends MapDataStructureToValue<T[K]> ? K : never]?: MapDataStructureToValue<T[K]> }
	: Record<string, MapDataStructureToValue<DataStructure[string]> | undefined>;

export type DataValue<T extends DataStructure | undefined> = T extends DataStructure
	?
			| Data<T>[]
			| string
			| CSVFile<Record<keyof T, number>>
			| ((page: number) => Promise<Data<T>[] | null | undefined> | Data<T>[] | null | undefined)
	: string;

export type SignedURLResponse = {
		url: string;
		key: string;
	};
	
export type DatasetAttachmentUploadResponse = 
		| {
			data: SignedURLResponse;
		}
		| {
			error: {
				message: string;
			};
		};