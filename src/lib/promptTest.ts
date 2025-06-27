import { config } from "dotenv";
import { Maxim } from "../../index";
import { QueryBuilder } from "./models/queryBuilder";

config();

const MAXIM_API_KEY = process.env['MAXIM_API_KEY'];
const MAXIM_BASE_URL = process.env["MAXIM_BASE_URL"];

async function main() {
  if (!MAXIM_API_KEY || !MAXIM_BASE_URL) {
    console.error("No key found: ", { MAXIM_API_KEY, MAXIM_BASE_URL })
    return;
  };

  const maxim = new Maxim({
    baseUrl: MAXIM_BASE_URL,
    apiKey: MAXIM_API_KEY,
    promptManagement: true
  });

  const prompt = await maxim.getPrompt(
    "cm8fkfacp000510vu14u0895k",
    new QueryBuilder().and().deploymentVar("Test multi select", ["multi2"]).build()
  );
  const promptRun = await prompt?.run("Hello");
  console.log("Run: ", promptRun?.choices[0].message);
  
  const promptChain = await maxim.getPromptChain("cmbupqd6u0003mlbkgn3k2lxy", new QueryBuilder().and().deploymentVar("Test multi select", ["part1", "part2", "part3"]).build());
  const promptChainRun = await promptChain?.run("What is Cosmos about?");
  console.log("Chain run: ", promptChainRun?.response);
}

main();