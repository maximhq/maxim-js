import { MaximAPI } from "./maxim";

export class MaximTestConfigAPI extends MaximAPI {
	constructor(baseUrl: string, apiKey: string, isDebug?: boolean) {
		super(baseUrl, apiKey, isDebug);
	}
}
