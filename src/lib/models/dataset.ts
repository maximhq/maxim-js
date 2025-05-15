import type { CSVFile } from "../utils/csvParser";

export enum VariableType {
	TEXT = "text",
	JSON = "json",
}

export type Variable = {
	type: VariableType;
	payload: string;
};

export type DatasetEntry = {
	input: Variable;
	context?: Variable;
	expectedOutput?: Variable;
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
