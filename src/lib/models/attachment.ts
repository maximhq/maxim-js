export type MaximAPISignedURLResponse =
	| {
			data: {
				url: string;
			};
	  }
	| {
			error: {
				message: string;
			};
	  };
