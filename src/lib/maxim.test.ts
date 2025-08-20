import fs from "node:fs";
import { Maxim, QueryBuilder, VariableType } from "../../index";

const config: any = JSON.parse(fs.readFileSync(`${process.cwd()}/libs/maxim-js/testConfig.json`, "utf-8"));

// local config
const env = "dev";
const apiKey = config[env].apiKey;
const promptId = config[env].promptId;
const baseUrl = config[env].baseUrl;
const folderID = config[env].folderId;

let maxim: Maxim;

beforeAll(async () => {
	maxim = new Maxim({
		baseUrl: baseUrl,
		apiKey: apiKey,
	});
});

test("test getPrompt with deployment variables", async () => {
	const prompt = await maxim.getPrompt(promptId, new QueryBuilder().and().deploymentVar("Environment", "Beta").build());
	console.log(prompt);
	expect(prompt?.promptId).toBe(promptId);
	expect(prompt?.versionId).toBe(config.dev.promptVersionId);
	expect(prompt?.messages[0].content).toBe("you are an assistant");
	expect(prompt?.messages.length).toBe(3);
});

test("test getPrompt with deployment variables Environment=prod", async () => {
	const prompt = await maxim.getPrompt(promptId, new QueryBuilder().and().deploymentVar("Environment", "prod").build());
	expect(prompt?.promptId).toBe(promptId);
	expect(prompt?.versionId).toBe(config.dev.prodPromptVersionId);
	expect(prompt?.messages[0].content).toBe("You are a helpful assistant");
	expect(prompt?.messages.length).toBe(2);
});

test("test getPrompt with deployment variables Environment=prod and TenantId=123", async () => {
	const prompt = await maxim.getPrompt(
		promptId,
		new QueryBuilder().and().deploymentVar("Environment", "prod").deploymentVar("TenantId", 123).build(),
	);
	expect(prompt?.promptId).toBe(promptId);
	expect(prompt?.versionId).toBe(config.dev.prodAndT123PromptVersionId);
	expect(prompt?.messages.length).toBe(1);
});

test("test getPrompt with deployment variables Environment=stage and TenantId=123", async () => {
	const prompt = await maxim.getPrompt(
		promptId,
		new QueryBuilder().and().deploymentVar("Environment", "stage").deploymentVar("TenantId", 123).build(),
	);
	expect(prompt?.promptId).toBe(promptId);
	expect(prompt?.versionId).toBe(config.dev.stageAndT123PromptVersionId);
	expect(prompt?.messages.length).toBe(2);
});

test("test if prompt cache works fine", async () => {
	const prompt = await maxim.getPrompt(
		promptId,
		new QueryBuilder().and().deploymentVar("Environment", "prod").deploymentVar("TenantId", 123).build(),
	);
	expect(prompt?.promptId).toBe(promptId);
	expect(prompt?.versionId).toBe(config.dev.prodAndT123PromptVersionId);
	const prompt2 = await maxim.getPrompt(
		promptId,
		new QueryBuilder().and().deploymentVar("Environment", "prod").deploymentVar("TenantId", 123).build(),
	);
	expect(prompt2?.promptId).toBe(promptId);
	expect(prompt2?.versionId).toBe(config.dev.prodAndT123PromptVersionId);
});

test("test if fallback works fine", async () => {
	const prompt = await maxim.getPrompt(
		promptId,
		new QueryBuilder().and().deploymentVar("Environment", "prod").deploymentVar("TenantId", 1234, false).build(),
	);
	expect(prompt?.promptId).toBe(promptId);
	expect(prompt?.versionId).toBe(config.dev.prodPromptVersionId);
});

test("test if fallback works fine forceful", async () => {
	const prompt = await maxim.getPrompt(
		promptId,
		new QueryBuilder().and().deploymentVar("Environment", "prod").deploymentVar("TenantId", 123, true).build(),
	);
	console.log(prompt);
	expect(prompt?.promptId).toBe(promptId);
	expect(prompt?.versionId).toBe(config.dev.prodAndT123PromptVersionId);
});

test("fetch prompts using tags", async () => {
	const prompt = await maxim.getPrompt(
		promptId,
		new QueryBuilder()
			.and()
			.deploymentVar("Environment", "test")
			.tag("CustomerId", 1234)
			.tag("grade", "A")
			.tag("test", true)
			.exactMatch()
			.build(),
	);
	expect(prompt?.promptId).toBe(promptId);
	expect(prompt?.versionId).toBe(config.dev.testAndTagsCustomerIdGradeAndTest);
	expect(prompt?.version).toBe(4);
});

test("fetch all prompts deployed only on prod", async () => {
	const prompts = await maxim.getPrompts(new QueryBuilder().and().deploymentVar("Environment", "prod").build());
	console.log(prompts?.map((p) => p.versionId));
	prompts?.forEach((p) => {
		expect(config.dev.prodPromptVersions.includes(p.versionId)).toBe(true);
	});
	expect(prompts?.length).toBe(config.dev.prodPromptVersions.length);
});

test("fetch all prompts deployed prod and optional with tag filters", async () => {
	const prompts = await maxim.getPrompts(
		new QueryBuilder().and().deploymentVar("Environment", "prod").tag("CustomerId", 1234, false).build(),
	);
	console.log(prompts?.map((p) => p.versionId));
	prompts?.forEach((p) => {
		expect(config.dev.prodPromptsWithOptionalCustomerId1234.includes(p.versionId)).toBe(true);
	});
	expect(prompts?.length).toBe(config.dev.prodPromptsWithOptionalCustomerId1234.length);
});

test("fetch all prompts deployed on  prod with tag filters exact match", async () => {
	const prompts = await maxim.getPrompts(
		new QueryBuilder().and().deploymentVar("Environment", "prod").tag("CustomerId", 1234).exactMatch().build(),
	);
	expect(prompts?.length).toBe(2);
});

test("get folder using id", async () => {
	const folder = await maxim.getFolderById(folderID);
	expect(folder?.name).toBe("Test Folder");
});

test("get folder using tags", async () => {
	const folders = await maxim.getFolders(new QueryBuilder().and().tag("test", true).build());
	expect(folders?.[0].name).toBe("Test Folder");
	expect(folders?.length).toBe(1);
});

test("get prompts from a folder", async () => {
	const prompts = await maxim.getPrompts(
		new QueryBuilder().and().folder(config.dev.testFolderId).deploymentVar("Environment", "Staging").build(),
	);
	console.log(prompts?.map((p) => p.versionId));
	expect(prompts?.length).toBe(1);
	expect(prompts?.[0].versionId).toBe(config.dev.testFolderEnvStageTenant123PromptVersion);
});

test.skip("add dataset entries", async () => {
	await maxim.addDatasetEntries("clo7as7v2001axvt02rbx70qg", [
		{
			columnName: "input",
			cellValue: {
				type: VariableType.TEXT,
				payload: ""
			}
		},
		{
			columnName: "input",
			cellValue: {
				type: VariableType.TEXT,
				payload: "Hello",
			}
		},
	]);
});

test.skip("add dataset entries should throw error on invalid dataset id", async () => {
	try {
		await maxim.addDatasetEntries("clo7as7v2001axvt02rbx70", [
			{
				columnName: "input",
				cellValue: {
					type: VariableType.TEXT,
					payload: "Hello",
				},
			},
		]);
	} catch (e: any) {
		expect(e.message).toBe("Dataset not found");
	}
});

afterAll(async () => {
	await maxim.cleanup();
});
