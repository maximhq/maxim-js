import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

export interface MaximOtelOptions {
    /** Maxim log repository ID */
    loggerId: string;
    /** Maxim API key */
    apiKey: string;
    /** Custom service name for traces */
    serviceName?: string;
}

/**
 * Initializes OpenTelemetry tracing using Maxim's OTLP endpoint.
 * Returns the started NodeSDK instance.
 */
export function initMaximOtel(options: MaximOtelOptions) {
    const exporter = new OTLPTraceExporter({
        url: "https://api.getmaxim.ai/v1/otel",
        headers: {
            "x-maxim-api-key": options.apiKey,
            "x-maxim-logger-id": options.loggerId,
        },
    });

    const sdk = new NodeSDK({
        resource: new Resource({
            [SemanticResourceAttributes.SERVICE_NAME]: options.serviceName ?? "maxim-vercel-ai",
        }),
    });

    sdk.configureTracerProvider((provider) => {
        provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    });

    sdk.start();
    return sdk;
}
