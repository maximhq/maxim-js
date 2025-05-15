import fs from "node:fs";
import { v4 as uuid } from "uuid";
import { Maxim } from "./maxim";

const env = "dev";
const config: any = JSON.parse(fs.readFileSync(`${process.cwd()}/libs/maxim-js/testConfig.json`, "utf-8"));

// local config
const apiKey = config[env].apiKey;
const baseUrl = config[env].baseUrl;
const repoId = config[env].repoId;
let maxim: Maxim;

describe("initializing logger", () => {
	beforeAll(async () => {
		maxim = new Maxim({
			baseUrl: baseUrl,
			apiKey: apiKey,
		});
	});

	test("initialize logger if log repository exists", async () => {
		const logger = await maxim.logger({
			id: repoId,
		});
		expect(logger).not.toBeUndefined();
	});

	test("should throw an error if the log repository does not exist", async () => {
		try {
			const logger = await maxim.logger({
				id: "cltmndcmt0002qgug7vpj92m2",
			});
		} catch (e: any) {
			expect(e.message).toBe("Log repository not found.");
		}
	});
});

describe("creating a trace", () => {
	beforeAll(async () => {
		maxim = new Maxim({
			baseUrl: baseUrl,
			apiKey: apiKey,
			debug: true,
		});
	});

	test("should be able to create a trace and update", async () => {
		const logger = await maxim.logger({
			id: repoId,
		});
		if (logger === undefined) {
			return;
		}
		const id = uuid();
		const trace = logger.trace({ id: id });
		expect(trace).not.toBeUndefined();
		expect(trace.id).toBe(id);
		trace.addTag("userId", "123");
		trace.event("test event", "test");
		trace.addToSession(uuid());
		trace.end();
		await logger.cleanup();
	});

	test("should be able to create a trace and update", async () => {
		const logger = await maxim.logger({
			id: repoId,
		});
		if (logger === undefined) {
			return;
		}
		const id = uuid();
		const trace = logger.trace({ id: id });
		trace.input("Testing input");
		trace.output("Testing output");
		trace.end();
		await logger.cleanup();
	});
});

describe("creating a session", () => {
	beforeAll(async () => {
		maxim = new Maxim({
			baseUrl: baseUrl,
			apiKey: apiKey,
			debug: true,
		});
	});

	test("should be able to create a session and add a trace", async () => {
		const logger = await maxim.logger({
			id: repoId,
		});
		if (logger === undefined) {
			return;
		}
		// Sleep for 30 seconds
		await new Promise((resolve) => setTimeout(resolve, 30000));
		const sessionId = uuid();
		const session = logger.session({ id: sessionId });
		for (let i = 0; i < 1; i++) {
			const traceId = uuid();
			const trace = session.trace({ id: traceId });
			expect(trace).not.toBeUndefined();
			expect(trace.id).toBe(traceId);
			trace.addTag("test", "yes");
			trace.addTag("userId", "123");
			const generationId = uuid();
			const generation = trace.generation({
				id: generationId,
				name: "default-generation",
				provider: "openai",
				model: "gpt-4o-mini",
				messages: [
					{
						role: "user",
						content:
							"tell me a story on github octocat in code blocks with visual cues in markdown in between using emojis and make it really fun. my 6 year old cousin wants to know about it (use different languages for different codeblocks, use at least 10 different popular languages and codeblocks). also try to use as many markdown syntaxes as possible and teach about it as well along with the language codeblocks",
					},
				],
				modelParameters: {
					temperature: 0,
					top_p: 1,
					frequency_penalty: 0,
					presence_penalty: 0,
					max_tokens: 4096,
					logprobs: undefined,
					top_logprobs: undefined,
					n: 1,
					logit_bias: undefined,
					stop: undefined,
					user: undefined,
					stream: false,
					functions: undefined,
					function_call: undefined,
					tools: undefined,
					tool_choice: undefined,
					response_format: undefined,
					seed: undefined,
				},
			});
			// wait for 1 second
			await new Promise((resolve) => setTimeout(resolve, 1000));
			generation.result({
				id: generationId,
				object: "text_completion",
				created: 1718393286,
				model: "gpt-3.5-turbo-16k",
				choices: [
					{
						index: 0,
						text: textString.repeat(5),
						logprobs: null,
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 7,
					completion_tokens: 105,
					total_tokens: 112,
				},
			});
			const span = trace.span({ id: uuid(), name: "test-span" });
			const inference2Id = uuid();
			const inference2 = span.generation({
				id: inference2Id,
				name: "test-inference",
				model: "gpt-4",
				messages: [
					{
						role: "user",
						content: "Hello, how are you?",
					},
				],
				modelParameters: {},
				provider: "openai",
			});
			// wait for 1 second
			await new Promise((resolve) => setTimeout(resolve, 1000));
			inference2.result({
				id: inference2Id,
				object: "text_completion",
				created: 1718393286,
				model: "gpt-4",
				choices: [
					{
						index: 0,
						text: "\n1. **Consistency**: Ensure your API design is consistent within itself and with industry standards. This includes using uniform resource naming conventions, consistent data formats, and predictable error handling mechanisms.\n2. **Simplicity**: Design APIs to be as simple as possible, but no simpler. This means providing only necessary functionalities and avoiding over-complex structures that might confuse the users.\n3. **Documentation**: Provide clear, thorough, and accessible documentation. Good documentation is crucial for API usability and maintenance. It helps users understand how to effectively interact with your API and what they can expect in terms of responses.\n4. **Versioning**: Plan for future changes by using versioning of your API. This helps prevent breaking changes to the API and keeps it robust over time.\n5. **Security**: Implement robust security measures to protect your API and its data. This includes using authentication mechanisms like OAuth, ensuring data is encrypted in transit, and considering security implications in all aspects of API design.\n",
						logprobs: null,
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 0,
					total_tokens: 113,
				},
			});
			span.addTag("test", "test-span");
			span.event(uuid(), "test event", {});
			const retrieval = span.retrieval({ id: uuid(), name: "vector-db" });
			retrieval.input("select asdkjnkjnjkansdasd");
			retrieval.output([]);
			retrieval.end();
			// wait for 2 seconds
			await new Promise((resolve) => setTimeout(resolve, 2000));
			span.end();
			trace.event(uuid(), "test event", {});
			trace.input("Hello, how are you?");
			trace.output("I'm fine, thank you!");
			trace.end();
			// wait for 1 second
			await new Promise((resolve) => setTimeout(resolve, 1000));
			trace.feedback({ score: 3, comment: "It was okay" });
		}
		session.end();
		await logger.cleanup();
		await new Promise((resolve) => setTimeout(resolve, 100000));
	}, 10000000);
});

afterAll(async () => {
	await maxim.cleanup();
});

const textString = `# The Adventurous Octocat 🐙

## Prologue: The Beginning 🏁

Once upon a time, in the digital ocean of GitHub, there lived a curious creature called the Octocat. Octocat loved to explore new programming languages and help developers around the world. 🌍✨

---

### Chapter 1: Setting Sail with Python 🐍

\`\`\`python
# Meet Octocat
octocat = {
    "name": "Octocat",
    "mood": "excited",
    "languages": ["Python", "JavaScript", "Ruby"]
}

print("Ahoy! I am", octocat["name"], "and I am", octocat["mood"], "to learn new things!")
\`\`\`

📝 **Markdown Tip:** The block above is a *code block* in **Python**. You can create it by using three backticks (\`\`\`) followed by the language name.

---

### Chapter 2: Dancing with JavaScript 💃

\`\`\`javascript
// Octocat learns to dance in JavaScript
function dance() {
    console.log("🕺💃 Octocat dances happily! 🎉");
}

dance();
\`\`\`

🔍 **Markdown Tip:** You can create **headings** using the \`#\` symbol. More \`#\` signs mean smaller headings. This is a second-level heading.

---

### Chapter 3: Building Castles in Ruby 🏰

\`\`\`ruby
# Octocat builds a castle in Ruby
class Castle
  def initialize(name)
    @name = name
  end

  def show_castle
    puts "🏰 Welcome to #{ @name } Castle!"
  end
end

my_castle = Castle.new("Octocat's")
my_castle.show_castle
\`\`\`

❓ **Markdown Tip:** You can make text *italic* by wrapping it in single asterisks (\`*\`) or **bold** with double asterisks (\`**\`).

---

### Chapter 4: Swimming in C++ 🏊‍♂️

\`\`\`cpp
#include <iostream>

// Octocat swims in the ocean of C++
int main() {
    std::cout << "🌊 Octocat swims with joy in C++!" << std::endl;
    return 0;
}
\`\`\`

📌 **Markdown Tip:** To add a horizontal line, you can use three dashes (\`---\`). This separates different sections nicely.

---

### Chapter 5: Navigating with Java ☕

\`\`\`java
// Octocat navigates using Java
public class Navigate {
    public static void main(String[] args) {
        System.out.println("🧭 Octocat navigates through Java!");
    }
}
\`\`\`

🔔 **Markdown Tip:** You can create **unordered lists** using dashes (\`-\`), asterisks (\`*\`), or plus signs (\`+\`). For example:

- This is an item
- This is another item

---

### Chapter 6: Flying with Swift 🦅

\`\`\`swift
// Octocat takes flight with Swift
func fly() {
    print("🦅 Octocat is flying high with Swift!")
}

fly()
\`\`\`

🍎 **Markdown Tip:** To embed an image, use the following syntax: \`![Alt Text](URL)\`. Here's an image of **Octocat**:

![Octocat](https://octodex.github.com/images/orderedlistocat.png)

---

### Chapter 7: Crafting with Kotlin 🧶

\`\`\`kotlin
fun craft() {
    println("🧶 Octocat is crafting new things with Kotlin!")
}

craft()
\`\`\`

📚 **Markdown Tip:** You can create **quote blocks** using the \`>\` symbol. For example:

> "Learning new languages is fun!" - Octocat

---

### Chapter 8: Chilling with Go 🧊

\`\`\`go
package main
import "fmt"

func main() {
    fmt.Println("❄️ Octocat is chilling with Go!")
}
\`\`\`

🧭 **Markdown Tip:** **Ordered lists** can be made with numbers:

1. First item
2. Second item
3. Third item

---

### Chapter 9: Sketching with HTML 🎨

\`\`\`html
<!-- Octocat sketches using HTML -->
<h1>🎨 Octocat's Art Gallery</h1>
<p>Welcome to the amazing gallery of Octocat!</p>
\`\`\`

🎯 **Markdown Tip:** You can make links using this syntax: \`[Link Text](URL)\`. For example, [Check out GitHub](https://github.com)

---

### Chapter 10: Enchanting with SQL 🧙‍♂️

\`\`\`sql
-- Octocat enchants using SQL
SELECT "✨ Octocat brings magic with SQL!" AS magic_message;
\`\`\`

🪄 **Markdown Tip:** **Inline code** can be embedded using single backticks: \`like this\`.

---

## Epilogue: The Knowledge Shared 🌟

With the adventures in all these wonderful languages, Octocat made many friends and learned so much. Now, it's time for you to explore and create your own adventures! 🚀

---

❤️ **The End** ❤️`;
