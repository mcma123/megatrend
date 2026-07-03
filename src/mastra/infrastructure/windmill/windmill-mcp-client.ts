import { MCPClient } from "@mastra/mcp";

const windmillMcpUrl = process.env.WINDMILL_MCP_URL;
const windmillMcpTimeoutMs = Number(process.env.WINDMILL_MCP_TIMEOUT_MS ?? "120000");

const windmillMcp = windmillMcpUrl
  ? new MCPClient({
      id: "windmill-megatrend",
      servers: {
        windmill: {
          url: new URL(windmillMcpUrl),
          timeout: windmillMcpTimeoutMs,
        },
      },
      timeout: windmillMcpTimeoutMs,
    })
  : null;

let windmillToolsPromise: Promise<Record<string, any>> | null = null;

export function parseMcpToolResult(result: any) {
  const textPart = Array.isArray(result?.content)
    ? result.content.find((part: any) => part?.type === "text" && typeof part?.text === "string")
    : null;

  if (!textPart) {
    return result;
  }

  try {
    return JSON.parse(textPart.text);
  } catch {
    return {
      rawText: textPart.text,
    };
  }
}

export async function loadWindmillTools() {
  if (!windmillMcp) {
    throw new Error("WINDMILL_MCP_URL is not configured.");
  }

  if (!windmillToolsPromise) {
    windmillToolsPromise = windmillMcp.listTools().catch(error => {
      windmillToolsPromise = null;
      throw error;
    });
  }

  return windmillToolsPromise;
}

export async function getRemoteTool(toolId: string) {
  const windmillTools = await loadWindmillTools();
  const namespacedToolId = `windmill_${toolId}`;
  const tool = windmillTools[namespacedToolId] ?? windmillTools[toolId];

  if (!tool) {
    const availableTools = Object.keys(windmillTools).sort().join(", ");
    throw new Error(`Windmill MCP tool '${namespacedToolId}' was not found. Available tools: ${availableTools}`);
  }

  return tool;
}

export const windmillMcpServerProxies = windmillMcp ? windmillMcp.toMCPServerProxies() : {};
