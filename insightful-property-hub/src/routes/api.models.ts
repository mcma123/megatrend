import { createFileRoute } from "@tanstack/react-router";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

type OpenRouterModelResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    description?: string;
    context_length?: number;
    top_provider?: {
      context_length?: number;
    };
    supported_parameters?: string[];
  }>;
};

export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const headers = new Headers();
        const apiKey = process.env.OPENROUTER_API_KEY;

        if (apiKey) {
          headers.set("Authorization", `Bearer ${apiKey}`);
        }

        const upstream = await fetch(OPENROUTER_MODELS_URL, {
          method: "GET",
          headers,
          signal: request.signal,
        });

        if (!upstream.ok) {
          const errorText = await upstream.text();
          return Response.json(
            {
              error: errorText || "Failed to load OpenRouter models.",
            },
            { status: upstream.status },
          );
        }

        const payload = (await upstream.json()) as OpenRouterModelResponse;
        const models = (payload.data ?? [])
          .filter((model): model is NonNullable<OpenRouterModelResponse["data"]>[number] & { id: string } =>
            typeof model.id === "string" && model.id.length > 0,
          )
          .map((model) => ({
            id: model.id,
            name: model.name ?? model.id,
            description: model.description ?? "",
            contextLength: model.context_length ?? model.top_provider?.context_length ?? null,
            supportsTools: (model.supported_parameters ?? []).includes("tools"),
            supportsReasoning: (model.supported_parameters ?? []).some((parameter) =>
              ["include_reasoning", "reasoning", "reasoning_effort"].includes(parameter),
            ),
          }))
          .sort((a, b) => a.id.localeCompare(b.id));

        return Response.json(
          {
            models,
            fetchedAt: new Date().toISOString(),
          },
          {
            headers: {
              "Cache-Control": "public, max-age=300",
            },
          },
        );
      },
    },
  },
});
