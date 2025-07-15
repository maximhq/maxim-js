import Groq from "groq-sdk";
import { MaximLogger } from "../logger";
import { v4 as uuid } from "uuid";
import { ChatCompletionResult, Generation, Trace } from "../components";

/**
 * Metadata options for Maxim tracing integration with Groq SDK.
 */
export type MaximGroqProviderMetadata = {
  /** Link your traces to a session */
  sessionId?: string;
  /** Override session name */
  sessionName?: string;
  /** Add tags to session */
  sessionTags?: Record<string, string>;
  /** Pass in an existing trace's id */
  traceId?: string;
  /** Override trace name */
  traceName?: string;
  /** Add tags to trace */
  traceTags?: Record<string, string>;
  /** Pass in a custom generation name */
  generationName?: string;
  /** Add tags to generation */
  generationTags?: Record<string, string>;
};

/**
 * Wraps a Groq client with Maxim logging and tracing capabilities.
 *
 * This function returns a wrapped version of the Groq client that integrates
 * Maxim's observability features for completions and audio transcriptions.
 *
 * @param client - The Groq client instance to wrap.
 * @param logger - The MaximLogger instance to use for tracing and logging.
 * @returns The wrapped client with Maxim integration.
 */
export function wrapMaximGroqClient(client: Groq, logger: MaximLogger, maximMetadata?: MaximGroqProviderMetadata): Groq {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "chat") {
        return {
          completions: {
          create: async (options: any) => {
            let generation: Generation | undefined = undefined;

            try {

              const response = await target.chat.completions.create(options);

              let trace: Trace | undefined = undefined;

              if (maximMetadata?.traceId) {
                trace = logger.trace({
                  id: maximMetadata.traceId,
                  name: maximMetadata?.traceName ?? "groq-completion",
                  tags: maximMetadata?.traceTags
                });
              } else if (maximMetadata?.sessionId) {
                const session = logger.session({
                  id: maximMetadata.sessionId,
                  name: maximMetadata?.sessionName ?? "default-session",
                  tags: maximMetadata?.sessionTags
                });

                trace = session.trace({
                  id: uuid(),
                  name: maximMetadata?.traceName ?? "groq-completion",
                  tags: maximMetadata?.traceTags
                });
              } else {
                trace = logger.trace({
                  id: uuid(),
                  name: maximMetadata?.traceName ?? "groq-completion",
                  tags: maximMetadata?.traceTags
                });
              }

              generation = trace.generation({
                id: uuid(),
                name: maximMetadata?.generationName ?? "default-generation",
                provider: "groq",
                model: options.model || "unknown",
                messages: options.messages,
                modelParameters: options,
                tags: maximMetadata?.generationTags,
              });

              generation.result(response as ChatCompletionResult);
              generation.end();
              trace.end();

              return response;
            } catch (error) {
              if (generation) {
                generation.error({ message: (error as Error).message });
                generation.end();
              }
              throw error;
            }
          }
        }
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  }) as Groq;
}