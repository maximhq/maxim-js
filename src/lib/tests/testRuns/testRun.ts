import { createDataStructure } from "src/lib/dataset/dataset";
import { Maxim } from "../../maxim";
import "dotenv/config";
import { Data } from "src/lib/models/dataset";
import axios from "axios";


if (!process.env["MAXIM_API_KEY"]) throw new Error("Missing MAXIM_API_KEY environment variable");
if (!process.env["MAXIM_WORKSPACE_ID"]) throw new Error("Missing MAXIM_WORKSPACE_ID environment variable");
if (!process.env["MAXIM_LOG_REPO_ID"]) throw new Error("Missing MAXIM_LOG_REPO_ID environment variable");

const maxim = new Maxim({
  apiKey: process.env["MAXIM_API_KEY"],
  baseUrl: process.env["MAXIM_BASE_URL"],
});

const dataStructure = createDataStructure({
  Input: "INPUT",
  "Expected Output": "EXPECTED_OUTPUT",
  targetLanguage: "VARIABLE",
  nativeLanguage: "VARIABLE",
  difficulty: "VARIABLE",
});

const data = [
  {
    Input: "How to say Hello",
    "Expected Output": "To say \"Hello\" in Spanish, you say \"Hola.\" \n\nCan you try saying it? \nAlso, you can use \"Hola\" in different situations, just like in English! \n\nFor example: \n\n- \"Hola, ¿cómo estás?\" (Hello, how are you?) \n\nWould you like to learn how to respond to that question?",
    targetLanguage: "Klingon",
    nativeLanguage: "English",
    difficulty: "beginner",
  },
  {
    Input: "How to say Good",
    "Expected Output": "Great question! In Spanish, \"good\" is \"bueno.\" \n\nHere's how you can use it in a sentence:\n\n- \"Es bueno.\" (It is good.)\n- \"El libro es bueno.\" (The book is good.)\n\nCan you try to use \"bueno\" in a sentence",
    targetLanguage: "Klingon",
    nativeLanguage: "English",
    difficulty: "beginner",
  },
];

async function main() {
  const maximLogger = await maxim.logger({ id: process.env["MAXIM_LOG_REPO_ID"]! });

  const testRun = maxim
    .createTestRun("testing tests + logs", process.env["MAXIM_WORKSPACE_ID"]!)
    .withDataStructure(dataStructure)
    .withData(data)
    .withConcurrency(2)
    .yieldsOutputWithTracing(async (data: Data<typeof dataStructure>, traceId: string) => {
      const response = await axios.post("http://localhost:3001/api/v1/chat", {
        message: data.Input,
        targetLanguage: data.targetLanguage,
        nativeLanguage: data.nativeLanguage,
        difficulty: data.difficulty,
      }, {
        headers: {
          "trace-id": traceId,
        },
      });

      const content = response.data.data?.choices[0]?.message?.content || "";
      const usage = response.data.data?.usage;

      return {
        data: content,
        meta: {
          usage: {
            totalTokens: usage?.total_tokens || 0,
            completionTokens: usage?.completion_tokens || 0,
            promptTokens: usage?.prompt_tokens || 0,
          },
          cost: {
            input: (usage?.prompt_tokens || 0) * 0.0015,
            output: (usage?.completion_tokens || 0) * 0.002,
            total: (usage?.total_tokens || 0) * 0.00175,
          },
        },
      };
    }, maximLogger!, true);

  await testRun.run();
}

main().catch(console.error);