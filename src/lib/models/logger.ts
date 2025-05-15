export type MaximAPILogCheckAttachEvaluatorsResponse =
	| {
			data: {
				message?: string;
				canAttach: boolean;
				evaluatorsToIgnore?: string[];
			};
	  }
	| {
			error: {
				message: string;
			};
	  };
