import { v4 as uuid } from "uuid";
import { Generation, Trace } from "../components";


/**
 * Processes a Together.ai stream and logs the result to Maxim tracing.
 */
export function processTogetherStream(
  stream: any,
  trace: Trace,
  generation: Generation,
  model: string,
  maximMetadata: any,
) {
  let chunks: any[] = [];
  let result = {
    text: "",
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    finishReason: "stop",
  };

  const processedStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          chunks.push(chunk);

          // Extract text from chunk
          if (chunk.choices?.[0]?.delta?.content) {
            result.text += chunk.choices[0].delta.content;
          }

          // Update usage if available
          if (chunk.usage) {
            result.usage = chunk.usage;
          }

          // Check for finish reason
          if (chunk.choices?.[0]?.finish_reason) {
            result.finishReason = chunk.choices[0].finish_reason;
          }

          controller.enqueue(chunk);
        }

        // Log the final result
        generation.result({
          id: uuid(),
          object: "chat_completion",
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            text: result.text,
            finish_reason: result.finishReason,
            logprobs: null,
          }],
          usage: {
            prompt_tokens: result.usage.prompt_tokens || 0,
            completion_tokens: result.usage.completion_tokens || 0,
            total_tokens: (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0),
          },
        });
        generation.end();

        controller.close();
      } catch (error) {
        generation.error({
          message: (error as Error).message,
        });
        console.error("[Maxim SDK] Together.ai stream logging failed:", error);
        controller.error(error);
      } finally {
        if (!maximMetadata?.traceId) trace.end();
      }
    },
  });

  return processedStream;
}
