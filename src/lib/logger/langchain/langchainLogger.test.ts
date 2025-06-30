import { ChatAnthropic } from "@langchain/anthropic";
import { ChatMessageHistory } from "@langchain/community/stores/message/in_memory";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { Document } from "@langchain/core/documents";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { JsonOutputParser, StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableConfig, RunnableLambda, RunnableWithMessageHistory } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { config } from "dotenv";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { z } from "zod";
import { Maxim } from "../../../../index";
import { MaximLangchainTracer } from "../../../../langchain";

// Configure dotenv
config();

// local config
const openAIKey = process.env["OPENAI_API_KEY"];
const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
const tavilyApiKey = process.env["TAVILY_API_KEY"];
const apiKey = process.env["MAXIM_API_KEY"];
const baseUrl = process.env["MAXIM_BASE_URL"];
const repoId = process.env["MAXIM_LOG_REPO_ID"];

let maxim: Maxim;

describe("Comprehensive MaximLangchainTracer Tests", () => {
	beforeAll(async () => {
		if (!baseUrl || !apiKey) {
			throw new Error("MAXIM_BASE_URL and MAXIM_API_KEY environment variables are required");
		}
		maxim = new Maxim({
			baseUrl: baseUrl,
			apiKey: apiKey,
		});
	});

	afterAll(async () => {
		await maxim.cleanup();
	});

	describe("Basic Chat Model Tests", () => {
		it("should trace OpenAI chat model with basic text", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (logger) {
				const query = "Who is Sachin Tendulkar?";
				const maximTracer = new MaximLangchainTracer(logger);
				const llm = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0,
					topP: 1,
					frequencyPenalty: 0,
					callbacks: [maximTracer],
					maxTokens: 4096,
					n: 1,
					streaming: false,
					metadata: {
						maxim: { generationName: "basic-openai-chat", generationTags: { testType: "basic", model: "openai" } },
					},
				});
				await llm.invoke(query);
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 20000);

		it("should trace OpenAI chat model with streaming", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			if (logger) {
				const query = "Write a short poem about artificial intelligence";
				const maximTracer = new MaximLangchainTracer(logger);
				const llm = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0.7,
					streaming: true,
					metadata: {
						maxim: { generationName: "streaming-openai-chat", generationTags: { testType: "streaming", model: "openai" } },
					},
				});

				const chunks = [];
				const stream = await llm.stream(query, { callbacks: [maximTracer] });
				for await (const chunk of stream) {
					chunks.push(chunk);
				}

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 20000);

		it("should trace Anthropic chat model with multimodal input", async () => {
			if (!repoId || !anthropicApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID and ANTHROPIC_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			const imageUrl = {
				url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg",
			};
			const query = "Describe what you see in this image";

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);
				const llm = new ChatAnthropic({
					anthropicApiKey: anthropicApiKey,
					modelName: "claude-sonnet-4-20250514",
					temperature: 0,
					maxTokens: 4096,
					callbacks: [maximTracer],
					streaming: true,
					metadata: {
						maxim: { generationName: "multimodal-anthropic", generationTags: { testType: "multimodal", model: "anthropic" } },
					},
				});

				const result = await llm.invoke([
					new HumanMessage({
						content: [
							{ type: "text", text: query },
							{ type: "image_url", image_url: imageUrl },
						],
					}),
				]);
				console.log("Multimodal result", JSON.stringify(result, null, 2));
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 15000);
	});

	describe("Tool Calling Tests", () => {
		it("should trace tool calls with custom tools", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			const query = "What's the sum of 25 and 17? Also multiply 8 by 6.";
			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Define custom tools
				const addTool = tool(
					async ({ a, b }) => {
						return a + b;
					},
					{
						name: "add",
						schema: z.object({
							a: z.number(),
							b: z.number(),
						}),
						description: "Adds two numbers together",
					},
				);

				const multiplyTool = tool(
					async ({ a, b }) => {
						return a * b;
					},
					{
						name: "multiply",
						schema: z.object({
							a: z.number(),
							b: z.number(),
						}),
						description: "Multiplies two numbers together",
					},
				);

				const tools = [addTool, multiplyTool];

				const llm = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o",
					temperature: 0,
					metadata: {
						maxim: { generationName: "tool-calling", generationTags: { testType: "tools", complexity: "multiple" } },
					},
				});

				const llmWithTools = llm.bindTools(tools);
				const result = await llmWithTools.invoke(query, { callbacks: [maximTracer] });
				console.log("Tool calls result:", JSON.stringify(result.tool_calls, null, 2));

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 15000);

		it("should trace complete tool calling chain with execution and final response", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			const query = "Calculate 15 * 4 and then add 100 to the result";

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				const calculatorTool = tool(
					async ({ operation, a, b }) => {
						switch (operation) {
							case "add":
								return a + b;
							case "multiply":
								return a * b;
							case "subtract":
								return a - b;
							case "divide":
								return a / b;
							default:
								throw new Error(`Unknown operation: ${operation}`);
						}
					},
					{
						name: "calculator",
						schema: z.object({
							operation: z.enum(["add", "multiply", "subtract", "divide"]),
							a: z.number(),
							b: z.number(),
						}),
						description: "Performs basic arithmetic operations",
					},
				);

				// Create a prompt for the tool calling chain
				const prompt = ChatPromptTemplate.fromMessages([
					["system", "You are a helpful assistant that can perform calculations using tools. Execute tools step by step."],
					["placeholder", "{messages}"],
				]);

				const llm = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o",
					temperature: 0,
					metadata: {
						maxim: { generationName: "tool-execution-chain", generationTags: { testType: "chain", complexity: "sequential" } },
					},
				});

				const llmWithTools = llm.bindTools([calculatorTool]);
				const chain = prompt.pipe(llmWithTools);

				// Create a complete tool calling chain that properly traces tool executions
				const toolChain = RunnableLambda.from(async (userInput: string, config) => {
					const messages: (HumanMessage | AIMessage | ToolMessage)[] = [new HumanMessage(userInput)];

					// Continue until no more tool calls are needed
					const maxIterations = 5;
					let iteration = 0;

					while (iteration < maxIterations) {
						// Get response from LLM
						const aiMsg = await chain.invoke({ messages }, config);
						messages.push(aiMsg);

						// Check if there are tool calls to execute
						if (!aiMsg.tool_calls || aiMsg.tool_calls.length === 0) {
							// No more tool calls, return final response
							return aiMsg;
						}

						// Execute each tool call with proper tracing
						for (const toolCall of aiMsg.tool_calls) {
							try {
								const toolResult = await calculatorTool.invoke(toolCall, config);
								// Ensure toolResult is a ToolMessage
								if (toolResult instanceof ToolMessage) {
									messages.push(toolResult);
								} else {
									// If for some reason it's not a ToolMessage, create one
									messages.push(new ToolMessage(String(toolResult), toolCall.id || "unknown"));
								}
							} catch (error) {
								const errorMsg = new ToolMessage(`Error executing ${toolCall.name}: ${(error as Error).message}`, toolCall.id || "unknown");
								messages.push(errorMsg);
							}
						}

						iteration++;
					}

					// If we reach max iterations, return the last AI message
					return messages[messages.length - 1];
				}).withConfig({
					metadata: {
						maxim: {
							generationName: "complete-tool-chain",
							generationTags: { testType: "chain", workflow: "tool-execution" },
						},
					},
				});

				const result = await toolChain.invoke(query, { callbacks: [maximTracer] });
				console.log("Tool chain result:", result.content);

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 20000);
	});

	describe("Chain Tests", () => {
		it("should trace LCEL chain with prompt and output parser", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			const topic = "quantum computing";

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				const prompt = ChatPromptTemplate.fromTemplate("Tell me a fascinating fact about {topic}. Keep it under 100 words.");

				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0.7,
					metadata: {
						maxim: { generationName: "lcel-chain", generationTags: { testType: "chain", complexity: "simple" } },
					},
				});

				const parser = new StringOutputParser();

				const chain = prompt
					.pipe(model)
					.pipe(parser)
					.withConfig({
						metadata: {
							maxim: { chainName: "lcel-prompt-model-parser", chainTags: { testType: "lcel-chain" } },
						},
					});

				const result = await chain.invoke({ topic }, { callbacks: [maximTracer] });
				console.log("LCEL chain result:", result);

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 15000);

		it("should trace streaming LCEL chain", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });
			const topic = "machine learning ethics";

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				const prompt = ChatPromptTemplate.fromTemplate("Write a brief essay about {topic}. Include key points and challenges.");

				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0.5,
					streaming: true,
					metadata: {
						maxim: { generationName: "streaming-chain", generationTags: { testType: "chain", streaming: true } },
					},
				});

				const parser = new StringOutputParser();

				const chain = prompt
					.pipe(model)
					.pipe(parser)
					.withConfig({
						callbacks: [maximTracer],
						metadata: {
							maxim: { chainName: "streaming-lcel-chain", chainTags: { testType: "streaming-chain" } },
						},
					});

				const chunks = [];
				const stream = await chain.stream({ topic });
				for await (const chunk of stream) {
					chunks.push(chunk);
				}

				console.log("Streaming chain collected chunks:", chunks.length);
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 30000);

		it("should trace JSON output parser chain", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				const prompt = ChatPromptTemplate.fromTemplate(
					`Extract the following information from the text and return as JSON:
					- main_topic: the primary subject
					- key_points: array of important points
					- sentiment: positive, negative, or neutral

					Text: {text}

					Return only valid JSON.`,
				);

				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o",
					temperature: 0,
					metadata: {
						maxim: { generationName: "json-parser-chain", generationTags: { testType: "chain", parser: "json" } },
					},
				});

				const parser = new JsonOutputParser();

				const chain = prompt
					.pipe(model)
					.pipe(parser)
					.withConfig({
						callbacks: [maximTracer],
						metadata: {
							maxim: { chainName: "json-extraction-chain", chainTags: { testType: "json-chain" } },
						},
					});

				const text =
					"Artificial intelligence is revolutionizing healthcare by enabling faster diagnosis and personalized treatment plans. However, concerns about data privacy and algorithmic bias remain significant challenges.";
				const result = await chain.invoke({ text });
				console.log("JSON parser result:", JSON.stringify(result, null, 2));

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 15000);
	});

	describe("RAG (Retrieval Augmented Generation) Chain Tests", () => {
		it("should trace complete RAG chain with document retrieval", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Create sample documents
				const docs = [
					new Document({
						pageContent:
							"LangChain is a framework for developing applications powered by language models. It provides tools for chaining together different components.",
						metadata: { source: "doc1" },
					}),
					new Document({
						pageContent:
							"Vector stores are used to store and retrieve documents based on semantic similarity. They use embeddings to represent text numerically.",
						metadata: { source: "doc2" },
					}),
					new Document({
						pageContent:
							"Retrieval Augmented Generation (RAG) combines the power of large language models with external knowledge retrieval.",
						metadata: { source: "doc3" },
					}),
				];

				// Create embeddings and vector store
				const embeddings = new OpenAIEmbeddings({
					openAIApiKey: openAIKey,
				});

				const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
				const retriever = vectorStore.asRetriever({ k: 2 });

				// Create RAG chain
				const prompt = ChatPromptTemplate.fromTemplate(
					"Answer the question based on the following context:\n\nContext: {context}\n\nQuestion: {input}\n\nAnswer:",
				);

				const llm = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0,
					metadata: {
						maxim: { generationName: "rag-chain", generationTags: { testType: "rag", complexity: "complete" } },
					},
				});

				const documentChain = await createStuffDocumentsChain({
					llm,
					prompt,
				});

				const retrievalChain = await createRetrievalChain({
					combineDocsChain: documentChain,
					retriever,
				});

				// Wrap the retrieval chain with proper callbacks
				const tracedRetrievalChain = retrievalChain.withConfig({
					callbacks: [maximTracer],
					metadata: {
						maxim: {
							generationName: "rag-retrieval-chain",
							generationTags: { testType: "rag", component: "retrieval" },
						},
					},
				});

				const result = await tracedRetrievalChain.invoke({
					input: "What is LangChain and how does it relate to RAG?",
				});

				console.log("RAG chain result:", result.answer);
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 25000);
	});

	describe("Memory and Conversation Chain Tests", () => {
		it("should trace conversation chain with message history", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				const prompt = ChatPromptTemplate.fromMessages([
					["system", "You are a helpful assistant that remembers our conversation."],
					new MessagesPlaceholder("history"),
					["human", "{input}"],
				]);

				const llm = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0.5,
					metadata: {
						maxim: { generationName: "conversation-memory-chain", generationTags: { testType: "memory", turns: "multiple" } },
					},
				});

				const chain = prompt.pipe(llm);
				const messageHistory = new ChatMessageHistory();

				const chainWithHistory = new RunnableWithMessageHistory({
					runnable: chain,
					getMessageHistory: () => messageHistory,
					inputMessagesKey: "input",
					historyMessagesKey: "history",
				});

				const config: RunnableConfig = { configurable: { sessionId: "test-session" }, callbacks: [maximTracer] };

				// First interaction
				const response1 = await chainWithHistory.invoke({ input: "Hi, my name is Alice and I'm a software engineer." }, config);
				console.log("First response:", response1.content);

				// Second interaction (should remember the name)
				const response2 = await chainWithHistory.invoke({ input: "What's my name and profession?" }, config);
				console.log("Second response:", response2.content);

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 20000);

		it("should trace multi-turn conversation chain with context", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				const prompt = ChatPromptTemplate.fromMessages([
					["system", "You are a knowledgeable assistant helping with technical questions."],
					new MessagesPlaceholder("messages"),
				]);

				const llm = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0.3,
					metadata: {
						maxim: {
							generationName: "multi-turn-conversation-chain",
							generationTags: { testType: "conversation", complexity: "multi-turn" },
						},
					},
				});

				const chain = prompt.pipe(llm).withConfig({
					callbacks: [maximTracer],
					metadata: {
						maxim: { chainName: "multi-turn-conversation", chainTags: { testType: "conversation" } },
					},
				});

				// Simulate a multi-turn conversation
				const messages = [
					new HumanMessage("What is TypeScript?"),
					new AIMessage(
						"TypeScript is a strongly typed programming language that builds on JavaScript by adding static type definitions. It was developed by Microsoft and compiles to plain JavaScript.",
					),
					new HumanMessage("How does it differ from JavaScript?"),
					new AIMessage(
						"TypeScript adds static typing to JavaScript, which helps catch errors at compile time rather than runtime. It also provides better IDE support with features like autocomplete and refactoring tools.",
					),
					new HumanMessage("Can you give me an example of a TypeScript interface?"),
				];

				const result = await chain.invoke({ messages });
				console.log("Multi-turn conversation result:", result.content);

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 15000);
	});

	describe("Complex Workflow Chain Tests", () => {
		it("should trace complex conditional workflow chain", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Sentiment analysis chain
				const sentimentPrompt = ChatPromptTemplate.fromTemplate(
					"Analyze the sentiment of the following text. Return only 'positive', 'negative', or 'neutral': {text}",
				);

				const sentimentModel = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0,
					metadata: {
						maxim: { generationName: "sentiment-analysis-chain", generationTags: { testType: "workflow", step: "sentiment" } },
					},
				});

				const sentimentChain = sentimentPrompt.pipe(sentimentModel).pipe(new StringOutputParser());

				// Response generation based on sentiment
				const responsePrompt = ChatPromptTemplate.fromTemplate(
					`Based on the sentiment analysis ({sentiment}), generate an appropriate response to: {text}

					If positive: Be encouraging and supportive
					If negative: Be empathetic and offer help
					If neutral: Be informative and helpful`,
				);

				const responseModel = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0.7,
					metadata: {
						maxim: { generationName: "response-generation-chain", generationTags: { testType: "workflow", step: "response" } },
					},
				});

				const responseChain = responsePrompt.pipe(responseModel).pipe(new StringOutputParser());

				// Create conditional workflow chain
				const conditionalWorkflow = RunnableLambda.from(async (input: { text: string }, config) => {
					// Step 1: Analyze sentiment
					const sentiment = await sentimentChain.invoke({ text: input.text }, config);
					console.log("Detected sentiment:", sentiment.trim());

					// Step 2: Generate response based on sentiment
					const response = await responseChain.invoke(
						{
							text: input.text,
							sentiment: sentiment.trim(),
						},
						config,
					);

					return {
						original_text: input.text,
						sentiment: sentiment.trim(),
						response: response,
					};
				}).withConfig({
					metadata: {
						maxim: {
							chainName: "conditional-workflow",
							chainTags: { testType: "workflow", complexity: "conditional" },
						},
					},
					callbacks: [maximTracer],
				});

				const result = await conditionalWorkflow.invoke({
					text: "I'm really struggling with this new project and feeling overwhelmed.",
				});

				console.log("Complex workflow result:", JSON.stringify(result, null, 2));
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 25000);

		// the input / output won't make sense here but just ensure 3 parallel chains are there
		it("should trace parallel execution chain", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Create multiple analysis chains
				const summaryPrompt = ChatPromptTemplate.fromTemplate("Summarize this text in one sentence: {text}");
				const keywordsPrompt = ChatPromptTemplate.fromTemplate("Extract 5 key keywords from this text: {text}");
				const tonePrompt = ChatPromptTemplate.fromTemplate("Analyze the tone of this text (formal/informal/neutral): {text}");

				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0,
					metadata: {
						maxim: { generationName: "parallel-chains", generationTags: { testType: "workflow", execution: "parallel" } },
					},
				});

				const summaryChain = summaryPrompt.pipe(model).pipe(new StringOutputParser());
				const keywordsChain = keywordsPrompt.pipe(model).pipe(new StringOutputParser());
				const toneChain = tonePrompt.pipe(model).pipe(new StringOutputParser());

				// Execute chains in parallel using RunnableLambda
				const parallelWorkflow = RunnableLambda.from(async (input: { text: string }, config) => {
					const [summary, keywords, tone] = await Promise.all([
						summaryChain.invoke({ text: input.text }, config),
						keywordsChain.invoke({ text: input.text }, config),
						toneChain.invoke({ text: input.text }, config),
					]);

					return {
						summary,
						keywords,
						tone,
						original_length: input.text.length,
					};
				}).withConfig({
					metadata: {
						maxim: {
							chainName: "parallel-analysis-workflow",
							chainTags: { testType: "workflow", execution: "parallel" },
						},
					},
					callbacks: [maximTracer],
				});

				const sampleText =
					"Artificial intelligence and machine learning technologies are rapidly transforming industries across the globe. From healthcare to finance, these innovative solutions are enabling organizations to automate processes, gain insights from data, and make more informed decisions. However, the implementation of AI systems also raises important questions about ethics, privacy, and the future of work.";

				const result = await parallelWorkflow.invoke({ text: sampleText });
				console.log("Parallel execution result:", JSON.stringify(result, null, 2));

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 20000);
	});

	describe("Error Handling and Edge Cases", () => {
		it("should trace error handling in tool calling chains", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Create a tool that might fail
				const riskyTool = tool(
					async ({ operation, value }) => {
						if (operation === "divide" && value === 0) {
							throw new Error("Division by zero is not allowed");
						}
						if (operation === "sqrt" && value < 0) {
							throw new Error("Cannot calculate square root of negative number");
						}

						switch (operation) {
							case "divide":
								return 100 / value;
							case "sqrt":
								return Math.sqrt(value);
							default:
								return value;
						}
					},
					{
						name: "risky_calculator",
						schema: z.object({
							operation: z.enum(["divide", "sqrt", "identity"]),
							value: z.number(),
						}),
						description: "Performs risky mathematical operations that might fail",
					},
				);

				const prompt = ChatPromptTemplate.fromMessages([
					["system", "You are a helpful assistant that can perform calculations using tools. Handle errors gracefully."],
					["placeholder", "{messages}"],
				]);

				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o",
					temperature: 0,
					metadata: {
						maxim: { generationName: "error-handling-chain", generationTags: { testType: "error", scenario: "tool-failure" } },
					},
				});

				const modelWithTools = model.bindTools([riskyTool]);
				const chain = prompt.pipe(modelWithTools);

				// Create error handling chain with proper tool tracing
				const errorHandlingChain = RunnableLambda.from(async (userInput: string, config) => {
					try {
						const messages: (HumanMessage | AIMessage | ToolMessage)[] = [new HumanMessage(userInput)];

						// Get initial response with tool calls
						const aiMsg = await chain.invoke({ messages }, config);
						messages.push(aiMsg);

						// Execute tool calls with proper error handling and tracing
						if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
							for (const toolCall of aiMsg.tool_calls) {
								try {
									const toolResult = await riskyTool.invoke(toolCall, config);
									// Ensure toolResult is a ToolMessage
									if (toolResult instanceof ToolMessage) {
										messages.push(toolResult);
									} else {
										// If for some reason it's not a ToolMessage, create one
										messages.push(new ToolMessage(String(toolResult), toolCall.id || "unknown"));
									}
								} catch (error) {
									// Create proper error tool message
									const errorMsg = new ToolMessage(`Error: ${(error as Error).message}`, toolCall.id || "unknown");
									messages.push(errorMsg);
									console.log("Tool execution error (expected):", (error as Error).message);
								}
							}

							// Get final response with tool results/errors
							return chain.invoke({ messages }, config);
						}

						return aiMsg;
					} catch (error) {
						console.log("Caught expected error:", (error as Error).message);
						return new AIMessage(`I encountered an error: ${(error as Error).message}`);
					}
				}).withConfig({
					metadata: {
						maxim: {
							chainName: "error-handling-workflow",
							chainTags: { testType: "error", workflow: "tool-error-recovery" },
						},
					},
					callbacks: [maximTracer],
				});

				const result = await errorHandlingChain.invoke("Calculate the square root of -25");
				console.log("Error handling result:", result.content || result);

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 15000);

		it("should handle large input text in chains", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Generate a large input text
				const largeText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(200);

				const prompt = ChatPromptTemplate.fromTemplate("Please provide a concise summary of the following text (max 100 words): {text}");

				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0,
					maxTokens: 150,
					metadata: {
						maxim: { generationName: "large-input-chain", generationTags: { testType: "edge-case", size: "large" } },
					},
				});

				const chain = prompt
					.pipe(model)
					.pipe(new StringOutputParser())
					.withConfig({
						callbacks: [maximTracer],
						metadata: {
							maxim: { chainName: "large-text-summary", chainTags: { testType: "large-input" } },
						},
					});

				const result = await chain.invoke({ text: largeText });

				console.log("Large input result length:", result.length);
				console.log("Original text length:", largeText.length);

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 20000);
	});

	describe("Advanced Chain Features", () => {
		it("should trace custom runnable chain with metadata", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Create custom runnable with complex logic
				const customProcessor = RunnableLambda.from(async (input: { text: string; operation: string }, config) => {
					const { text, operation } = input;

					switch (operation) {
						case "word_count":
							return { result: text.split(" ").length, operation };
						case "char_count":
							return { result: text.length, operation };
						case "sentence_count":
							return { result: text.split(".").length - 1, operation };
						default:
							return { result: 0, operation: "unknown" };
					}
				}).withConfig({
					metadata: {
						maxim: {
							chainName: "custom-processor",
							chainTags: {
								testType: "custom",
								processor: "text-analysis",
							},
						},
					},
					callbacks: [maximTracer],
				});

				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					temperature: 0,
					metadata: {
						maxim: { generationName: "custom-chain-model", generationTags: { testType: "custom", chain: "complex" } },
					},
				});

				// Chain custom processor with model
				const complexChain = RunnableLambda.from(async (input: { text: string }, config) => {
					// Process text statistics
					const wordCount = await customProcessor.invoke({ text: input.text, operation: "word_count" }, config);
					const charCount = await customProcessor.invoke({ text: input.text, operation: "char_count" }, config);

					// Generate analysis with model
					const prompt = `Analyze this text: "${input.text}"
					Word count: ${wordCount.result}
					Character count: ${charCount.result}

					Provide insights about the text complexity and readability.`;

					const analysis = await model.invoke(prompt, config);

					return {
						statistics: { wordCount: wordCount.result, charCount: charCount.result },
						analysis: analysis.content,
						original_text: input.text,
					};
				}).withConfig({
					metadata: {
						maxim: {
							chainName: "complex-analysis-workflow",
							chainTags: { testType: "custom", workflow: "complex-analysis" },
						},
					},
					callbacks: [maximTracer],
				});

				const result = await complexChain.invoke({
					text: "Machine learning algorithms are becoming increasingly sophisticated and capable of solving complex problems across various domains including natural language processing, computer vision, and predictive analytics.",
				});

				console.log("Custom runnable result:", JSON.stringify(result, null, 2));
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 25000);
	});

	describe("LangGraph Agent Tests", () => {
		it("should trace LangGraph ReAct agent with Tavily search and memory", async () => {
			if (!repoId || !openAIKey || !tavilyApiKey) {
				throw new Error("MAXIM_LOG_REPO_ID, OPENAI_API_KEY, and TAVILY_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Define the tools for the agent to use
				const agentTools = [
					new TavilySearchResults({
						maxResults: 3,
						apiKey: tavilyApiKey,
					}),
				];

				const agentModel = new ChatOpenAI({
					temperature: 0,
					openAIApiKey: openAIKey,
					modelName: "gpt-4o-mini",
					metadata: {
						maxim: {
							generationName: "langgraph-react-agent",
							generationTags: {
								testType: "agent",
								framework: "langgraph",
								pattern: "react",
							},
						},
					},
				});

				// Initialize memory to persist state between graph runs
				const agentCheckpointer = new MemorySaver();
				const agent = createReactAgent({
					llm: agentModel,
					tools: agentTools,
					checkpointSaver: agentCheckpointer,
				});

				// Wrap the agent with proper callbacks for tracing
				const tracedAgent = agent.withConfig({
					metadata: {
						maxim: {
							generationName: "react-agent-workflow",
							generationTags: {
								testType: "agent",
								workflow: "multi-turn",
								memory: "persistent",
							},
						},
					},
				});

				// First interaction - ask about weather in SF
				const agentFinalState = await tracedAgent.invoke(
					{ messages: [new HumanMessage("what is the current weather in sf")] },
					{ configurable: { thread_id: "42" }, callbacks: [maximTracer] },
				);

				console.log("First agent response:", agentFinalState.messages[agentFinalState.messages.length - 1].content);

				// Second interaction - ask about NY (should remember context)
				const agentNextState = await tracedAgent.invoke(
					{ messages: [new HumanMessage("what about ny")] },
					{ configurable: { thread_id: "42" }, callbacks: [maximTracer] },
				);

				console.log("Second agent response:", agentNextState.messages[agentNextState.messages.length - 1].content);

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 60000);
	});

	describe("README Examples Tests", () => {
		it("should work with basic usage example from README", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				// Example from README: Basic usage
				const maximTracer = new MaximLangchainTracer(logger);

				// Use with any LangChain runnable
				const prompt = ChatPromptTemplate.fromTemplate("What is {topic}?");
				const model = new ChatOpenAI({
					model: "gpt-3.5-turbo",
					openAIApiKey: openAIKey,
				});
				const chain = prompt.pipe(model);

				// Method 1: Pass tracer at runtime
				const result = await chain.invoke({ topic: "AI" }, { callbacks: [maximTracer] });
				console.log("Basic usage result:", result.content);

				// Method 2: Attach permanently to the chain
				const chainWithTracer = chain.withConfig({ callbacks: [maximTracer] });
				const result2 = await chainWithTracer.invoke({ topic: "machine learning" });
				console.log("Permanent tracer result:", result2.content);

				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 20000);

		it("should work with LangGraph integration example from README", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Use a working LangGraph pattern that demonstrates the README concept
				// This follows the same pattern as shown in README but uses the working createReactAgent
				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					model: "gpt-3.5-turbo",
				});

				// Create a simple tool for the demo
				const demoTool = tool(
					async ({ message }) => {
						return `Processed: ${message}`;
					},
					{
						name: "demo_processor",
						schema: z.object({
							message: z.string(),
						}),
						description: "Process a demo message",
					},
				);

				// Create LangGraph agent (demonstrates the graph concept from README)
				const checkpointer = new MemorySaver();
				const app = createReactAgent({
					llm: model,
					tools: [demoTool],
					checkpointSaver: checkpointer,
				});

				// Use the tracer with your graph - matching README pattern
				const result = await app.invoke(
					{ messages: [{ role: "user", content: "Hello!" }] },
					{ callbacks: [maximTracer], configurable: { thread_id: "readme_demo" } },
				);

				console.log("LangGraph integration result:", result.messages[result.messages.length - 1].content);
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 25000);

		it("should work with complete metadata example from README", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);
				const prompt = ChatPromptTemplate.fromTemplate("What is {query}?");
				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					model: "gpt-3.5-turbo",
				});
				const chain = prompt.pipe(model);

				// Complete example from README with comprehensive metadata
				const result = await chain.invoke(
					{ query: "What is machine learning?" },
					{
						callbacks: [maximTracer],
						metadata: {
							maxim: {
								// Custom names for better organization
								traceName: "ML Question Answering",

								// Custom tags for filtering and analytics
								traceTags: {
									category: "educational",
									priority: "high",
									version: "v2.1",
								},

								// Link to existing session (optional)
								sessionId: "user_session_123",
							},
							// You can also include non-Maxim metadata
							user_id: "user_123",
							request_id: "req_456",
						},
					},
				);

				console.log("Complete metadata example result:", result.content);
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 15000);

		it("should work with LLM-specific metadata example from README", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);
				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					model: "gpt-4",
				});

				// Example from README: For LLM calls
				const llmResult = await model.invoke("Explain quantum computing", {
					callbacks: [maximTracer],
					metadata: {
						maxim: {
							generationName: "Quantum Computing Explanation",
							generationTags: {
								topic: "quantum_computing",
								difficulty: "advanced",
								model: "gpt-4",
							},
						},
					},
				});

				console.log("LLM metadata example result:", llmResult.content);
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 15000);

		it("should work with retriever metadata example from README", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Create sample documents for retriever
				const docs = [
					new Document({
						pageContent: "Machine learning algorithms include supervised, unsupervised, and reinforcement learning approaches.",
						metadata: { source: "ml_guide" },
					}),
					new Document({
						pageContent: "Neural networks are a subset of machine learning inspired by biological neural networks.",
						metadata: { source: "ai_basics" },
					}),
				];

				const embeddings = new OpenAIEmbeddings({
					openAIApiKey: openAIKey,
				});

				const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
				const retriever = vectorStore.asRetriever();

				// Example from README: For retrievers
				const retrievedDocs = await retriever.invoke("machine learning algorithms", {
					callbacks: [maximTracer],
					metadata: {
						maxim: {
							retrievalName: "ML Algorithm Search",
							retrievalTags: {
								index_name: "ml_papers",
								search_type: "semantic",
								top_k: "5",
							},
						},
					},
				});

				console.log("Retriever metadata example result:", retrievedDocs.length, "documents retrieved");
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 20000);

		it("should work with tool call metadata example from README", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Create a simple weather tool for the example
				const weatherTool = tool(
					async ({ query }) => {
						// Simulate weather API call
						return `Weather in ${query}: 72°F, sunny`;
					},
					{
						name: "weather_lookup",
						schema: z.object({
							query: z.string(),
						}),
						description: "Look up weather information for a location",
					},
				);

				// Example from README: For tool calls
				const toolResult = await weatherTool.invoke(
					{ query: "weather in NYC" },
					{
						callbacks: [maximTracer],
						metadata: {
							maxim: {
								toolCallName: "Weather API Lookup",
								toolCallTags: {
									api: "openweather",
									location: "NYC",
									units: "metric",
								},
							},
						},
					},
				);

				console.log("Tool metadata example result:", toolResult);
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 15000);

		it("should work with comprehensive chain example showing all metadata types", async () => {
			if (!repoId || !openAIKey) {
				throw new Error("MAXIM_LOG_REPO_ID and OPENAI_API_KEY environment variables are required");
			}
			const logger = await maxim.logger({ id: repoId });

			if (logger) {
				const maximTracer = new MaximLangchainTracer(logger);

				// Create a comprehensive chain that uses multiple metadata types
				const prompt = ChatPromptTemplate.fromTemplate("Analyze the topic: {topic}");
				const model = new ChatOpenAI({
					openAIApiKey: openAIKey,
					model: "gpt-3.5-turbo",
				});

				// Tool for additional analysis
				const analysisTool = tool(
					async ({ text }) => {
						return `Analysis: ${text} contains ${text.split(" ").length} words`;
					},
					{
						name: "text_analyzer",
						schema: z.object({
							text: z.string(),
						}),
						description: "Analyze text properties",
					},
				);

				const modelWithTools = model.bindTools([analysisTool]);
				const chain = prompt.pipe(modelWithTools);

				// Execute with comprehensive metadata
				const result = await chain.invoke(
					{ topic: "artificial intelligence" },
					{
						callbacks: [maximTracer],
						metadata: {
							maxim: {
								traceName: "AI Topic Analysis",
								chainName: "Analysis Chain",
								generationName: "Topic Analysis Generation",
								traceTags: {
									category: "analysis",
									priority: "medium",
									version: "v1.0",
								},
								chainTags: {
									type: "analysis",
									complexity: "medium",
								},
								generationTags: {
									model: "gpt-3.5-turbo",
									temperature: "0.7",
								},
								sessionId: "analysis_session_456",
							},
							// Additional metadata
							experiment_id: "exp_789",
							user_type: "premium",
						},
					},
				);

				console.log("Comprehensive metadata result:", result.content || result.tool_calls);
				logger.flush();
			} else {
				throw new Error("logger is not available");
			}
		}, 20000);
	});
});
