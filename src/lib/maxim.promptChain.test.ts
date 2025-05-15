import fs from "node:fs";
import { Maxim } from "./maxim";
import { QueryBuilder } from "./models/queryBuilder";

const config: any = JSON.parse(fs.readFileSync(`${process.cwd()}/libs/maxim-js/testConfig.json`, "utf-8"));

// local config
const apiKey = config.dev.apiKey;
const promptChainId = config.dev.promptChainId;
const baseUrl = config.dev.baseUrl;
const folderID = config.dev.folderId;

let maxim: Maxim;

beforeAll(async () => {
	maxim = new Maxim({
		baseUrl: baseUrl,
		apiKey: apiKey,
	});
});

test("test getPromptChain with deployment variables", async () => {
	const promptChain = await maxim.getPromptChain(
		promptChainId,
		new QueryBuilder().and().deploymentVar("Environment", "Production").build(),
	);
	console.log(JSON.stringify(promptChain, null, 2));
	expect(promptChain.promptChainId).toBe(promptChainId);
	expect(promptChain.versionId).toBe(config.dev.promptChainVersionId);
	expect(promptChain.nodes[0].prompt.messages[0].content).toBe("you are an assistant");
	expect(promptChain.nodes.length).toBe(1);
});

test("test getPromptChain with deployment variables Environment=prod", async () => {
	const promptChain = await maxim.getPromptChain(promptChainId, new QueryBuilder().and().deploymentVar("Environment", "Prod").build());
	expect(promptChain.promptChainId).toBe(promptChainId);
	expect(promptChain.versionId).toBe(config.dev.prodPromptChainVersionId);
	expect(promptChain.nodes[0].prompt.messages[0].content).toBe("You are a helpful assistant");
	expect(promptChain.nodes.length).toBe(1);
});

test("test getPromptChain with deployment variables Environment=Prod and TenantId=123", async () => {
	const promptChain = await maxim.getPromptChain(
		promptChainId,
		new QueryBuilder().and().deploymentVar("Environment", "Prod").deploymentVar("TenantID", 123).build(),
	);
	expect(promptChain.promptChainId).toBe(promptChainId);
	expect(promptChain.versionId).toBe(config.dev.prodAndT123PromptChainVersionId);
	expect(promptChain.nodes.length).toBe(1);
});

test("test getPromptChain with deployment variables Environment=stage and TenantId=123", async () => {
	const promptChain = await maxim.getPromptChain(
		promptChainId,
		new QueryBuilder().and().deploymentVar("Environment", "Staging").deploymentVar("TenantID", 123).build(),
	);
	expect(promptChain.promptChainId).toBe(promptChainId);
	expect(promptChain.versionId).toBe(config.dev.stageAndT123PromptChainVersionId);
	expect(promptChain.nodes.length).toBe(2);
});

test("test if prompt chain cache works fine", async () => {
	const promptChain = await maxim.getPromptChain(
		promptChainId,
		new QueryBuilder().and().deploymentVar("Environment", "Prod").deploymentVar("TenantID", 123).build(),
	);
	expect(promptChain.promptChainId).toBe(promptChainId);
	expect(promptChain.versionId).toBe(config.dev.prodAndT123PromptChainVersionId);
	const promptChain2 = await maxim.getPromptChain(
		promptChainId,
		new QueryBuilder().and().deploymentVar("Environment", "Prod").deploymentVar("TenantID", 123).build(),
	);
	expect(promptChain2.promptChainId).toBe(promptChainId);
	expect(promptChain2.versionId).toBe(config.dev.prodAndT123PromptChainVersionId);
});

test("test if fallback works fine for prompt chain", async () => {
	const prompt = await maxim.getPromptChain(
		promptChainId,
		new QueryBuilder().and().deploymentVar("Environment", "prod").deploymentVar("TenantId", 1234, false).build(),
	);
	expect(prompt.promptChainId).toBe(promptChainId);
	expect(prompt.versionId).toBe(config.dev.promptChainVersionId);
});

test("test if fallback works fine forceful", async () => {
	const promptChain = await maxim.getPromptChain(
		promptChainId,
		new QueryBuilder().and().deploymentVar("Environment", "Prod").deploymentVar("TenantID", 123, true).build(),
	);
	console.log(promptChain);
	expect(promptChain.promptChainId).toBe(promptChainId);
	expect(promptChain.versionId).toBe(config.dev.prodAndT123PromptChainVersionId);
});

test("fetch all prompt chains deployed on prod", async () => {
	const promptChains = await maxim.getPromptChains(new QueryBuilder().and().deploymentVar("Environment", "Prod").build());
	console.log(promptChains.map((p) => p.versionId));
	promptChains.forEach((p) => {
		expect(config.dev.prodPromptChainVersions.includes(p.versionId)).toBe(true);
	});
	expect(promptChains.length).toBe(config.dev.prodPromptChainVersions.length);
});

test("get prompt chains from a folder with deployment variables Environment=stage and TenantId=123", async () => {
	const promptChains = await maxim.getPromptChains(
		new QueryBuilder()
			.and()
			.folder(config.dev.promptChainTestFolderId)
			.deploymentVar("Environment", "Staging")
			.deploymentVar("TenantID", "123")
			.build(),
	);
	console.log(promptChains.map((p) => p.versionId));
	expect(promptChains.length).toBe(1);
	expect(promptChains[0].versionId).toBe(config.dev.promptChainTestFolderEnvStageTenant123PromptVersion);
});

afterAll(async () => {
	await maxim.cleanup();
});
